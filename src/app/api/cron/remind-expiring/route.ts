import { createMemberCardLink } from "@/lib/booth/links";
import { parseRestaurantSettings } from "@/lib/booth/settings";
import { withStopSuffix } from "@/lib/booth/template";
import { sendMarketing } from "@/lib/sms/dispatch";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireCronAuth } from "../_lib";

const REMINDER_CAP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function formatExpiryDay(value: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" }).format(new Date(value));
}

/**
 * Daily, scheduled to run after expire-grants (vercel.json): nudges members
 * whose earned grant expires soon and hasn't been reminded yet. Runs
 * per-restaurant since the reminder window (settings.expiry_reminder_days,
 * default 3) is tenant-configurable.
 *
 * Dedupe (#11): the grant is claimed — reminder_sent_at set — BEFORE link
 * creation or send is attempted, via an atomic UPDATE ... WHERE
 * reminder_sent_at IS NULL, so two overlapping cron runs can never both
 * process the same grant. Unlike the old code, the claim is not final: if
 * the send outcome is a transient failure or link/send throws, the claim is
 * RELEASED (reminder_sent_at set back to null) so a later run gets to retry
 * the one reminder this grant is owed, instead of the failure silently
 * consuming it forever. Suppressed-by-opt-out is the one outcome that keeps
 * the claim — re-consenting later doesn't entitle a retroactive reminder for
 * a grant that was already due when the member was opted out.
 *
 * Cap (#12): at most one reminder text per member per 7 days. supabase-js
 * can't express "claim WHERE NOT EXISTS(other recent reminder)" as one
 * atomic UPDATE, and no new migrations are allowed this round, so this
 * claims first, then re-checks the cap against every OTHER grant of the same
 * member. If the cap was violated, the claim is released (not finalized) and
 * the grant is left claimable again once the window passes. This closes the
 * old race (count-then-claim let two concurrent runs both pass the count
 * check and then both claim+send) for two runs racing the SAME grant; two
 * runs racing two DIFFERENT due grants for the same member in the same
 * instant is a narrower residual race this doesn't fully close (both could
 * claim+re-check before either's claim is visible to the other) — documented
 * as best-effort per spec, not solved, since only an RPC/single-statement
 * form could close it completely.
 */
export async function GET(req: Request) {
  const authError = requireCronAuth(req);
  if (authError) return authError;

  const admin = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();
  const counters = { sent: 0, skippedCapped: 0 };

  const { data: restaurants, error: restaurantsError } = await admin.from("restaurants").select("id, name, settings");
  if (restaurantsError) throw restaurantsError;

  for (const restaurant of restaurants ?? []) {
    const { expiry_reminder_days } = parseRestaurantSettings(restaurant.settings);
    const thresholdIso = new Date(Date.now() + expiry_reminder_days * 24 * 60 * 60 * 1000).toISOString();

    const { data: grants, error: grantsError } = await admin
      .from("reward_grants")
      .select("id, member_id, reward_text, expires_at")
      .eq("restaurant_id", restaurant.id)
      .eq("state", "earned")
      .not("expires_at", "is", null)
      .lte("expires_at", thresholdIso)
      .gt("expires_at", nowIso)
      .is("reminder_sent_at", null);
    if (grantsError) throw grantsError;
    if (!grants || grants.length === 0) continue;

    for (const grant of grants) {
      if (!grant.expires_at) continue; // narrows for TS; excluded by the query above anyway

      // Atomic per-grant claim FIRST — guards against a concurrent run
      // double-sending this exact grant, and reserves this member's weekly
      // slot before the cap re-check below.
      const { data: claimed, error: claimError } = await admin
        .from("reward_grants")
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq("id", grant.id)
        .is("reminder_sent_at", null)
        .select("id");
      if (claimError) throw claimError;
      if (!claimed || claimed.length === 0) continue; // another run already claimed it

      const capCutoff = new Date(Date.now() - REMINDER_CAP_WINDOW_MS).toISOString();
      const { count: recentReminderCount, error: capError } = await admin
        .from("reward_grants")
        .select("id", { count: "exact", head: true })
        .eq("member_id", grant.member_id)
        .neq("id", grant.id)
        .gte("reminder_sent_at", capCutoff);
      if (capError) throw capError;
      if ((recentReminderCount ?? 0) > 0) {
        counters.skippedCapped++;
        // Release: this grant is still genuinely un-reminded — a later run,
        // once the other grant's reminder ages out of the 7-day window,
        // should be free to claim and send it.
        await admin.from("reward_grants").update({ reminder_sent_at: null }).eq("id", grant.id);
        continue;
      }

      try {
        const cardLink = await createMemberCardLink(grant.member_id);
        const body = withStopSuffix(
          `${restaurant.name}: your ${grant.reward_text} expires ${formatExpiryDay(grant.expires_at)} — show your card to use it → ${cardLink}`,
        );
        const result = await sendMarketing({ restaurantId: restaurant.id, memberId: grant.member_id, body });
        if (result.status === "suppressed_optout") {
          // Keep the claim — see docstring above.
          continue;
        }
        if (result.status === "failed") {
          await admin.from("reward_grants").update({ reminder_sent_at: null }).eq("id", grant.id);
          continue;
        }
        counters.sent++;
      } catch (caught) {
        // Link creation (or anything else) threw before a definite send
        // outcome: release the claim for the same reason as the "failed"
        // branch above — a transient error shouldn't permanently consume
        // this grant's one reminder — then keep sweeping the rest of the
        // restaurant's due grants instead of aborting the whole run.
        console.error("remind-expiring: releasing claim after error", grant.id, caught);
        await admin.from("reward_grants").update({ reminder_sent_at: null }).eq("id", grant.id);
      }
    }
  }

  return Response.json(counters);
}
