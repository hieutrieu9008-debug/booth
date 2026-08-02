import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { localYMD, segmentMembers } from "@/lib/booth/engine";
import { describeAudienceFilters, type AudienceFilters } from "@/lib/booth/audiences";
import { isStaleSending } from "@/lib/booth/schedule";
import type { Campaign, CampaignAudience, RewardProgram } from "@/lib/booth/types";

/**
 * timezone + country needed by the composer's date/time picker
 * (Codex #15/#11/#14 — A3), plus the restaurant-local current year/month
 * (Codex #7) so the calendar opens on "today" at the restaurant, not the
 * device's UTC month — those can disagree for hours around a month boundary.
 */
export type RestaurantScheduleContext = { timezone: string; country: string; currentYear: number; currentMonth: number };

export async function getRestaurantScheduleContext(restaurantId: string): Promise<RestaurantScheduleContext> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("restaurants")
    .select("timezone, country")
    .eq("id", restaurantId)
    .single();
  if (error) throw error;
  const { year, month } = localYMD(data.timezone as string);
  return { timezone: data.timezone as string, country: data.country as string, currentYear: year, currentMonth: month };
}

export type SegmentCounts = Record<CampaignAudience, number>;

export async function getSegmentCounts(restaurantId: string): Promise<SegmentCounts> {
  const [all, goneQuiet, redeemedBefore, isNew] = await Promise.all([
    segmentMembers(restaurantId, "all"),
    segmentMembers(restaurantId, "gone_quiet"),
    segmentMembers(restaurantId, "redeemed_before"),
    segmentMembers(restaurantId, "new"),
  ]);
  return { all: all.length, gone_quiet: goneQuiet.length, redeemed_before: redeemedBefore.length, new: isNew.length };
}

/** id/name/reward text + a plain-English expiry note for the "where the offer appears" preview. */
export type OfferOption = { id: string; name: string; rewardText: string; expiryNote: string };

export async function getAttachableOffers(restaurantId: string): Promise<OfferOption[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("reward_programs")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .in("type", ["anytime", "timed"])
    .eq("active", true);
  if (error) throw error;
  return ((data ?? []) as RewardProgram[]).map((p) => {
    if (p.type === "timed") {
      const c = p.config as { reward: string; starts_at: string; ends_at: string };
      const fmt = (v: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(v));
      return { id: p.id, name: p.name, rewardText: c.reward, expiryNote: `valid ${fmt(c.starts_at)} – ${fmt(c.ends_at)}` };
    }
    const c = p.config as { reward: string; per_member_limit: number };
    return { id: p.id, name: p.name, rewardText: c.reward, expiryNote: `no expiry, up to ${c.per_member_limit} per member` };
  });
}

/** Every reward program for this restaurant, for the "redeemed a specific offer" filter select. come_back stores its reward per block; the shallowest (first) block's reward is shown. */
export async function getFilterablePrograms(restaurantId: string): Promise<OfferOption[]> {
  const admin = createSupabaseAdminClient();
  // 'custom' is the hidden per-member-offer bucket (Plan V3) — not a real
  // filterable offer, so it's excluded here same as the Rewards page listing.
  const { data, error } = await admin
    .from("reward_programs")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .neq("type", "custom")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as RewardProgram[]).map((p) => {
    const config = p.config as { reward?: string; blocks?: { reward: string }[] };
    return { id: p.id, name: p.name, rewardText: config.reward ?? config.blocks?.[0]?.reward ?? "", expiryNote: "" };
  });
}

export type MessageHistoryRow = {
  id: string;
  audience: CampaignAudience;
  filtersSummary: string | null;
  body: string;
  status: Campaign["status"];
  sentAt: string | null;
  scheduledFor: string | null;
  sentCount: number;
  redeemedCount: number;
  optOutCount: number;
  /** Campaign has sat in 'sending' longer than the stale threshold — likely a crashed/interrupted run (Codex #43 partial). */
  stalled: boolean;
};

export async function getMessageHistory(restaurantId: string): Promise<MessageHistoryRow[]> {
  const admin = createSupabaseAdminClient();
  const { data: campaignRows, error } = await admin
    .from("campaigns")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  const campaigns = (campaignRows ?? []) as Campaign[];

  const programIds = [...new Set(campaigns.map((c) => (c.audience_filters as AudienceFilters | null)?.redeemed_program_id).filter((v): v is string => !!v))];
  const programNameById: Record<string, string> = {};
  if (programIds.length > 0) {
    const { data: programRows, error: programError } = await admin
      .from("reward_programs")
      .select("id, name")
      .in("id", programIds);
    if (programError) throw programError;
    for (const p of programRows ?? []) programNameById[p.id as string] = p.name as string;
  }

  const rows: MessageHistoryRow[] = [];
  for (const c of campaigns) {
    const [{ count: redeemedCount, error: redeemedError }, { data: recipientIds, error: recipientsError }] = await Promise.all([
      admin.from("reward_grants").select("id", { count: "exact", head: true }).eq("campaign_id", c.id).eq("state", "redeemed"),
      admin.from("campaign_recipients").select("member_id").eq("campaign_id", c.id),
    ]);
    if (redeemedError) throw redeemedError;
    if (recipientsError) throw recipientsError;

    const memberIds = (recipientIds ?? []).map((r) => r.member_id as string);
    let optOutCount = 0;
    if (memberIds.length > 0) {
      const { count, error: optOutError } = await admin
        .from("members")
        .select("id", { count: "exact", head: true })
        .in("id", memberIds)
        .eq("opted_out", true)
        .gte("opted_out_ts", c.sent_at ?? c.created_at);
      if (optOutError) throw optOutError;
      optOutCount = count ?? 0;
    }

    const filterFragments = describeAudienceFilters(c.audience_filters as AudienceFilters | null, programNameById);
    rows.push({
      id: c.id,
      audience: c.audience,
      filtersSummary: filterFragments.length > 0 ? filterFragments.join(" · ") : null,
      body: c.body,
      status: c.status,
      sentAt: c.sent_at,
      scheduledFor: c.scheduled_for,
      sentCount: c.sent_count ?? 0,
      redeemedCount: redeemedCount ?? 0,
      optOutCount,
      stalled: isStaleSending(c.status, c.scheduled_for),
    });
  }
  return rows;
}
