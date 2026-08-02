import "server-only";
import { ZodError } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { parseProgramConfig, joinPageSchema } from "@/lib/booth/programs";
import type { RestaurantType } from "@/lib/booth/types";
import { provisionNumber } from "@/app/internal/[slug]/actions";
import type { GeneratedSetup } from "./schema";

const PROGRAM_TYPES: RestaurantType[] = ["welcome", "visit_ladder", "birthday", "come_back"];
const STOP_LINE = "Reply STOP to opt out.";

export type ApplyResult =
  | { ok: true; programCount: number; campaignCount: number; numberNotice?: string }
  | { ok: false; conflict: true; existingTypes: RestaurantType[] }
  | { ok: false; conflict: false; errors: Record<string, string> };

/** null/empty ring_up_note in the draft -> undefined (the real schema's optional().min(1) rejects ""). */
function cleanNote(note: string | null): string | undefined {
  return note && note.trim().length > 0 ? note : undefined;
}

/**
 * `goneQuietWeeks`: only used for come_back — the draft schema doesn't ask
 * the AI/manual draft for a days-quiet threshold (intake notes never
 * establish one), so the single drafted block borrows the restaurant's
 * current gone_quiet_weeks setting, same source the Plan V2 migration's data
 * conversion uses for pre-existing tenants.
 */
export function toRealConfig(type: RestaurantType, entry: { name: string; config: unknown }, goneQuietWeeks: number) {
  switch (type) {
    case "welcome": {
      const config = entry.config as { reward: string; ring_up_note: string | null; valid_days: number };
      return { reward: config.reward, ring_up_note: cleanNote(config.ring_up_note), valid_days: config.valid_days };
    }
    case "visit_ladder": {
      const config = entry.config as {
        endowed_start: number;
        loop: boolean;
        rungs: { visits: number; options: { reward: string; ring_up_note: string | null }[] }[];
      };
      return {
        endowed_start: config.endowed_start,
        loop: config.loop,
        rungs: config.rungs.map((r) => ({
          visits: r.visits,
          options: r.options.map((o) => ({ reward: o.reward, ring_up_note: cleanNote(o.ring_up_note) })),
        })),
      };
    }
    case "birthday": {
      const config = entry.config as { reward: string; mode: "window"; window_days: number };
      return { reward: config.reward, mode: config.mode, window_days: config.window_days };
    }
    case "come_back": {
      const config = entry.config as { blocks: { id: string; reward: string; valid_days: number }[] };
      const block = config.blocks[0];
      return {
        blocks: [{ id: block.id, days_quiet: goneQuietWeeks * 7, reward: block.reward, valid_days: block.valid_days }],
        min_days_between_contact: 10,
      };
    }
    default:
      throw new Error(`unsupported type ${type}`);
  }
}

/**
 * Validates every config through parseProgramConfig (the real, refined
 * schemas), checks for existing active programs of the same types, then
 * inserts reward_programs (active) + campaigns (draft) rows.
 *
 * Idempotent-ish: a second apply without replaceExisting=true returns a
 * conflict listing the types already active, so the caller can show a
 * confirm dialog. replaceExisting=true deactivates (not deletes) the old
 * rows of those types before inserting the new set.
 */
export async function applyGeneratedSetup(
  restaurantId: string,
  draft: GeneratedSetup,
  opts: { replaceExisting: boolean }
): Promise<ApplyResult> {
  const errors: Record<string, string> = {};
  const validatedConfig = new Map<RestaurantType, unknown>();

  const admin = createSupabaseAdminClient();
  const { data: restaurantRow, error: restaurantError } = await admin
    .from("restaurants")
    .select("gone_quiet_weeks")
    .eq("id", restaurantId)
    .single();
  if (restaurantError) throw restaurantError;
  const goneQuietWeeks = restaurantRow.gone_quiet_weeks as number;

  const entries: [RestaurantType, GeneratedSetup["welcome" | "ladder" | "birthday" | "come_back"]][] = [
    ["welcome", draft.welcome],
    ["visit_ladder", draft.ladder],
    ["birthday", draft.birthday],
    ["come_back", draft.come_back],
  ];

  for (const [type, entry] of entries) {
    if (!entry.name.trim()) {
      errors[type] = "Name is required.";
      continue;
    }
    try {
      const config = toRealConfig(type, entry, goneQuietWeeks);
      parseProgramConfig(type, config);
      validatedConfig.set(type, config);
    } catch (caught) {
      errors[type] = caught instanceof ZodError ? caught.issues.map((i) => i.message).join("; ") : String(caught);
    }
  }

  draft.campaigns.forEach((c, i) => {
    if (!c.body.includes(STOP_LINE)) errors[`campaign_${i}`] = `Must end with "${STOP_LINE}"`;
    else if (c.body.length > 160) errors[`campaign_${i}`] = `Too long (${c.body.length}/160 chars).`;
  });

  let joinPageValue: unknown = undefined;
  if (draft.join_page !== null) {
    const joinPageResult = joinPageSchema.safeParse(draft.join_page);
    if (!joinPageResult.success) errors.join_page = joinPageResult.error.issues.map((i) => i.message).join("; ");
    else joinPageValue = joinPageResult.data;
  }

  if (Object.keys(errors).length > 0) return { ok: false, conflict: false, errors };

  if (!opts.replaceExisting) {
    const { data: existing, error } = await admin
      .from("reward_programs")
      .select("type")
      .eq("restaurant_id", restaurantId)
      .eq("active", true)
      .in("type", PROGRAM_TYPES);
    if (error) throw error;
    const existingTypes = [...new Set((existing ?? []).map((r) => r.type as RestaurantType))];
    if (existingTypes.length > 0) return { ok: false, conflict: true, existingTypes };
  } else {
    const { error } = await admin
      .from("reward_programs")
      .update({ active: false })
      .eq("restaurant_id", restaurantId)
      .eq("active", true)
      .in("type", PROGRAM_TYPES);
    if (error) throw error;
  }

  const programRows = entries.map(([type, entry]) => ({
    restaurant_id: restaurantId,
    type,
    name: entry.name,
    active: true,
    config: validatedConfig.get(type),
  }));
  const { error: programError } = await admin.from("reward_programs").insert(programRows);
  if (programError) throw programError;

  const campaignRows = draft.campaigns.map((c) => ({
    restaurant_id: restaurantId,
    audience: c.audience,
    body: c.body,
    status: "draft" as const,
  }));
  const { error: campaignError } = await admin.from("campaigns").insert(campaignRows);
  if (campaignError) throw campaignError;

  if (joinPageValue !== undefined) {
    const { error: joinPageError } = await admin.from("restaurants").update({ join_page: joinPageValue }).eq("id", restaurantId);
    if (joinPageError) throw joinPageError;
  }

  // Auto-attempt one-touch number provisioning (M8): best-effort only — a
  // failure here (provider not connected, no numbers, provider API error)
  // must never fail the apply itself, it just surfaces as a notice.
  let numberNotice: string | undefined;
  try {
    const { data: restaurantRow } = await admin.from("restaurants").select("sms_from").eq("id", restaurantId).maybeSingle();
    if (restaurantRow && !restaurantRow.sms_from) {
      const provisionResult = await provisionNumber(restaurantId);
      if (!provisionResult.ok) {
        numberNotice = `Setup applied. Number purchase skipped: ${provisionResult.reason}`;
      }
    }
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    numberNotice = `Setup applied. Number purchase skipped: ${message}`;
  }

  return { ok: true, programCount: programRows.length, campaignCount: campaignRows.length, numberNotice };
}
