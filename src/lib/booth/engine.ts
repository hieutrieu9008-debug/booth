import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { sendMarketing } from "@/lib/sms/dispatch";
import { audienceFiltersSchema, type AudienceFilters } from "./audiences";
import { createMemberCardLink } from "./links";
import { ladderTotals } from "./ladder";
import { parseProgramConfig, type BirthdayConfig, type VisitLadderConfig } from "./programs";
import type { NewGrant } from "./rewards";
import { getMessageTemplates } from "./settings-data";
import { renderTemplate } from "./template";
import { newRewardToken } from "./tokens";
import type { Campaign, CampaignAudience, Member, MemberProgress, RewardProgram } from "./types";

/**
 * M6 — segments, campaign fan-out, and proactive reward notifications.
 * Everything here that sends a text goes through sendMarketing/sendTransactional
 * (src/lib/sms/dispatch.ts) — the compliance floor — never a provider directly.
 */

const STOP_SUFFIX = " Reply STOP to opt out.";

function withStopSuffix(body: string): string {
  return body.includes("Reply STOP to opt out.") ? body : `${body}${STOP_SUFFIX}`;
}

// ---------------------------------------------------------------------------
// tz-aware date helpers (birthday cron)
// ---------------------------------------------------------------------------

/** Local Y/M/D for `timeZone` — same idiom as src/lib/sms/quiet-hours.ts's localParts. */
export function localYMD(timeZone: string, now = new Date()): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** This year's birthday as a UTC-midnight timestamp; Feb-29 in a non-leap year lands on Feb-28. */
function birthdayMsForYear(month: number, day: number, year: number): number {
  const d = month === 2 && day === 29 && !isLeapYear(year) ? 28 : day;
  return Date.UTC(year, month - 1, d);
}

/** Days from `today` (restaurant-local Y/M/D) to the member's next birthday, rolling to next year if this year's has passed. */
export function daysUntilBirthday(
  month: number,
  day: number,
  today: { year: number; month: number; day: number },
): number {
  const todayMs = Date.UTC(today.year, today.month - 1, today.day);
  let bdayMs = birthdayMsForYear(month, day, today.year);
  if (bdayMs < todayMs) bdayMs = birthdayMsForYear(month, day, today.year + 1);
  return Math.round((bdayMs - todayMs) / (24 * 60 * 60 * 1000));
}

/**
 * Centralized birthday grant expiry [Cx2-18/19] — used by BOTH the daily
 * cron and grantParamsFromProgram (campaign-attached birthday programs), so
 * mode-aware expiry can't drift between the two call sites.
 *  - window: rolling `now + window_days`.
 *  - month: first instant of the following restaurant-local month (exclusive
 *    boundary — works with the expires_at > now() check in fn_redeem_grant).
 * Local Y/M/D is treated as UTC-ms for the boundary calc — the same
 * simplification daysUntilBirthday/birthdayMsForYear already use in this
 * file; there's no tz-conversion library in this codebase.
 */
export function birthdayGrantParams(
  config: BirthdayConfig,
  timeZone: string,
  now = new Date(),
): { expiresAt: string } {
  if (config.mode === "month") {
    const today = localYMD(timeZone, now);
    const nextMonth = today.month === 12 ? 1 : today.month + 1;
    const nextYear = today.month === 12 ? today.year + 1 : today.year;
    return { expiresAt: new Date(Date.UTC(nextYear, nextMonth - 1, 1)).toISOString() };
  }
  const windowDays = config.window_days ?? 0;
  return { expiresAt: new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000).toISOString() };
}

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

/**
 * Opted-in members matching a campaign audience segment, optionally narrowed
 * further by `filters` (all ANDed together, applied on top of the base
 * segment — see audiences.ts). opted_out exclusion happens in the base query
 * below and is never affected by filters.
 *  - all: every opted-in member
 *  - new: joined within the last 30 days
 *  - redeemed_before: has ever redeemed a grant
 *  - gone_quiet: last non-voided visit event older than restaurants.gone_quiet_weeks
 *                (members with no visits use joined_at)
 */
export async function segmentMembers(
  restaurantId: string,
  audience: CampaignAudience,
  filters?: AudienceFilters | null,
): Promise<Member[]> {
  const admin = createSupabaseAdminClient();
  const { data: membersData, error: membersError } = await admin
    .from("members")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .eq("opted_out", false);
  if (membersError) throw membersError;
  const members = (membersData ?? []) as Member[];

  let base: Member[];
  if (audience === "all") {
    base = members;
  } else if (audience === "new") {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    base = members.filter((m) => m.joined_at > cutoff);
  } else if (audience === "redeemed_before") {
    const { data: grantRows, error } = await admin
      .from("reward_grants")
      .select("member_id")
      .eq("restaurant_id", restaurantId)
      .eq("state", "redeemed");
    if (error) throw error;
    const redeemedIds = new Set((grantRows ?? []).map((g) => g.member_id as string));
    base = members.filter((m) => redeemedIds.has(m.id));
  } else {
    // gone_quiet
    const { data: restaurant, error: restaurantError } = await admin
      .from("restaurants")
      .select("gone_quiet_weeks")
      .eq("id", restaurantId)
      .single();
    if (restaurantError) throw restaurantError;
    const cutoffMs = Date.now() - restaurant.gone_quiet_weeks * 7 * 24 * 60 * 60 * 1000;

    const { data: visitRows, error: visitsError } = await admin
      .from("events")
      .select("member_id, created_at")
      .eq("restaurant_id", restaurantId)
      .eq("type", "visit")
      .eq("voided", false)
      .order("created_at", { ascending: false });
    if (visitsError) throw visitsError;
    const lastVisitByMember = new Map<string, string>();
    for (const row of visitRows ?? []) {
      const memberId = row.member_id as string;
      if (!lastVisitByMember.has(memberId)) lastVisitByMember.set(memberId, row.created_at as string);
    }

    base = members.filter((m) => {
      const lastVisit = lastVisitByMember.get(m.id) ?? m.joined_at;
      return new Date(lastVisit).getTime() < cutoffMs;
    });
  }

  if (!filters) return base;
  return applyAudienceFilters(admin, restaurantId, base, filters);
}

async function applyAudienceFilters(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  restaurantId: string,
  members: Member[],
  filters: AudienceFilters,
): Promise<Member[]> {
  let result = members;

  if (result.length > 0 && filters.redeemed_within_days !== undefined) {
    const cutoff = new Date(Date.now() - filters.redeemed_within_days * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await admin
      .from("reward_grants")
      .select("member_id")
      .eq("restaurant_id", restaurantId)
      .eq("state", "redeemed")
      .gte("redeemed_at", cutoff);
    if (error) throw error;
    const ids = new Set((data ?? []).map((r) => r.member_id as string));
    result = result.filter((m) => ids.has(m.id));
  }

  if (result.length > 0 && filters.redeemed_program_id !== undefined) {
    const { data, error } = await admin
      .from("reward_grants")
      .select("member_id")
      .eq("restaurant_id", restaurantId)
      .eq("state", "redeemed")
      .eq("program_id", filters.redeemed_program_id);
    if (error) throw error;
    const ids = new Set((data ?? []).map((r) => r.member_id as string));
    result = result.filter((m) => ids.has(m.id));
  }

  if (result.length > 0 && filters.min_visits !== undefined) {
    const { data, error } = await admin
      .from("events")
      .select("member_id")
      .eq("restaurant_id", restaurantId)
      .eq("type", "visit")
      .eq("voided", false);
    if (error) throw error;
    const counts = new Map<string, number>();
    for (const row of data ?? []) {
      const memberId = row.member_id as string;
      counts.set(memberId, (counts.get(memberId) ?? 0) + 1);
    }
    const minVisits = filters.min_visits;
    result = result.filter((m) => (counts.get(m.id) ?? 0) >= minVisits);
  }

  if (result.length > 0 && filters.joined_within_days !== undefined) {
    const cutoff = new Date(Date.now() - filters.joined_within_days * 24 * 60 * 60 * 1000).toISOString();
    result = result.filter((m) => m.joined_at > cutoff);
  }

  if (result.length > 0 && filters.birthday_this_month) {
    const { data: restaurant, error } = await admin
      .from("restaurants")
      .select("timezone")
      .eq("id", restaurantId)
      .single();
    if (error) throw error;
    const today = localYMD(restaurant.timezone);
    result = result.filter((m) => m.birthday_month === today.month);
  }

  if (result.length > 0 && filters.near_reward) {
    result = await filterNearReward(admin, restaurantId, result);
  }

  return result;
}

/** True when a member is within 2 visits of the next unearned rung on `config`. */
function isNearReward(config: VisitLadderConfig, progress: MemberProgress): boolean {
  const total = ladderTotals(config, progress);
  const nextRung = config.rungs.find((rung) => rung.visits > total);
  if (!nextRung) return false; // no unearned rung this lap (non-looping, maxed out)
  return nextRung.visits - total <= 2;
}

/** Members within 2 visits of their next unearned rung on any active visit_ladder program. */
async function filterNearReward(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  restaurantId: string,
  members: Member[],
): Promise<Member[]> {
  const { data: programRows, error: programsError } = await admin
    .from("reward_programs")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .eq("type", "visit_ladder")
    .eq("active", true);
  if (programsError) throw programsError;
  const ladderPrograms = (programRows ?? []) as RewardProgram[];
  if (ladderPrograms.length === 0) return [];

  const memberIds = members.map((m) => m.id);
  const { data: progressRows, error: progressError } = await admin
    .from("member_progress")
    .select("*")
    .in("member_id", memberIds)
    .in(
      "program_id",
      ladderPrograms.map((p) => p.id),
    );
  if (progressError) throw progressError;

  const progressByMemberAndProgram = new Map<string, MemberProgress>();
  for (const row of (progressRows ?? []) as MemberProgress[]) {
    progressByMemberAndProgram.set(`${row.member_id}:${row.program_id}`, row);
  }

  const nearIds = new Set<string>();
  for (const program of ladderPrograms) {
    const parsed = parseProgramConfig(program.type, program.config);
    if (parsed.type !== "visit_ladder") continue;
    for (const member of members) {
      if (nearIds.has(member.id)) continue;
      const progress = progressByMemberAndProgram.get(`${member.id}:${program.id}`);
      if (!progress) continue;
      if (isNearReward(parsed.config, progress)) nearIds.add(member.id);
    }
  }

  return members.filter((m) => nearIds.has(m.id));
}

// ---------------------------------------------------------------------------
// Campaign fan-out
// ---------------------------------------------------------------------------

/**
 * `timezone` only matters for a birthday program in month mode; every other
 * type ignores it. come_back uses blocks[0] — the shallowest (soonest-firing)
 * block — as the campaign-attached reward; a campaign send isn't tied to any
 * particular member's days-quiet, so there's no "deepest matured" concept
 * here the way there is in the cron.
 */
function grantParamsFromProgram(
  program: RewardProgram,
  timezone: string,
): {
  rewardText: string;
  ringUpNote: string | null;
  expiresAt: string | null;
} {
  const parsed = parseProgramConfig(program.type, program.config);
  switch (parsed.type) {
    case "welcome":
      return {
        rewardText: parsed.config.reward,
        ringUpNote: parsed.config.ring_up_note ?? null,
        expiresAt: new Date(Date.now() + parsed.config.valid_days * 24 * 60 * 60 * 1000).toISOString(),
      };
    case "come_back": {
      const block = parsed.config.blocks[0];
      return {
        rewardText: block.reward,
        ringUpNote: null,
        expiresAt: new Date(Date.now() + block.valid_days * 24 * 60 * 60 * 1000).toISOString(),
      };
    }
    case "birthday":
      return {
        rewardText: parsed.config.reward,
        ringUpNote: null,
        expiresAt: birthdayGrantParams(parsed.config, timezone).expiresAt,
      };
    case "anytime":
      return { rewardText: parsed.config.reward, ringUpNote: null, expiresAt: null };
    case "timed":
      return { rewardText: parsed.config.reward, ringUpNote: null, expiresAt: parsed.config.ends_at };
    case "visit_ladder":
      throw new Error("visit_ladder programs cannot be attached to a campaign");
    case "custom":
      throw new Error("custom programs cannot be attached to a campaign");
  }
}

export type RunCampaignResult = { claimed: boolean; sentCount: number };

/**
 * Fans a campaign out to its audience. Idempotent: campaign_recipients'
 * (campaign_id, member_id) primary key means a rerun (resume after a crash,
 * or the cron re-picking the same due campaign up) only acts on members it
 * hasn't already inserted a recipient row for — no duplicate grants or texts.
 */
export async function runCampaign(campaignId: string): Promise<RunCampaignResult> {
  const admin = createSupabaseAdminClient();

  // Idempotent claim: only one caller moves this campaign out of 'scheduled'.
  const { data: claimedRows, error: claimError } = await admin
    .from("campaigns")
    .update({ status: "sending" })
    .eq("id", campaignId)
    .eq("status", "scheduled")
    .select("*");
  if (claimError) throw claimError;
  if (!claimedRows || claimedRows.length === 0) {
    return { claimed: false, sentCount: 0 };
  }
  const campaign = claimedRows[0] as Campaign;

  let program: RewardProgram | null = null;
  let timezone = "Europe/London";
  if (campaign.program_id) {
    const { data: programRow, error: programError } = await admin
      .from("reward_programs")
      .select("*")
      .eq("id", campaign.program_id)
      .single();
    if (programError) throw programError;
    program = programRow as RewardProgram;

    const { data: restaurantRow, error: restaurantError } = await admin
      .from("restaurants")
      .select("timezone")
      .eq("id", campaign.restaurant_id)
      .single();
    if (restaurantError) throw restaurantError;
    timezone = restaurantRow.timezone;
  }

  const filters = campaign.audience_filters ? audienceFiltersSchema.parse(campaign.audience_filters) : null;
  const recipients = await segmentMembers(campaign.restaurant_id, campaign.audience, filters);
  const body = withStopSuffix(campaign.body);

  for (const member of recipients) {
    // Blast-safety floor: recipients always come from members rows scoped to
    // this restaurant (segmentMembers), asserted anyway per the compliance spec.
    if (member.restaurant_id !== campaign.restaurant_id) continue;

    // Claim this recipient row with a plain insert (not upsert-ignore): we
    // need to distinguish "brand new row" from "row already existed" so we
    // can inspect the existing row's message_id below (Codex #9). A row's
    // mere existence does NOT prove its send completed — it's inserted
    // before dispatch is attempted — only a non-null message_id does.
    const { error: recipientError } = await admin
      .from("campaign_recipients")
      .insert({ campaign_id: campaignId, member_id: member.id });

    if (recipientError) {
      // 23503 = FK violation — the member was deleted between segment
      // resolution and fan-out (e.g. a GDPR deletion mid-run). Skip them
      // rather than failing the whole campaign.
      if (recipientError.code === "23503") continue;
      if (recipientError.code === "23505") {
        // Row already exists from a prior run of this campaign (crash,
        // manual retry, or the cron's stale sweep). Fetch it to see whether
        // the earlier attempt actually finished.
        const { data: existing, error: fetchError } = await admin
          .from("campaign_recipients")
          .select("message_id")
          .eq("campaign_id", campaignId)
          .eq("member_id", member.id)
          .maybeSingle();
        if (fetchError) throw fetchError;
        if (existing?.message_id) continue; // earlier send completed — never re-send
        // else: message_id is still null — the earlier attempt never
        // finished (crashed before send, or sent but crashed/errored before
        // the message_id write below landed). Fall through and retry it.
        //
        // Concurrency reasoning: within a single run, runCampaign only ever
        // acts on a campaign it atomically claimed out of 'scheduled' (see
        // the claim above this function), and the manual-retry / cron-sweep
        // reclaim paths (actions.ts, api/cron/campaigns/route.ts) only
        // reopen a campaign that is genuinely stale — so in the ordinary
        // case there is exactly one runner touching this campaign's
        // recipient rows at a time, and this insert-then-fetch is safe.
        // The one case that isn't fully closed: a runner sends successfully
        // and then crashes before writing message_id; if a second runner
        // later reclaims the same (now-stale) campaign, it will retry this
        // row and the member gets texted twice. We accept that narrow
        // double-send window as the lesser evil against the alternative —
        // silently skipping the row forever, which is a real message the
        // UI promised would retry but never will.
      } else {
        throw recipientError;
      }
    }

    if (program) {
      const grantParams = grantParamsFromProgram(program, timezone);
      const { error: grantError } = await admin.from("reward_grants").upsert(
        {
          restaurant_id: campaign.restaurant_id,
          member_id: member.id,
          program_id: program.id,
          campaign_id: campaignId,
          reward_text: grantParams.rewardText,
          ring_up_note: grantParams.ringUpNote,
          one_use_token: newRewardToken(),
          grant_slot: `campaign:${campaignId}`,
          expires_at: grantParams.expiresAt,
          earned_at: new Date().toISOString(),
        },
        { onConflict: "member_id,program_id,grant_slot", ignoreDuplicates: true },
      );
      if (grantError) throw grantError;
    }

    const result = await sendMarketing({
      restaurantId: campaign.restaurant_id,
      memberId: member.id,
      body,
      campaignId,
    });
    const messageId = "messageId" in result ? result.messageId : null;
    await admin
      .from("campaign_recipients")
      .update({ message_id: messageId })
      .eq("campaign_id", campaignId)
      .eq("member_id", member.id);
  }

  const { count: sentCount, error: countError } = await admin
    .from("campaign_recipients")
    .select("member_id", { count: "exact", head: true })
    .eq("campaign_id", campaignId);
  if (countError) throw countError;

  await admin
    .from("campaigns")
    .update({ status: "sent", sent_at: new Date().toISOString(), sent_count: sentCount ?? 0 })
    .eq("id", campaignId);

  return { claimed: true, sentCount: sentCount ?? 0 };
}

// ---------------------------------------------------------------------------
// Proactive reward-earned notifications
// ---------------------------------------------------------------------------

/**
 * WS-D — body resolution for a single new grant, extracted out of
 * notifyNewGrants so the "which copy fires" decision is one small, testable
 * function. `template` is the owner's restaurants.message_templates entry
 * for this grant's kind (reward_earned / reward_earned_choice), if set;
 * undefined falls back to the original coded copy. Pre-choice copy never
 * claims a single reward for a multi-option grant [Cx2-10] — true of both
 * the fallback and (by the {reward} var itself) the templated version.
 */
function resolveBody(
  grant: NewGrant,
  restaurant: { name: string },
  cardLink: string,
  template: string | undefined,
): string {
  const vars = { reward: grant.rewardText, restaurant: restaurant.name, link: cardLink };
  if (template) return renderTemplate(template, vars);
  return grant.hasChoice
    ? `${restaurant.name}: you've earned a reward. Your pick: ${grant.rewardText}. Choose on your card → ${cardLink}`
    : `${restaurant.name}: you've earned ${grant.rewardText}! It's on your card → ${cardLink}`;
}

/**
 * Called by the staff scan + phone-lookup visit actions right after
 * materializeGrants returns non-empty newGrants. One card link is minted per
 * call and reused across every grant in the batch (a single scan can earn
 * more than one rung at once).
 */
export async function notifyNewGrants(
  member: Pick<Member, "id">,
  restaurant: { id: string; name: string },
  newGrants: NewGrant[],
): Promise<void> {
  if (newGrants.length === 0) return;
  const cardLink = await createMemberCardLink(member.id);
  const templates = await getMessageTemplates(restaurant.id);
  for (const grant of newGrants) {
    const template = grant.hasChoice ? templates.reward_earned_choice : templates.reward_earned;
    const body = withStopSuffix(resolveBody(grant, restaurant, cardLink, template));
    await sendMarketing({ restaurantId: restaurant.id, memberId: member.id, body });
  }
}

// ---------------------------------------------------------------------------
// Soft cadence signal (M7 owner dashboard consumes this — never blocks a send)
// ---------------------------------------------------------------------------

export async function marketingSendsThisMonth(
  restaurantId: string,
): Promise<{ sends: number; avgPerMember: number }> {
  const admin = createSupabaseAdminClient();
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

  const { count: sends, error: sendsError } = await admin
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", restaurantId)
    .eq("kind", "marketing")
    .in("status", ["sent", "delivered", "simulated"])
    .gte("created_at", monthStart);
  if (sendsError) throw sendsError;

  const { count: memberCount, error: memberError } = await admin
    .from("members")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", restaurantId)
    .eq("opted_out", false);
  if (memberError) throw memberError;

  const total = sends ?? 0;
  const avgPerMember = memberCount && memberCount > 0 ? total / memberCount : 0;
  return { sends: total, avgPerMember };
}
