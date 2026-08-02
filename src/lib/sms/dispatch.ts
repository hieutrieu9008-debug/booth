import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { getProvider } from "./provider";
import { isQuietForMarketing, nextMarketingWindowOpen } from "./quiet-hours";

/**
 * THE single choke point for outbound messages. Nothing else in this codebase
 * may talk to an SMS provider. The compliance floor lives here and is
 * hard-coded platform behavior — never per-tenant-overridable (PRD).
 *
 *   transactional (welcome, card links, redemption confirmations):
 *     - suppressed only by opt-out
 *     - sends immediately, quiet hours DO NOT apply
 *   marketing (reward-earned nudges, birthday, come-back, blasts):
 *     - suppressed by opt-out (STOP is instant: members.opted_out is checked
 *       at send time, and again at queue-flush time)
 *     - deferred to the next window opening when inside quiet hours
 */

export type DispatchResult =
  | { status: "sent"; messageId: string }
  | { status: "simulated"; messageId: string }
  | { status: "queued"; messageId: string; notBefore: string }
  | { status: "suppressed_optout" }
  | { status: "failed"; messageId: string; error: string };

type DispatchArgs = {
  restaurantId: string;
  memberId: string;
  body: string;
  campaignId?: string | null;
};

export async function sendTransactional(args: DispatchArgs): Promise<DispatchResult> {
  return dispatch({ ...args, kind: "transactional" });
}

export async function sendMarketing(args: DispatchArgs): Promise<DispatchResult> {
  return dispatch({ ...args, kind: "marketing" });
}

type ComplianceReplyArgs = {
  restaurantId: string;
  memberId?: string | null;
  to: string;
  from: string | null;
  body: string;
};

/**
 * Narrowly-scoped choke point for the STOP/HELP acknowledgement replies in
 * src/app/api/sms/inbound/route.ts — nothing else may call this. Exempt from
 * BOTH compliance floors that gate sendTransactional/sendMarketing:
 *   - opt-out suppression: a STOP acknowledgement is regulatory (the sender
 *     must be told their opt-out registered) and, by definition, fires for a
 *     member who has JUST opted out — the normal FLOOR 1 check would
 *     wrongly swallow exactly the reply it needs to deliver.
 *   - quiet hours: STOP/HELP replies are a direct response to an inbound
 *     message the person just sent, not an unsolicited marketing nudge.
 * Still goes through the provider + logs to `messages` like every other
 * send, so it never bypasses the "ALL outbound SMS goes through dispatch.ts"
 * choke point or the audit trail.
 */
export async function sendComplianceReply(args: ComplianceReplyArgs): Promise<DispatchResult> {
  const admin = createSupabaseAdminClient();
  const provider = getProvider();
  const result = await provider.send(args.to, args.body, args.from);
  const status = !result.ok ? "failed" : provider.name === "simulated" ? "simulated" : "sent";

  const { data: row, error } = await admin
    .from("messages")
    .insert({
      restaurant_id: args.restaurantId,
      member_id: args.memberId ?? null,
      direction: "outbound",
      kind: "transactional",
      body: args.body,
      status,
      provider_sid: result.ok ? result.providerSid : null,
    })
    .select("id")
    .single();
  if (error || !row) return { status: "failed", messageId: "", error: error?.message ?? "log insert failed" };

  if (!result.ok) return { status: "failed", messageId: row.id, error: result.error };
  return status === "simulated"
    ? { status: "simulated", messageId: row.id }
    : { status: "sent", messageId: row.id };
}

async function dispatch(
  args: DispatchArgs & { kind: "transactional" | "marketing" },
): Promise<DispatchResult> {
  const admin = createSupabaseAdminClient();

  const [{ data: member }, { data: restaurant }] = await Promise.all([
    admin.from("members").select("id, phone, opted_out, restaurant_id").eq("id", args.memberId).single(),
    admin
      .from("restaurants")
      .select("id, timezone, quiet_hours_start, quiet_hours_end, sms_from")
      .eq("id", args.restaurantId)
      .single(),
  ]);
  if (!member || !restaurant) {
    return { status: "failed", messageId: "", error: "member or restaurant not found" };
  }
  // Cross-tenant guard: a member may only ever be messaged by their own restaurant.
  if (member.restaurant_id !== restaurant.id) {
    return { status: "failed", messageId: "", error: "member does not belong to restaurant" };
  }

  // FLOOR 1 — opt-out is absolute for every kind.
  if (member.opted_out) {
    await admin.from("messages").insert({
      restaurant_id: args.restaurantId,
      member_id: args.memberId,
      campaign_id: args.campaignId ?? null,
      direction: "outbound",
      kind: args.kind,
      body: args.body,
      status: "suppressed",
    });
    return { status: "suppressed_optout" };
  }

  // FLOOR 2 — quiet hours defer marketing (transactional exempt). Uses the
  // floor-aware check: tenant quiet_hours_start/end may only widen the
  // platform's 20:00-08:00 floor, never narrow it (AGENTS.md compliance floor).
  if (
    args.kind === "marketing" &&
    isQuietForMarketing(restaurant.quiet_hours_start, restaurant.quiet_hours_end, restaurant.timezone)
  ) {
    const notBefore = nextMarketingWindowOpen(
      restaurant.quiet_hours_start,
      restaurant.quiet_hours_end,
      restaurant.timezone,
    ).toISOString();
    const { data: row, error } = await admin
      .from("messages")
      .insert({
        restaurant_id: args.restaurantId,
        member_id: args.memberId,
        campaign_id: args.campaignId ?? null,
        direction: "outbound",
        kind: "marketing",
        body: args.body,
        status: "queued",
        not_before: notBefore,
      })
      .select("id")
      .single();
    if (error || !row) return { status: "failed", messageId: "", error: error?.message ?? "insert failed" };
    return { status: "queued", messageId: row.id, notBefore };
  }

  return sendNow(admin, { ...args, phone: member.phone, smsFrom: restaurant.sms_from });
}

async function sendNow(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  args: DispatchArgs & { kind: "transactional" | "marketing"; phone: string; smsFrom: string | null },
): Promise<DispatchResult> {
  const provider = getProvider();
  const result = await provider.send(args.phone, args.body, args.smsFrom);
  const status = !result.ok ? "failed" : provider.name === "simulated" ? "simulated" : "sent";

  const { data: row, error } = await admin
    .from("messages")
    .insert({
      restaurant_id: args.restaurantId,
      member_id: args.memberId,
      campaign_id: args.campaignId ?? null,
      direction: "outbound",
      kind: args.kind,
      body: args.body,
      status,
      provider_sid: result.ok ? result.providerSid : null,
    })
    .select("id")
    .single();
  if (error || !row) return { status: "failed", messageId: "", error: error?.message ?? "log insert failed" };

  if (!result.ok) return { status: "failed", messageId: row.id, error: result.error };
  return status === "simulated"
    ? { status: "simulated", messageId: row.id }
    : { status: "sent", messageId: row.id };
}

/**
 * Queue flush — called by the cron. Re-checks opt-out AND quiet hours per
 * message (a member may have STOPped since queueing; a queue backlog must
 * never leak into the next quiet window).
 */
export async function flushQueued(limit = 200): Promise<{ sent: number; suppressed: number; deferred: number }> {
  const admin = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();
  const counters = { sent: 0, suppressed: 0, deferred: 0 };

  const { data: due } = await admin
    .from("messages")
    .select("id, restaurant_id, member_id, campaign_id, body, kind")
    .eq("status", "queued")
    .lte("not_before", nowIso)
    .limit(limit);

  for (const msg of due ?? []) {
    if (!msg.member_id) continue;
    // Claim the row first so two overlapping cron runs can't double-send.
    const { data: claimed } = await admin
      .from("messages")
      .update({ status: "sent" }) // provisional; corrected below
      .eq("id", msg.id)
      .eq("status", "queued")
      .select("id");
    if (!claimed || claimed.length === 0) continue;

    const [{ data: member }, { data: restaurant }] = await Promise.all([
      admin.from("members").select("phone, opted_out").eq("id", msg.member_id).single(),
      admin
        .from("restaurants")
        .select("timezone, quiet_hours_start, quiet_hours_end, sms_from")
        .eq("id", msg.restaurant_id)
        .single(),
    ]);
    if (!member || !restaurant) {
      await admin.from("messages").update({ status: "failed" }).eq("id", msg.id);
      continue;
    }
    if (member.opted_out) {
      await admin.from("messages").update({ status: "suppressed" }).eq("id", msg.id);
      counters.suppressed++;
      continue;
    }
    if (
      msg.kind === "marketing" &&
      isQuietForMarketing(restaurant.quiet_hours_start, restaurant.quiet_hours_end, restaurant.timezone)
    ) {
      const notBefore = nextMarketingWindowOpen(
        restaurant.quiet_hours_start,
        restaurant.quiet_hours_end,
        restaurant.timezone,
      ).toISOString();
      await admin.from("messages").update({ status: "queued", not_before: notBefore }).eq("id", msg.id);
      counters.deferred++;
      continue;
    }

    const provider = getProvider();
    const result = await provider.send(member.phone, msg.body, restaurant.sms_from);
    await admin
      .from("messages")
      .update({
        status: !result.ok ? "failed" : provider.name === "simulated" ? "simulated" : "sent",
        provider_sid: result.ok ? result.providerSid : null,
      })
      .eq("id", msg.id);
    if (result.ok) counters.sent++;
  }

  return counters;
}
