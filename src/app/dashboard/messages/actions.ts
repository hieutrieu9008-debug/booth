"use server";

import { revalidatePath } from "next/cache";
import { requireOwnerRestaurant } from "@/lib/owner";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { runCampaign, segmentMembers } from "@/lib/booth/engine";
import { audienceFiltersSchema, isEmptyAudienceFilters, type AudienceFilters } from "@/lib/booth/audiences";
import { isTooFarInPast, staleSendingCutoffIso, wallTimeToUtc } from "@/lib/booth/schedule";
import type { CampaignAudience } from "@/lib/booth/types";
import { getRestaurantScheduleContext } from "./data";

export type CreateMessageInput = {
  audience: CampaignAudience;
  audienceFilters: AudienceFilters | null;
  body: string;
  programId: string | null;
  sendNow: boolean;
  // Wall-clock date/time parts from the composer — NEVER a client-computed
  // ISO instant (Codex #15). The server resolves these against the
  // restaurant's own timezone via wallTimeToUtc. Required when sendNow is false.
  scheduledDate: string | null; // "YYYY-MM-DD"
  scheduledTime: string | null; // "HH:mm"
};

export type CreateMessageResult =
  | { ok: true; sentCount: number | null }
  | { ok: false; error: string; failedCount?: number };

export async function createMessageAction(input: CreateMessageInput): Promise<CreateMessageResult> {
  const restaurant = await requireOwnerRestaurant();
  const body = input.body.trim();
  if (!body) return { ok: false, error: "Write a message first." };
  if (!input.sendNow && (!input.scheduledDate || !input.scheduledTime)) {
    return { ok: false, error: "Pick a date and time to schedule." };
  }

  const parsedFilters = audienceFiltersSchema.safeParse(input.audienceFilters ?? {});
  if (!parsedFilters.success) return { ok: false, error: "Invalid audience filters." };
  const audienceFilters = isEmptyAudienceFilters(parsedFilters.data) ? null : parsedFilters.data;

  const admin = createSupabaseAdminClient();
  const scheduleContext = await getRestaurantScheduleContext(restaurant.id);

  // Cross-tenant / attachable-type guard: an offer may only ride along on a
  // blast if it belongs to this restaurant, is currently active, and is one
  // of the two types meant to be pushed standalone (a ladder/welcome/birthday
  // program earns through the visit loop, not a message attachment).
  let programId: string | null = null;
  if (input.programId) {
    const { data: program, error: programError } = await admin
      .from("reward_programs")
      .select("id, restaurant_id, type, active")
      .eq("id", input.programId)
      .maybeSingle();
    if (programError) return { ok: false, error: programError.message };
    if (
      !program ||
      program.restaurant_id !== restaurant.id ||
      !program.active ||
      (program.type !== "anytime" && program.type !== "timed")
    ) {
      return { ok: false, error: "That offer can't be attached to this message." };
    }
    programId = program.id;
  }

  let scheduledFor: string;
  if (input.sendNow) {
    scheduledFor = new Date().toISOString();
  } else {
    // input.scheduledDate/scheduledTime checked non-null above.
    scheduledFor = wallTimeToUtc(input.scheduledDate as string, input.scheduledTime as string, scheduleContext.timezone);
    if (isTooFarInPast(scheduledFor)) {
      return { ok: false, error: "That time has already passed — pick a time in the future." };
    }
  }

  const { data: campaign, error } = await admin
    .from("campaigns")
    .insert({
      restaurant_id: restaurant.id,
      audience: input.audience,
      audience_filters: audienceFilters,
      body,
      program_id: programId,
      status: "scheduled",
      scheduled_for: scheduledFor,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/messages");

  if (!input.sendNow) return { ok: true, sentCount: null };

  return await sendNowAndReport(campaign.id);
}

/**
 * Runs the campaign and turns a mid-fan-out throw into a structured
 * {ok:false} instead of an uncaught rejection (Codex #16). runCampaign has
 * no internal try/catch around its per-recipient send, so a thrown error
 * leaves the campaign stuck in 'sending' with some recipients fanned out and
 * others not attempted yet — the cron's stale-claim sweep (see
 * api/cron/campaigns/route.ts) will retry it later; campaign_recipients'
 * idempotent upsert means retrying never double-sends.
 */
async function sendNowAndReport(campaignId: string): Promise<CreateMessageResult> {
  try {
    const result = await runCampaign(campaignId);
    revalidatePath("/dashboard/messages");
    revalidatePath("/dashboard/overview");
    return { ok: true, sentCount: result.sentCount };
  } catch (err) {
    revalidatePath("/dashboard/messages");
    const admin = createSupabaseAdminClient();
    // Best-effort attempt count: rows already fanned out that never got a
    // message_id are the recipient(s) mid-send when the error hit; everyone
    // after them in the segment never got a campaign_recipients row at all,
    // so this undercounts total intended recipients — it's the closest
    // signal available without engine.ts tracking failures itself.
    const { count } = await admin
      .from("campaign_recipients")
      .select("member_id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .is("message_id", null);
    const message = err instanceof Error ? err.message : "Something went wrong mid-send.";
    return {
      ok: false,
      error: `Sending was interrupted (${message}). It'll retry automatically within ~30 minutes — see History below.`,
      failedCount: count ?? undefined,
    };
  }
}

/**
 * Manual retry affordance for a stalled 'sending' campaign (Codex #16/#43
 * partial, #8 fix): resets it to 'scheduled' so runCampaign's own atomic
 * claim picks it back up — identical resume path the cron's stale sweep
 * uses. Safe to call on a campaign that isn't actually stuck: the reset
 * itself is a single conditional UPDATE gated on the SAME staleness cutoff
 * the cron uses (status='sending' AND scheduled_for < staleSendingCutoffIso()),
 * so a genuinely in-flight (non-stale) campaign — including one a
 * double-submitted or racing call is looking at right now — can never be
 * reclaimed: zero rows match the condition and we report "still sending"
 * instead of resetting it out from under the active runner. Once reclaimed,
 * campaign_recipients' idempotent insert (engine.ts) means no one is texted
 * twice for rows that already completed.
 */
export async function retryStalledCampaignAction(
  campaignId: string,
): Promise<{ ok: true; sentCount: number } | { ok: false; error: string }> {
  const restaurant = await requireOwnerRestaurant();
  const admin = createSupabaseAdminClient();

  const { data: campaign, error: fetchError } = await admin
    .from("campaigns")
    .select("id, restaurant_id")
    .eq("id", campaignId)
    .maybeSingle();
  if (fetchError) return { ok: false, error: fetchError.message };
  if (!campaign || campaign.restaurant_id !== restaurant.id) return { ok: false, error: "Message not found." };

  const { data: reclaimed, error: resetError } = await admin
    .from("campaigns")
    .update({ status: "scheduled" })
    .eq("id", campaignId)
    .eq("status", "sending")
    .lt("scheduled_for", staleSendingCutoffIso())
    .select("id");
  if (resetError) return { ok: false, error: resetError.message };
  if (!reclaimed || reclaimed.length === 0) return { ok: false, error: "This message is still sending." };

  const result = await sendNowAndReport(campaignId);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, sentCount: result.sentCount ?? 0 };
}

/** Live recount for the composer's "Narrow it down" panel — base segment + filters. */
export async function recountAudienceAction(
  audience: CampaignAudience,
  audienceFilters: AudienceFilters,
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const restaurant = await requireOwnerRestaurant();
  const parsedFilters = audienceFiltersSchema.safeParse(audienceFilters);
  if (!parsedFilters.success) return { ok: false, error: "Invalid audience filters." };
  const filters = isEmptyAudienceFilters(parsedFilters.data) ? null : parsedFilters.data;
  const members = await segmentMembers(restaurant.id, audience, filters);
  return { ok: true, count: members.length };
}
