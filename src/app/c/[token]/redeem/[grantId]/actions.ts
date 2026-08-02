"use server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { resolveMagicMember } from "../../data";
export type GrantPoll = { state: "earned" | "redeemed" | "expired" | "voided" | "invalid"; redeemedAt: string | null };
export async function pollGrant(token: string, grantId: string): Promise<GrantPoll> {
  const memberId = await resolveMagicMember(token, false); if (!memberId) return { state: "invalid", redeemedAt: null };
  const admin = createSupabaseAdminClient(); const { data, error } = await admin.from("reward_grants").select("state, redeemed_at, expires_at").eq("id", grantId).eq("member_id", memberId).maybeSingle();
  if (error) throw error; if (!data) return { state: "invalid", redeemedAt: null };
  if (data.state === "earned" && data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) return { state: "expired", redeemedAt: null };
  return { state: data.state, redeemedAt: data.redeemed_at };
}
