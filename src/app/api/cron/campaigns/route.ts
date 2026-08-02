import { runCampaign } from "@/lib/booth/engine";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { staleSendingCutoffIso } from "@/lib/booth/schedule";
import { requireCronAuth } from "../_lib";

/**
 * Stale-`sending` recovery (Codex #43 partial). The `campaigns` table (see
 * supabase/migrations/20260716000000_init.sql) has no `updated_at` column —
 * only `created_at`, `scheduled_for`, and `sent_at` — so there is no
 * timestamp that records *when* a row was claimed into 'sending'.
 * `scheduled_for` is the best schema-free proxy: it's set once at creation
 * (to the chosen send time, or now() for a send-now blast) and never
 * changes, so "still 'sending' more than STALE_SENDING_MINUTES past
 * scheduled_for" is a reasonable stand-in for "claimed a while ago and never
 * finished." Flagged limitation: a campaign with a very large recipient
 * list that's still on its first, legitimate run past that window would
 * also match and get reclaimed — reclaiming is safe either way (resets
 * status to 'scheduled' so runCampaign's atomic claim + campaign_recipients'
 * idempotent upsert take over; no one is texted twice), it just means the
 * "stalled" label can be a false positive for a genuinely slow send. A real
 * fix needs a migration (an updated_at column, or a claimed_at timestamp)
 * which is out of scope for this chunk.
 */
async function reclaimStaleSendingCampaigns(admin: ReturnType<typeof createSupabaseAdminClient>): Promise<string[]> {
  const cutoff = staleSendingCutoffIso();
  const { data: stale, error } = await admin
    .from("campaigns")
    .select("id")
    .eq("status", "sending")
    .lt("scheduled_for", cutoff);
  if (error) throw error;
  const ids = (stale ?? []).map((c) => c.id as string);
  if (ids.length === 0) return [];

  const { error: resetError } = await admin.from("campaigns").update({ status: "scheduled" }).in("id", ids);
  if (resetError) throw resetError;
  return ids;
}

export async function GET(req: Request) {
  const authError = requireCronAuth(req);
  if (authError) return authError;

  const admin = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();
  const reclaimedIds = await reclaimStaleSendingCampaigns(admin);

  const { data: due, error } = await admin
    .from("campaigns")
    .select("id")
    .eq("status", "scheduled")
    .lte("scheduled_for", nowIso);
  if (error) throw error;

  let processed = 0;
  let totalSent = 0;
  for (const c of due ?? []) {
    const result = await runCampaign(c.id as string);
    if (result.claimed) processed++;
    totalSent += result.sentCount;
  }

  return Response.json({ due: (due ?? []).length, processed, totalSent, reclaimed: reclaimedIds.length });
}
