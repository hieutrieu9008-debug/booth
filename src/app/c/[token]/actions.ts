"use server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { chooseGrantOption, setChoicePref, type ChooseGrantOptionResult, type SetChoicePrefResult } from "@/lib/booth/choice";
import { resolveMagicMember, setMemberSessionCookie } from "./data";

/** Card-token-scoped wrapper around chooseGrantOption — resolves the diner's own token to their member id first, so a diner can only ever choose on their own grants. */
export async function chooseRewardAction(token: string, grantId: string, optionIndex: number): Promise<ChooseGrantOptionResult> {
  const memberId = await resolveMagicMember(token, false);
  if (!memberId) return { ok: false, error: "This link has expired." };
  return chooseGrantOption({ grantId, memberId, optionIndex });
}

/** Card-token-scoped wrapper around setChoicePref (WS-E item 3) — same "resolve the diner's own token first" posture as chooseRewardAction above. */
export async function setChoicePrefAction(
  token: string,
  programId: string,
  rungVisits: number,
  cycle: number,
  optionReward: string,
): Promise<SetChoicePrefResult> {
  const memberId = await resolveMagicMember(token, false);
  if (!memberId) return { ok: false, error: "This link has expired." };
  return setChoicePref({ memberId, programId, rungVisits, cycle, optionReward });
}

/**
 * WS-B item 1: when /c/[token] resolves a valid member, establish the
 * bl_member session cookie so /v/[slug] (self check-in) can trust this
 * device later without a phone-number prompt. Called from a client effect
 * (see member-session-effect.tsx) rather than during page.tsx's render,
 * since cookies().set() only works inside a Server Action/Route Handler.
 * `touch: false` — the page's own resolveMagicMember(token) call already
 * touched last_used_at; this is a second read of the same token, not a new
 * visit.
 */
export async function establishMemberSession(token: string): Promise<void> {
  const memberId = await resolveMagicMember(token, false);
  if (!memberId) return;
  const admin = createSupabaseAdminClient();
  const { data: member, error } = await admin.from("members").select("restaurant_id").eq("id", memberId).maybeSingle();
  if (error) throw error;
  if (!member) return;
  await setMemberSessionCookie(memberId, member.restaurant_id);
}
