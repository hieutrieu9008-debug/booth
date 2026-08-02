"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwnerRestaurant } from "@/lib/owner";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { getOrCreateCustomBucket } from "@/lib/booth/rewards";
import { newRewardToken } from "@/lib/booth/tokens";
import { notifyRewardOnCard, sendOneMemberMessage } from "@/lib/booth/member-messaging";
import { eraseMember } from "@/lib/booth/privacy";

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Cross-tenant guard mirrors messages/actions.ts's program ownership check: a member may only ever be acted on by their own restaurant. */
async function ownedMember(memberId: string) {
  const restaurant = await requireOwnerRestaurant();
  const admin = createSupabaseAdminClient();
  const { data: member, error } = await admin
    .from("members")
    .select("id, restaurant_id, name, opted_out")
    .eq("id", memberId)
    .maybeSingle();
  if (error) throw error;
  if (!member || member.restaurant_id !== restaurant.id) return null;
  return { restaurant, admin, member };
}

/**
 * One-off text to a single member from their profile page. This Server
 * Action is only an authenticated adapter (Codex #10): it resolves and
 * owns-checks the restaurant/member, then hands off to
 * src/lib/booth/member-messaging.ts for the actual copy/dispatch/failure-
 * mapping decisions — the same module every one-member send in this app
 * goes through.
 */
export async function sendMemberMessageAction(memberId: string, body: string): Promise<ActionResult> {
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, error: "Write a message first." };

  const owned = await ownedMember(memberId);
  if (!owned) return { ok: false, error: "Member not found." };
  const { restaurant, member } = owned;

  const result = await sendOneMemberMessage(restaurant, member.id, trimmed);
  revalidatePath(`/dashboard/members/${memberId}`);
  return result;
}

/**
 * One-off, owner-authored reward for a single member — grant-parented to
 * this restaurant's hidden 'custom' bucket program (getOrCreateCustomBucket),
 * never a real live-offer program. `expiresAt`, if given, is an ISO instant;
 * omitted means no expiry. The grant is still created even if the member is
 * opted out (it's a real reward on their card) — only the notification text
 * (member-messaging.ts's notifyRewardOnCard) is subject to the compliance
 * floor.
 */
export async function createCustomOfferAction(memberId: string, rewardText: string, expiresAt?: string): Promise<ActionResult> {
  const reward = rewardText.trim();
  if (!reward) return { ok: false, error: "Write the reward text first." };

  const owned = await ownedMember(memberId);
  if (!owned) return { ok: false, error: "Member not found." };
  const { restaurant, admin, member } = owned;

  const bucketProgramId = await getOrCreateCustomBucket(restaurant.id);
  const { error: insertError } = await admin.from("reward_grants").insert({
    restaurant_id: restaurant.id,
    member_id: member.id,
    program_id: bucketProgramId,
    reward_text: reward,
    state: "earned",
    one_use_token: newRewardToken(),
    grant_slot: `custom:${randomUUID()}`,
    expires_at: expiresAt ?? null,
    earned_at: new Date().toISOString(),
  });
  if (insertError) return { ok: false, error: insertError.message };

  const result = await notifyRewardOnCard(restaurant, member.id, reward);
  revalidatePath(`/dashboard/members/${memberId}`);
  return result;
}

/**
 * Owner-triggered erasure (Task C, UK GDPR right to erasure) — deletes the
 * member and everything tied to them via src/lib/booth/privacy.ts
 * eraseMember, then redirects to the members list. redirect() throws, so on
 * success this never returns; the ActionResult return type only covers the
 * failure paths the caller needs to render inline.
 */
export async function eraseMemberAction(memberId: string): Promise<ActionResult> {
  const owned = await ownedMember(memberId);
  if (!owned) return { ok: false, error: "Member not found." };
  const { restaurant } = owned;

  const result = await eraseMember(restaurant.id, memberId);
  if (result.status === "not_found") return { ok: false, error: "Member not found." };

  revalidatePath("/dashboard/members");
  redirect("/dashboard/members");
}
