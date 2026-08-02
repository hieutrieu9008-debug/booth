import "server-only";
import { createMemberCardLink } from "./links";
import { sendMarketing } from "@/lib/sms/dispatch";

/**
 * Codex #10 — one-member messaging + extension-notice orchestration, pulled
 * out of dashboard Server Actions (src/app/dashboard/members/actions.ts,
 * src/app/dashboard/rewards/actions.ts) into the domain layer they belong
 * in, matching ARCHITECTURE.md's rule that dashboard actions must not own
 * copy/dispatch decisions directly. This module owns: STOP-suffix copy,
 * member-card link creation, the dispatch call (sendMarketing — same
 * compliance floor as every other marketing send), and DispatchResult ->
 * owner-facing failure-message mapping. Dashboard Server Actions stay
 * authenticated adapters: they resolve/own-check the restaurant + member,
 * then call one of these.
 *
 * Must never: call an SMS provider directly, or skip the STOP suffix — both
 * would violate the same compliance floor dispatch.ts enforces everywhere
 * else (AGENTS.md).
 */

const STOP_SUFFIX = " Reply STOP to opt out.";
function withStopSuffix(body: string): string {
  return body.includes("Reply STOP to opt out.") ? body : `${body}${STOP_SUFFIX}`;
}

export type MemberMessageResult = { ok: true } | { ok: false; error: string };

/** One-off text to a single member (owner-authored, from their profile page) — same compliance floor as the campaign composer. */
export async function sendOneMemberMessage(
  restaurant: { id: string; name: string },
  memberId: string,
  body: string,
): Promise<MemberMessageResult> {
  const result = await sendMarketing({ restaurantId: restaurant.id, memberId, body: withStopSuffix(body) });
  if (result.status === "failed") return { ok: false, error: result.error };
  if (result.status === "suppressed_optout") return { ok: false, error: "This member has opted out — nothing was sent." };
  return { ok: true };
}

/**
 * Texts a member that a specific reward is now on their card (custom
 * offer). Unlike sendOneMemberMessage, the reward itself is already
 * committed by the caller before this runs — a failed/suppressed text is
 * reported as a partial success, not a full failure, so the caller's
 * "ok: false" here still means the grant exists.
 */
export async function notifyRewardOnCard(
  restaurant: { id: string; name: string },
  memberId: string,
  rewardText: string,
): Promise<MemberMessageResult> {
  const cardLink = await createMemberCardLink(memberId);
  const body = withStopSuffix(`${restaurant.name}: ${rewardText} is on your card → ${cardLink}`);
  const result = await sendMarketing({ restaurantId: restaurant.id, memberId, body });
  if (result.status === "failed") return { ok: false, error: `Offer added, but the text failed to send: ${result.error}` };
  if (result.status === "suppressed_optout") {
    return { ok: false, error: "Offer added to their card, but no text was sent — this member has opted out." };
  }
  return { ok: true };
}

const formatExpiryDate = (v: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(v));

/** Best-effort extension notice — never throws; the extend itself is already committed by the caller before this is invoked. */
export async function notifyGrantExtended(
  restaurant: { id: string; name: string },
  memberId: string,
  rewardText: string,
  newExpiresAt: string,
): Promise<void> {
  try {
    const cardLink = await createMemberCardLink(memberId);
    await sendMarketing({
      restaurantId: restaurant.id,
      memberId,
      body: `Good news — your ${rewardText} now expires ${formatExpiryDate(newExpiresAt)}, still on your card → ${cardLink}`,
    });
  } catch {
    // Extension already committed; a failed notice text isn't worth failing the action for.
  }
}
