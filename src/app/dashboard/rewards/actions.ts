"use server";

import { revalidatePath } from "next/cache";
import type { ZodType } from "zod";
import { requireOwnerRestaurant } from "@/lib/owner";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import {
  anytimeConfigSchema,
  birthdayConfigSchema,
  comeBackConfigSchema,
  customConfigSchema,
  timedConfigSchema,
  visitLadderConfigSchema,
  welcomeConfigSchema,
} from "@/lib/booth/programs";
import { getRestaurantSettings } from "@/lib/booth/settings-data";
import { notifyGrantExtended } from "@/lib/booth/member-messaging";
import { wallTimeToUtc } from "@/lib/booth/schedule";
import type { RestaurantType } from "@/lib/booth/types";

async function getRestaurantTimezone(restaurantId: string): Promise<string> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("restaurants").select("timezone").eq("id", restaurantId).single();
  if (error) throw error;
  return data.timezone as string;
}

/**
 * Timed-offer start/end resolved against the restaurant's OWN timezone
 * (Codex #6) — never the owner's device timezone, which used to shift
 * boundaries for a remote owner. Start is restaurant-local 00:00 on the
 * chosen start date; end is restaurant-local 23:59 (not 23:59:59) on the
 * chosen end date — same wallTimeToUtc machinery the message composer uses
 * for its own scheduling boundaries (src/lib/booth/schedule.ts).
 */
function resolveTimedBounds(timezone: string, startsDate: string, endsDate: string): { starts_at: string; ends_at: string } {
  return {
    starts_at: wallTimeToUtc(startsDate, "00:00", timezone),
    ends_at: wallTimeToUtc(endsDate, "23:59", timezone),
  };
}

/** WS-D — the extend-notify checkbox's starting state (settings.extend_notify_default, default true). */
export async function getExtendNotifyDefaultAction(): Promise<boolean> {
  const restaurant = await requireOwnerRestaurant();
  const settings = await getRestaurantSettings(restaurant.id);
  return settings.extend_notify_default;
}

export type ActionResult = { ok: true } | { ok: false; error: string };

async function ownedProgram(programId: string) {
  const restaurant = await requireOwnerRestaurant();
  const admin = createSupabaseAdminClient();
  const { data: program, error } = await admin
    .from("reward_programs")
    .select("*")
    .eq("id", programId)
    .eq("restaurant_id", restaurant.id)
    .maybeSingle();
  if (error) throw error;
  if (!program) throw new Error("Program not found");
  return { restaurant, admin, program };
}

export async function toggleProgramActive(programId: string, active: boolean): Promise<ActionResult> {
  const { restaurant, admin } = await ownedProgram(programId);
  const { error } = await admin
    .from("reward_programs")
    .update({ active })
    .eq("id", programId)
    .eq("restaurant_id", restaurant.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/rewards");
  return { ok: true };
}

const schemaByType: Record<RestaurantType, ZodType> = {
  welcome: welcomeConfigSchema,
  visit_ladder: visitLadderConfigSchema,
  birthday: birthdayConfigSchema,
  come_back: comeBackConfigSchema,
  anytime: anytimeConfigSchema,
  timed: timedConfigSchema,
  // Never a create/edit target here — updateProgramConfig only ever looks
  // this up for a program that already exists (ownedProgram), and nothing
  // in this app ever calls it with a 'custom' program id. Present only so
  // this Record stays exhaustive over RestaurantType.
  custom: customConfigSchema,
};

export async function updateProgramConfig(programId: string, config: unknown): Promise<ActionResult> {
  const { restaurant, admin, program } = await ownedProgram(programId);

  let configToValidate = config;
  if (program.type === "timed") {
    const raw = config as { reward?: string; starts_date?: string; ends_date?: string };
    if (!raw.starts_date || !raw.ends_date) return { ok: false, error: "Pick start and end dates." };
    const timezone = await getRestaurantTimezone(restaurant.id);
    configToValidate = { reward: raw.reward, ...resolveTimedBounds(timezone, raw.starts_date, raw.ends_date) };
  }

  const schema = schemaByType[program.type as RestaurantType];
  const parsed = schema.safeParse(configToValidate);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid config" };
  }
  const { error } = await admin
    .from("reward_programs")
    .update({ config: parsed.data })
    .eq("id", programId)
    .eq("restaurant_id", restaurant.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/rewards");
  return { ok: true };
}

/** Bulk-extends every outstanding earned grant on a program to `newExpiresAt`. `notify`: also texts each affected member (WS-D extend-notify choice). */
export async function extendProgramGrants(programId: string, newExpiresAt: string, notify = false): Promise<ActionResult> {
  const { restaurant, admin, program } = await ownedProgram(programId);
  const { data: grants, error: grantsError } = await admin
    .from("reward_grants")
    .select("id, expires_at, member_id, reward_text")
    .eq("program_id", programId)
    .eq("restaurant_id", restaurant.id)
    .eq("state", "earned")
    .not("expires_at", "is", null);
  if (grantsError) return { ok: false, error: grantsError.message };

  for (const grant of grants ?? []) {
    const { error } = await admin.from("reward_grants").update({ expires_at: newExpiresAt }).eq("id", grant.id);
    if (error) return { ok: false, error: error.message };
    await admin.from("audit_log").insert({
      restaurant_id: restaurant.id,
      actor: "owner",
      action: "grant.extend",
      detail: { grant_id: grant.id, program_id: program.id, old_expires_at: grant.expires_at, new_expires_at: newExpiresAt },
    });
    if (notify) await notifyGrantExtended(restaurant, grant.member_id, grant.reward_text, newExpiresAt);
  }
  revalidatePath("/dashboard/rewards");
  return { ok: true };
}

export async function extendGrant(grantId: string, newExpiresAt: string, notify = false): Promise<ActionResult> {
  const restaurant = await requireOwnerRestaurant();
  const admin = createSupabaseAdminClient();
  const { data: grant, error: grantError } = await admin
    .from("reward_grants")
    .select("id, expires_at, member_id, reward_text")
    .eq("id", grantId)
    .eq("restaurant_id", restaurant.id)
    .maybeSingle();
  if (grantError) return { ok: false, error: grantError.message };
  if (!grant) return { ok: false, error: "Grant not found" };

  const { error } = await admin
    .from("reward_grants")
    .update({ expires_at: newExpiresAt })
    .eq("id", grantId)
    .eq("restaurant_id", restaurant.id);
  if (error) return { ok: false, error: error.message };
  await admin.from("audit_log").insert({
    restaurant_id: restaurant.id,
    actor: "owner",
    action: "grant.extend",
    detail: { grant_id: grantId, old_expires_at: grant.expires_at, new_expires_at: newExpiresAt },
  });
  if (notify) await notifyGrantExtended(restaurant, grant.member_id, grant.reward_text, newExpiresAt);
  revalidatePath("/dashboard/rewards");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// WS-C — "Live offers" create + duplicate (anytime/timed only)
// ---------------------------------------------------------------------------

export type CreateOfferInput = { type: "anytime" | "timed"; name: string; config: unknown };
export type CreateOfferResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * per_member_limit (anytime config) is validated here on save but NOT
 * enforced at send time — the only place a member currently accrues an
 * anytime grant is engine.ts's campaign attach-flow (grantParamsFromProgram/
 * runCampaign), which is out of this chunk's fence (shared with WS-D/WS-E).
 * Enforcing it means teaching that grant_slot to key off a per-member count
 * instead of `campaign:<id>` — flagged for the orchestrator rather than
 * touched here. Surfaced honestly in the offers-home UI instead of silently
 * claiming a cap that isn't real yet.
 */
export async function createOfferAction(input: CreateOfferInput): Promise<CreateOfferResult> {
  const restaurant = await requireOwnerRestaurant();
  // Runtime guard, not just the TS union: owners may only create offer types
  // here, never welcome/ladder/birthday/come_back programs.
  if (input.type !== "anytime" && input.type !== "timed") return { ok: false, error: "Invalid offer type." };
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Name it something." };

  let configToValidate: unknown = input.config;
  if (input.type === "timed") {
    const raw = input.config as { reward?: string; starts_date?: string; ends_date?: string };
    if (!raw.starts_date || !raw.ends_date) return { ok: false, error: "Pick start and end dates." };
    const timezone = await getRestaurantTimezone(restaurant.id);
    configToValidate = { reward: raw.reward, ...resolveTimedBounds(timezone, raw.starts_date, raw.ends_date) };
  }

  const schema = schemaByType[input.type];
  const parsed = schema.safeParse(configToValidate);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid offer" };

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("reward_programs")
    .insert({ restaurant_id: restaurant.id, type: input.type, name, active: true, config: parsed.data })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/rewards");
  return { ok: true, id: data.id };
}

/** Duplicates an offer's type/config as a new, inactive program the owner can tweak before activating. */
export async function duplicateOfferAction(programId: string): Promise<ActionResult> {
  const { restaurant, admin, program } = await ownedProgram(programId);
  const { error } = await admin.from("reward_programs").insert({
    restaurant_id: restaurant.id,
    type: program.type,
    name: `${program.name} (copy)`,
    active: false,
    config: program.config,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/rewards");
  return { ok: true };
}
