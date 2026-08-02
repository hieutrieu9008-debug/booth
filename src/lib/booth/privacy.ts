import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import type { Event, Member, MemberProgress, RewardGrant } from "./types";

// Task C: UK GDPR diner data rights (export + erasure). Every query here
// filters on both member_id AND restaurant_id — a member row belonging to
// another tenant must never leak into, or be reachable through, either
// operation below.

export type MessageRow = {
  id: string;
  restaurant_id: string;
  member_id: string | null;
  campaign_id: string | null;
  direction: "outbound" | "inbound";
  kind: "transactional" | "marketing";
  channel: string;
  body: string;
  status: string;
  not_before: string | null;
  provider_sid: string | null;
  created_at: string;
};

export type ConsentEventRow = {
  id: string;
  restaurant_id: string;
  member_id: string;
  action: "join" | "rejoin" | "optin_sms" | "optout_sms";
  consent_version: string;
  wording: string;
  source: string;
  created_at: string;
};

export type MemberDataExport = {
  exportedAt: string;
  member: Member;
  memberProgress: MemberProgress[];
  rewardGrants: RewardGrant[];
  events: Event[];
  messages: MessageRow[];
  consentEvents: ConsentEventRow[];
};

/** Everything Booth holds on one diner, tenant-scoped. Null if the member doesn't exist or belongs to another restaurant. */
export async function exportMemberData(restaurantId: string, memberId: string): Promise<MemberDataExport | null> {
  const admin = createSupabaseAdminClient();

  const { data: member, error: memberError } = await admin
    .from("members")
    .select("*")
    .eq("id", memberId)
    .eq("restaurant_id", restaurantId)
    .maybeSingle();
  if (memberError) throw memberError;
  if (!member) return null;

  const [progressRes, grantsRes, eventsRes, messagesRes, consentRes] = await Promise.all([
    admin.from("member_progress").select("*").eq("member_id", memberId).eq("restaurant_id", restaurantId),
    admin.from("reward_grants").select("*").eq("member_id", memberId).eq("restaurant_id", restaurantId),
    admin.from("events").select("*").eq("member_id", memberId).eq("restaurant_id", restaurantId),
    admin.from("messages").select("*").eq("member_id", memberId).eq("restaurant_id", restaurantId),
    admin.from("consent_events").select("*").eq("member_id", memberId).eq("restaurant_id", restaurantId),
  ]);
  for (const res of [progressRes, grantsRes, eventsRes, messagesRes, consentRes]) if (res.error) throw res.error;

  return {
    exportedAt: new Date().toISOString(),
    member: member as Member,
    memberProgress: (progressRes.data ?? []) as MemberProgress[],
    rewardGrants: (grantsRes.data ?? []) as RewardGrant[],
    events: (eventsRes.data ?? []) as Event[],
    messages: (messagesRes.data ?? []) as MessageRow[],
    consentEvents: (consentRes.data ?? []) as ConsentEventRow[],
  };
}

export type EraseMemberResult = { status: "erased"; suppressedPhone: boolean } | { status: "not_found" };

/**
 * Deletes a member and everything tied to them. Every other table
 * referencing members(id, restaurant_id) cascades (member_progress, events,
 * reward_grants, campaign_recipients, magic_tokens, consent_events — all
 * `on delete cascade`, verified against supabase/migrations/20260716000000_
 * init.sql + 20260722000000_consent_events.sql) — EXCEPT messages, whose FK
 * is `on delete set null` (init migration), so it's deleted explicitly
 * first. If the member was opted out at the moment of erasure, their phone
 * is suppressed (supabase/migrations/20260722000001_suppressed_phones.sql)
 * so a later staff re-add can't silently re-text them.
 */
export async function eraseMember(restaurantId: string, memberId: string): Promise<EraseMemberResult> {
  const admin = createSupabaseAdminClient();

  const { data: member, error: memberError } = await admin
    .from("members")
    .select("id, phone, opted_out")
    .eq("id", memberId)
    .eq("restaurant_id", restaurantId)
    .maybeSingle();
  if (memberError) throw memberError;
  if (!member) return { status: "not_found" };

  const suppressedPhone = member.opted_out;
  if (suppressedPhone) {
    const { error: suppressError } = await admin
      .from("suppressed_phones")
      .upsert(
        { restaurant_id: restaurantId, phone: member.phone, reason: "erased_while_opted_out" },
        { onConflict: "restaurant_id,phone" }
      );
    if (suppressError) throw suppressError;
  }

  const { error: messagesError } = await admin
    .from("messages")
    .delete()
    .eq("member_id", memberId)
    .eq("restaurant_id", restaurantId);
  if (messagesError) throw messagesError;

  const { error: deleteError } = await admin
    .from("members")
    .delete()
    .eq("id", memberId)
    .eq("restaurant_id", restaurantId);
  if (deleteError) throw deleteError;

  return { status: "erased", suppressedPhone };
}
