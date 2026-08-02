import { staleSendingCutoffIso } from "@/lib/booth/schedule";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireCronAuth } from "../_lib";

/**
 * Daily send-health check (Plan V3 WS-H.6). Surfaces the two silent failure
 * modes an operator must catch: campaigns stuck in 'sending' past the stale
 * cutoff, and messages that failed in the last 24h. Result is logged to
 * audit_log (actor 'system') and returned as JSON for the cron dashboard.
 * Human delivery channel (email/SMS to the operator) is a production-launch
 * decision — until then, Vercel cron logs + /internal are the read path
 * (documented in RUNBOOK-WHITE-GLOVE.md).
 */
export async function GET(req: Request) {
  const authError = requireCronAuth(req);
  if (authError) return authError;

  const admin = createSupabaseAdminClient();
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [{ count: stalled }, { count: failed }] = await Promise.all([
    admin
      .from("campaigns")
      .select("id", { count: "exact", head: true })
      .eq("status", "sending")
      .lt("scheduled_for", staleSendingCutoffIso()),
    admin
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("direction", "outbound")
      .eq("status", "failed")
      .gte("created_at", dayAgo),
  ]);

  const healthy = (stalled ?? 0) === 0 && (failed ?? 0) === 0;
  await admin.from("audit_log").insert({
    restaurant_id: null,
    actor: "system",
    action: "health.daily",
    detail: { stalled_campaigns: stalled ?? 0, failed_messages_24h: failed ?? 0, healthy },
  });

  return Response.json({ healthy, stalledCampaigns: stalled ?? 0, failedMessages24h: failed ?? 0 });
}
