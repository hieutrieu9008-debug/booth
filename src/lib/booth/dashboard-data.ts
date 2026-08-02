import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { formatPhoneNational } from "./format";
import { localYMD, marketingSendsThisMonth } from "./engine";
import { progressDisplay } from "./ladder";
import { parseProgramConfig } from "./programs";
import type { Campaign, EventSource, EventType, GrantState, Member, MemberProgress, RewardProgram } from "./types";

/**
 * M7 owner dashboard read queries — Overview tiles + details drawer + the
 * cadence banner signal. Everything here is a plain read via the admin
 * client; every caller is gated by requireOwnerRestaurant() in the route.
 */

export type OwnerRestaurantFull = {
  id: string;
  slug: string;
  name: string;
  avg_ticket: number | null;
  gone_quiet_weeks: number;
  visit_mode: string;
  self_scan_token: string | null;
  brand_color: string;
  currency: string;
  timezone: string;
};

export async function getOwnerRestaurantFull(restaurantId: string): Promise<OwnerRestaurantFull> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("restaurants")
    .select("id, slug, name, avg_ticket, gone_quiet_weeks, visit_mode, self_scan_token, brand_color, currency, timezone")
    .eq("id", restaurantId)
    .single();
  if (error) throw error;
  return data as OwnerRestaurantFull;
}

/** UTC calendar-month start — same idiom as engine.ts's marketingSendsThisMonth. */
function monthStartIso(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

type VisitRow = { member_id: string; created_at: string };

export async function nonVoidedVisits(restaurantId: string): Promise<VisitRow[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("events")
    .select("member_id, created_at")
    .eq("restaurant_id", restaurantId)
    .eq("type", "visit")
    .eq("voided", false)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as VisitRow[];
}

// ---------------------------------------------------------------------------
// Overview tiles
// ---------------------------------------------------------------------------

export type OverviewTiles = {
  customersBack: { count: number; estGbp: number | null; avgTicket: number | null };
  list: { count: number; newThisMonth: number };
  regularsRescued: { count: number };
};

export async function getOverviewTiles(restaurant: OwnerRestaurantFull): Promise<OverviewTiles> {
  const admin = createSupabaseAdminClient();
  const monthStart = monthStartIso();
  const visits = await nonVoidedVisits(restaurant.id);

  // Walk each member's visits in order, tracking a running count so we can
  // tell a 2nd+ visit (repeat) apart from a gap-then-return (rescued).
  const seenCount = new Map<string, number>();
  const lastVisitAt = new Map<string, string>();
  const repeatMembersThisMonth = new Set<string>();
  const rescuedMembersThisMonth = new Set<string>();
  const gapMs = restaurant.gone_quiet_weeks * 7 * 24 * 60 * 60 * 1000;

  for (const visit of visits) {
    const priorCount = seenCount.get(visit.member_id) ?? 0;
    const priorVisitAt = lastVisitAt.get(visit.member_id);
    const nextCount = priorCount + 1;
    seenCount.set(visit.member_id, nextCount);

    if (nextCount >= 2 && visit.created_at >= monthStart) {
      repeatMembersThisMonth.add(visit.member_id);
    }
    if (
      priorVisitAt &&
      visit.created_at >= monthStart &&
      new Date(visit.created_at).getTime() - new Date(priorVisitAt).getTime() > gapMs
    ) {
      rescuedMembersThisMonth.add(visit.member_id);
    }
    lastVisitAt.set(visit.member_id, visit.created_at);
  }

  const { count: listCount, error: listError } = await admin
    .from("members")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", restaurant.id)
    .eq("opted_out", false);
  if (listError) throw listError;

  const { count: newCount, error: newError } = await admin
    .from("members")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", restaurant.id)
    .eq("opted_out", false)
    .gte("joined_at", monthStart);
  if (newError) throw newError;

  const customersBackCount = repeatMembersThisMonth.size;
  const avgTicket = restaurant.avg_ticket;

  return {
    customersBack: {
      count: customersBackCount,
      estGbp: avgTicket != null ? Math.round(customersBackCount * avgTicket) : null,
      avgTicket,
    },
    list: { count: listCount ?? 0, newThisMonth: newCount ?? 0 },
    regularsRescued: { count: rescuedMembersThisMonth.size },
  };
}

// ---------------------------------------------------------------------------
// Cadence banner (never blocks — just a signal)
// ---------------------------------------------------------------------------

export type CadenceSignal = { show: boolean; sends: number; avgPerMember: number };

export async function getCadenceSignal(restaurantId: string): Promise<CadenceSignal> {
  const { sends, avgPerMember } = await marketingSendsThisMonth(restaurantId);
  return { show: avgPerMember > 4, sends, avgPerMember };
}

// ---------------------------------------------------------------------------
// Details drawer
// ---------------------------------------------------------------------------

export type CampaignFunnelRow = { id: string; audience: string; body: string; sentAt: string | null; sentCount: number; redeemedCount: number };
export type WhosCloseRow = { memberId: string; name: string; label: string; visitsToGo: number };
export type QuietMemberRow = { memberId: string; name: string; lastVisitAt: string | null };

export type DrawerDetails = {
  campaigns: CampaignFunnelRow[];
  optOutRate: { optOuts: number; sends: number; pct: number | null };
  whosClose: WhosCloseRow[];
  quietMembers: QuietMemberRow[];
};

export async function getDrawerDetails(restaurant: OwnerRestaurantFull): Promise<DrawerDetails> {
  const admin = createSupabaseAdminClient();
  const monthStart = monthStartIso();

  const { data: campaignRows, error: campaignsError } = await admin
    .from("campaigns")
    .select("id, audience, body, sent_at, sent_count")
    .eq("restaurant_id", restaurant.id)
    .eq("status", "sent")
    .order("sent_at", { ascending: false })
    .limit(10);
  if (campaignsError) throw campaignsError;
  const campaigns = (campaignRows ?? []) as Pick<Campaign, "id" | "audience" | "body" | "sent_at" | "sent_count">[];

  const campaignFunnel: CampaignFunnelRow[] = [];
  for (const c of campaigns) {
    const { count: redeemedCount, error: redeemedError } = await admin
      .from("reward_grants")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", c.id)
      .eq("state", "redeemed");
    if (redeemedError) throw redeemedError;
    campaignFunnel.push({
      id: c.id,
      audience: c.audience,
      body: c.body,
      sentAt: c.sent_at,
      sentCount: c.sent_count ?? 0,
      redeemedCount: redeemedCount ?? 0,
    });
  }

  const { count: optOutCount, error: optOutError } = await admin
    .from("members")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", restaurant.id)
    .eq("opted_out", true)
    .gte("opted_out_ts", monthStart);
  if (optOutError) throw optOutError;
  const { sends } = await marketingSendsThisMonth(restaurant.id);
  const optOuts = optOutCount ?? 0;

  // Who's close: members within 1-2 visits of their next ladder rung.
  const { data: laddersData, error: laddersError } = await admin
    .from("reward_programs")
    .select("*")
    .eq("restaurant_id", restaurant.id)
    .eq("type", "visit_ladder")
    .eq("active", true);
  if (laddersError) throw laddersError;
  const ladders = (laddersData ?? []) as RewardProgram[];

  const whosClose: WhosCloseRow[] = [];
  for (const program of ladders) {
    const parsed = parseProgramConfig(program.type, program.config);
    if (parsed.type !== "visit_ladder") continue;
    const { data: progressRows, error: progressError } = await admin
      .from("member_progress")
      .select("*, members!inner(id, name)")
      .eq("program_id", program.id);
    if (progressError) throw progressError;
    for (const row of progressRows ?? []) {
      const { members: member, ...progress } = row as { members: { id: string; name: string } } & Record<string, unknown>;
      const display = progressDisplay(parsed.config, progress as never);
      const visitsToGo = display.target - display.current;
      if (visitsToGo > 0 && visitsToGo <= 2) {
        whosClose.push({ memberId: member.id, name: member.name, label: display.label, visitsToGo });
      }
    }
  }

  // Quiet members: last non-voided visit older than gone_quiet_weeks (or never visited — joined_at).
  const visits = await nonVoidedVisits(restaurant.id);
  const lastVisitByMember = new Map<string, string>();
  for (const v of visits) lastVisitByMember.set(v.member_id, v.created_at); // last write wins (ascending order)

  const { data: memberRows, error: membersError } = await admin
    .from("members")
    .select("id, name, joined_at")
    .eq("restaurant_id", restaurant.id)
    .eq("opted_out", false);
  if (membersError) throw membersError;
  const cutoffMs = Date.now() - restaurant.gone_quiet_weeks * 7 * 24 * 60 * 60 * 1000;

  const quietMembers: QuietMemberRow[] = (memberRows ?? [])
    .map((m) => {
      const lastVisitAt = lastVisitByMember.get(m.id) ?? null;
      const compareAt = lastVisitAt ?? (m.joined_at as string);
      return { memberId: m.id as string, name: m.name as string, lastVisitAt, isQuiet: new Date(compareAt).getTime() < cutoffMs };
    })
    .filter((m) => m.isQuiet)
    .map(({ memberId, name, lastVisitAt }) => ({ memberId, name, lastVisitAt }))
    .sort((a, b) => (a.lastVisitAt ?? "").localeCompare(b.lastVisitAt ?? ""));

  return {
    campaigns: campaignFunnel,
    optOutRate: { optOuts, sends, pct: sends > 0 ? Math.round((optOuts / sends) * 1000) / 10 : null },
    whosClose,
    quietMembers,
  };
}

// ---------------------------------------------------------------------------
// WS-C — Members tab + profile
// ---------------------------------------------------------------------------

export type MemberSavedView = "close_to_reward" | "gone_quiet" | "birthday_month";

export type MemberListRow = {
  memberId: string;
  name: string;
  phone: string; // national format
  lastVisitAt: string | null;
  progressLabel: string | null;
  closeLabel: string | null; // "2 visits from Free coffee" — set whenever visitsToGo <= 2, regardless of view
  consent: "opted_in" | "opted_out";
};

type LadderInfo = { progressLabel: string; closeLabel: string | null; visitsToGo: number | null };

/** Closest active visit_ladder's display + a "close to reward" label per member, for the Members list + saved views. */
async function memberLadderInfoMap(restaurantId: string): Promise<Map<string, LadderInfo>> {
  const admin = createSupabaseAdminClient();
  const { data: laddersData, error: laddersError } = await admin
    .from("reward_programs")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .eq("type", "visit_ladder")
    .eq("active", true);
  if (laddersError) throw laddersError;
  const ladders = (laddersData ?? []) as RewardProgram[];
  const map = new Map<string, LadderInfo>();
  if (ladders.length === 0) return map;

  const { data: progressRows, error: progressError } = await admin
    .from("member_progress")
    .select("*")
    .in(
      "program_id",
      ladders.map((p) => p.id),
    );
  if (progressError) throw progressError;

  for (const program of ladders) {
    const parsed = parseProgramConfig(program.type, program.config);
    if (parsed.type !== "visit_ladder") continue;
    for (const row of (progressRows ?? []) as MemberProgress[]) {
      if (row.program_id !== program.id) continue;
      const display = progressDisplay(parsed.config, row);
      const visitsToGo = display.target - display.current;
      const existing = map.get(row.member_id);
      if (existing && (existing.visitsToGo ?? Infinity) <= (visitsToGo > 0 ? visitsToGo : Infinity)) continue;
      const nextRung = parsed.config.rungs.find((r) => r.visits > display.current);
      const rewardText = nextRung ? nextRung.options.map((o) => o.reward).join(" or ") : null;
      map.set(row.member_id, {
        progressLabel: display.label,
        closeLabel:
          visitsToGo > 0 && visitsToGo <= 2 && rewardText
            ? `${visitsToGo} visit${visitsToGo === 1 ? "" : "s"} from ${rewardText}`
            : null,
        visitsToGo: visitsToGo > 0 ? visitsToGo : null,
      });
    }
  }
  return map;
}

/**
 * Server-side name/phone search (ilike) plus the saved-view filter chips.
 * `%`/`_` in the query are escaped so a diner-typed wildcard can't widen the
 * search unexpectedly.
 */
export async function searchMembers(
  restaurant: OwnerRestaurantFull,
  opts: { query?: string; view?: MemberSavedView } = {},
): Promise<MemberListRow[]> {
  const admin = createSupabaseAdminClient();
  let query = admin
    .from("members")
    .select("id, name, phone, opted_out, joined_at, birthday_month")
    .eq("restaurant_id", restaurant.id);
  const trimmed = opts.query?.trim();
  if (trimmed) {
    const escaped = trimmed.replace(/[%_]/g, (c) => `\\${c}`);
    query = query.or(`name.ilike.%${escaped}%,phone.ilike.%${escaped}%`);
  }
  const { data: memberRows, error } = await query.order("joined_at", { ascending: false }).limit(200);
  if (error) throw error;
  const members = (memberRows ?? []) as Pick<Member, "id" | "name" | "phone" | "opted_out" | "joined_at" | "birthday_month">[];

  const { data: restRow, error: restError } = await admin
    .from("restaurants")
    .select("phone_prefix")
    .eq("id", restaurant.id)
    .single();
  if (restError) throw restError;

  const [visits, ladderInfo] = await Promise.all([nonVoidedVisits(restaurant.id), memberLadderInfoMap(restaurant.id)]);
  const lastVisitByMember = new Map<string, string>();
  for (const v of visits) lastVisitByMember.set(v.member_id, v.created_at); // last write wins (ascending order)

  const cutoffMs = Date.now() - restaurant.gone_quiet_weeks * 7 * 24 * 60 * 60 * 1000;
  const todayLocal = localYMD(restaurant.timezone);

  const rows = members.map((m) => {
    const lastVisitAt = lastVisitByMember.get(m.id) ?? null;
    const info = ladderInfo.get(m.id);
    return {
      memberId: m.id,
      name: m.name,
      phone: formatPhoneNational(m.phone, restRow.phone_prefix),
      lastVisitAt,
      progressLabel: info?.progressLabel ?? null,
      closeLabel: info?.closeLabel ?? null,
      consent: (m.opted_out ? "opted_out" : "opted_in") as "opted_in" | "opted_out",
      _quietSince: lastVisitAt ?? m.joined_at,
      _birthdayMonth: m.birthday_month,
    };
  });

  let filtered = rows;
  if (opts.view === "close_to_reward") filtered = filtered.filter((r) => r.closeLabel != null);
  if (opts.view === "gone_quiet") filtered = filtered.filter((r) => new Date(r._quietSince).getTime() < cutoffMs);
  if (opts.view === "birthday_month") filtered = filtered.filter((r) => r._birthdayMonth === todayLocal.month);

  return filtered.map(({ _quietSince, _birthdayMonth, ...r }) => r);
}

export type MemberProfileEvent = { id: string; type: EventType; source: EventSource; createdAt: string; voided: boolean };
export type MemberWalletGrant = {
  id: string;
  rewardText: string;
  state: GrantState;
  expiresAt: string | null;
  earnedAt: string;
  redeemedAt: string | null;
};
export type MemberLadderProgress = { programName: string; label: string; current: number; target: number };
export type MemberMessageRow = { id: string; direction: "outbound" | "inbound"; kind: string; body: string; status: string; createdAt: string };

export type MemberProfile = {
  member: {
    id: string;
    name: string;
    phone: string;
    joinedAt: string;
    consent: "opted_in" | "opted_out";
    consentTs: string;
    birthdayMonth: number | null;
    birthdayDay: number | null;
  };
  events: MemberProfileEvent[];
  wallet: MemberWalletGrant[];
  ladders: MemberLadderProgress[];
  messages: MemberMessageRow[];
};

/** Everything the Members profile page needs. Returns null when the member doesn't exist or belongs to a different restaurant (cross-tenant guard). */
export async function getMemberProfile(restaurantId: string, memberId: string): Promise<MemberProfile | null> {
  const admin = createSupabaseAdminClient();
  const { data: memberRow, error } = await admin
    .from("members")
    .select("*")
    .eq("id", memberId)
    .eq("restaurant_id", restaurantId)
    .maybeSingle();
  if (error) throw error;
  if (!memberRow) return null;
  const member = memberRow as Member;

  const { data: restRow, error: restError } = await admin
    .from("restaurants")
    .select("phone_prefix")
    .eq("id", restaurantId)
    .single();
  if (restError) throw restError;

  const { data: eventRows, error: eventsError } = await admin
    .from("events")
    .select("id, type, source, created_at, voided")
    .eq("member_id", memberId)
    .eq("restaurant_id", restaurantId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (eventsError) throw eventsError;

  const { data: grantRows, error: grantsError } = await admin
    .from("reward_grants")
    .select("id, reward_text, state, expires_at, earned_at, redeemed_at")
    .eq("member_id", memberId)
    .eq("restaurant_id", restaurantId)
    .order("earned_at", { ascending: false });
  if (grantsError) throw grantsError;

  const { data: progressRows, error: progressError } = await admin
    .from("member_progress")
    .select("*, reward_programs!inner(*)")
    .eq("member_id", memberId)
    .eq("reward_programs.type", "visit_ladder")
    .eq("reward_programs.active", true);
  if (progressError) throw progressError;
  const ladders: MemberLadderProgress[] = [];
  for (const row of (progressRows ?? []) as (MemberProgress & { reward_programs: RewardProgram })[]) {
    const { reward_programs: program, ...progress } = row;
    const parsed = parseProgramConfig(program.type, program.config);
    if (parsed.type !== "visit_ladder") continue;
    const display = progressDisplay(parsed.config, progress);
    ladders.push({ programName: program.name, label: display.label, current: display.current, target: display.target });
  }

  const { data: messageRows, error: messagesError } = await admin
    .from("messages")
    .select("id, direction, kind, body, status, created_at")
    .eq("member_id", memberId)
    .eq("restaurant_id", restaurantId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (messagesError) throw messagesError;

  return {
    member: {
      id: member.id,
      name: member.name,
      phone: formatPhoneNational(member.phone, restRow.phone_prefix),
      joinedAt: member.joined_at,
      consent: member.opted_out ? "opted_out" : "opted_in",
      consentTs: member.consent_ts,
      birthdayMonth: member.birthday_month,
      birthdayDay: member.birthday_day,
    },
    events: (eventRows ?? []).map((e) => ({
      id: e.id as string,
      type: e.type as EventType,
      source: e.source as EventSource,
      createdAt: e.created_at as string,
      voided: e.voided as boolean,
    })),
    wallet: (grantRows ?? []).map((g) => ({
      id: g.id as string,
      rewardText: g.reward_text as string,
      state: g.state as GrantState,
      expiresAt: g.expires_at as string | null,
      earnedAt: g.earned_at as string,
      redeemedAt: g.redeemed_at as string | null,
    })),
    ladders,
    messages: (messageRows ?? []).map((m) => ({
      id: m.id as string,
      direction: m.direction as "outbound" | "inbound",
      kind: m.kind as string,
      body: m.body as string,
      status: m.status as string,
      createdAt: m.created_at as string,
    })),
  };
}
