"use server";

import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { hashStaffPin } from "@/lib/booth/tokens";
import { localYMD } from "@/lib/booth/engine";
import { wallTimeToUtc } from "@/lib/booth/schedule";
import { recordVisit, redeemReward, undoEvent, type RecordVisitResult } from "@/lib/booth/scan";
import { findMemberByPhone, getMemberByQrToken, getMemberCard } from "@/lib/booth/members";
import { notifyNewGrants } from "@/lib/booth/engine";
import { checkStaffSession, setStaffSessionCookie, clearStaffSessionCookie } from "@/lib/booth/staff-session";
import { chooseGrantOption, type ChooseGrantOptionResult } from "@/lib/booth/choice";
import type { EventSource, RedeemResult, UndoResult } from "@/lib/booth/types";
import type { NewGrant } from "@/lib/booth/rewards";
import type { ProgressDisplay } from "@/lib/booth/ladder";

// ---------------------------------------------------------------------------
// Shared restaurant + session helpers (module-private — a "use server" file
// may only export async functions, so these stay unexported).
// ---------------------------------------------------------------------------

type RestaurantLite = { id: string; slug: string; name: string; timezone: string };

async function getRestaurantBySlug(slug: string): Promise<RestaurantLite | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("restaurants")
    .select("id, slug, name, timezone")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function requireStaffSession(slug: string): Promise<{ restaurant: RestaurantLite; staffPinId: string }> {
  const restaurant = await getRestaurantBySlug(slug);
  if (!restaurant) throw new Error("Restaurant not found");
  const session = await checkStaffSession(slug, restaurant.id);
  if (!session.unlocked) throw new Error("Not authorized");

  // The session cookie is valid for up to 8h regardless of what happens to
  // the PIN afterward — re-check the PIN row is still active on every
  // action so an owner deactivating a PIN locks it out immediately, not
  // just at the next PIN entry. One indexed lookup (staff_pins primary key).
  const admin = createSupabaseAdminClient();
  const { data: staffPin, error } = await admin
    .from("staff_pins")
    .select("id")
    .eq("id", session.staffPinId)
    .eq("active", true)
    .maybeSingle();
  if (error) throw error;
  if (!staffPin) throw new Error("Staff PIN deactivated");

  return { restaurant, staffPinId: session.staffPinId };
}

function ymdString(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Local-day [start, end) UTC boundaries for `timezone`, for "today" queries.
 *
 * Codex #14: the old version derived a single current UTC offset and set
 * `end` to a fixed `start + 24h`. A restaurant-local day can be 23h or 25h
 * long across a DST transition, so that fixed-width span could silently
 * clip or include an extra hour of the adjacent local day. This instead
 * resolves TODAY's and TOMORROW's local midnights independently — each
 * through wallTimeToUtc's own DST-aware offset resolution (src/lib/booth/
 * schedule.ts, the same machinery the message scheduler uses) — so each
 * boundary is correct on its own terms regardless of what the other one is.
 */
function localDayRangeUtc(timezone: string): { start: string; end: string } {
  const now = new Date();
  const { year, month, day } = localYMD(timezone, now);
  const start = wallTimeToUtc(ymdString(year, month, day), "00:00", timezone);

  // Pure calendar-day arithmetic (not real elapsed time) to get tomorrow's
  // Y/M/D: a UTC-labeled Date.UTC(...) + 24h always rolls the calendar day
  // by exactly one regardless of timezone, since it never observes DST.
  const tomorrow = new Date(Date.UTC(year, month - 1, day) + 24 * 60 * 60 * 1000);
  const end = wallTimeToUtc(
    ymdString(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate()),
    "00:00",
    timezone,
  );
  return { start, end };
}

// ---------------------------------------------------------------------------
// PIN gate
// ---------------------------------------------------------------------------

export type PinFormState = { error: string | null };

export async function submitPin(slug: string, _prevState: PinFormState, formData: FormData): Promise<PinFormState> {
  const pin = String(formData.get("pin") ?? "").trim();
  if (!pin) return { error: "Enter a PIN." };

  const restaurant = await getRestaurantBySlug(slug);
  if (!restaurant) return { error: "Restaurant not found." };

  const admin = createSupabaseAdminClient();
  const { data: staffPin, error } = await admin
    .from("staff_pins")
    .select("id")
    .eq("restaurant_id", restaurant.id)
    .eq("pin_hash", hashStaffPin(pin))
    .eq("active", true)
    .maybeSingle();
  if (error) throw error;
  if (!staffPin) return { error: "Wrong PIN." };

  await setStaffSessionCookie(slug, restaurant.id, staffPin.id);
  redirect(`/s/${slug}`);
}

/** Clears the staff session cookie — the "Lock" control, so an operator can re-trigger the PIN gate on demand. */
export async function logoutStaff(slug: string, _formData: FormData): Promise<void> {
  await clearStaffSessionCookie(slug);
  redirect(`/s/${slug}`);
}

// ---------------------------------------------------------------------------
// Scan result — one discriminated union shared by the scan tab and the
// phone-lookup tab (M4-STAFF-SPEC.md: "Same result states as scan").
// ---------------------------------------------------------------------------

export type ScanOutcome =
  | { kind: "visit_added"; memberName: string; newGrants: NewGrant[]; progressDisplays: ProgressDisplay[] }
  | { kind: "already_today"; memberName: string }
  | {
      kind: "redeem_valid";
      memberName: string;
      rewardText: string;
      ringUpNote: string | null;
      eventId: string;
      visitAdded: boolean;
      /** Server-side timestamp taken right after the redemption commits (F2 panel — SPEC-WSB-F.md WS-F item 4). Not the exact DB row time, but within milliseconds of it — the redemption event itself carries no timestamp back through fn_redeem_grant. */
      redeemedAt: string;
    }
  | { kind: "already_used"; memberName: string; rewardText: string; redeemedAt: string }
  | { kind: "expired"; memberName: string; rewardText: string }
  | { kind: "choice_required"; memberName: string; rewardText: string }
  | { kind: "not_a_booth_code" }
  | { kind: "member_not_found" }
  | { kind: "invalid" };

function toVisitOutcome(result: RecordVisitResult): ScanOutcome {
  if (result.status === "visit_added") {
    return {
      kind: "visit_added",
      memberName: result.memberName ?? "",
      newGrants: result.newGrants,
      progressDisplays: result.progressDisplays,
    };
  }
  if (result.status === "already_today") {
    return { kind: "already_today", memberName: result.memberName ?? "" };
  }
  return { kind: "member_not_found" };
}

function toRedeemOutcome(result: RedeemResult): ScanOutcome {
  switch (result.status) {
    case "valid":
      return {
        kind: "redeem_valid",
        memberName: result.member_name,
        rewardText: result.reward_text,
        ringUpNote: result.ring_up_note,
        eventId: result.event_id,
        visitAdded: result.visit_added,
        redeemedAt: new Date().toISOString(),
      };
    case "already_used":
      return {
        kind: "already_used",
        memberName: result.member_name,
        rewardText: result.reward_text,
        redeemedAt: result.redeemed_at,
      };
    case "expired":
      return { kind: "expired", memberName: result.member_name, rewardText: result.reward_text };
    case "choice_required":
      return { kind: "choice_required", memberName: result.member_name, rewardText: result.reward_text };
    case "invalid":
      return { kind: "invalid" };
  }
}

/** Decodes a scanned QR payload and routes it per M4-STAFF-SPEC.md's prefix rules. */
export async function scanPayload(slug: string, payload: string): Promise<ScanOutcome> {
  const { restaurant, staffPinId } = await requireStaffSession(slug);
  if (payload.startsWith("bl:m:")) {
    const qrToken = payload.slice(5);
    const result = await recordVisit({ qrToken, source: "staff_scan", staffPinId });
    const outcome = toVisitOutcome(result);
    if (outcome.kind === "visit_added" && outcome.newGrants.length > 0) {
      const member = await getMemberByQrToken(qrToken);
      if (member) await notifyNewGrants(member, restaurant, outcome.newGrants);
    }
    return outcome;
  }
  if (payload.startsWith("bl:r:")) {
    const result = await redeemReward(payload.slice(5), "staff_scan", staffPinId);
    return toRedeemOutcome(result);
  }
  return { kind: "not_a_booth_code" };
}

export async function undoAction(slug: string, eventId: string): Promise<UndoResult> {
  const { staffPinId } = await requireStaffSession(slug);
  return undoEvent(eventId, staffPinId);
}

// ---------------------------------------------------------------------------
// Phone lookup tab
// ---------------------------------------------------------------------------

export type MemberLookupResult =
  | { found: false }
  | {
      found: true;
      memberId: string;
      name: string;
      progress: { label: string }[];
      grants: {
        grantId: string;
        token: string;
        rewardText: string;
        ringUpNote: string | null;
        options: { reward: string; ring_up_note?: string | null }[] | null;
        chosenAt: string | null;
      }[];
    };

export async function lookupPhone(slug: string, phone: string): Promise<MemberLookupResult> {
  const { restaurant } = await requireStaffSession(slug);
  const member = await findMemberByPhone(restaurant.id, phone);
  if (!member) return { found: false };
  const card = await getMemberCard(member.id);
  if (!card) return { found: false };
  return {
    found: true,
    memberId: card.member.id,
    name: card.member.name,
    progress: card.progress.map((p) => ({ label: p.display.label })),
    grants: card.activeGrants.map((g) => ({
      grantId: g.id,
      token: g.one_use_token,
      rewardText: g.reward_text,
      ringUpNote: g.ring_up_note,
      options: g.reward_options,
      chosenAt: g.chosen_at,
    })),
  };
}

/**
 * Staff stamps the diner's spoken pick on an unchosen multi-option grant
 * (item 3, SPEC-WS3.md) — never a silent default. Phone-lookup only; the
 * scan tab has no member context to ask "naan or dessert?" mid-scan.
 */
export async function chooseGrant(
  slug: string,
  memberId: string,
  grantId: string,
  optionIndex: number
): Promise<ChooseGrantOptionResult> {
  await requireStaffSession(slug);
  return chooseGrantOption({ grantId, memberId, optionIndex });
}

export async function recordVisitLookup(slug: string, memberId: string): Promise<ScanOutcome> {
  const { restaurant, staffPinId } = await requireStaffSession(slug);
  const result = await recordVisit({ memberId, source: "lookup", staffPinId });
  const outcome = toVisitOutcome(result);
  if (outcome.kind === "visit_added" && outcome.newGrants.length > 0) {
    await notifyNewGrants({ id: memberId }, restaurant, outcome.newGrants);
  }
  return outcome;
}

export async function redeemLookup(slug: string, token: string): Promise<ScanOutcome> {
  const { staffPinId } = await requireStaffSession(slug);
  const result = await redeemReward(token, "lookup", staffPinId);
  return toRedeemOutcome(result);
}

// ---------------------------------------------------------------------------
// Redemptions today tab
// ---------------------------------------------------------------------------

export type RedemptionRow = {
  id: string;
  createdAt: string;
  source: EventSource;
  voided: boolean;
  memberName: string;
  rewardText: string;
};

export async function getRedemptionsToday(slug: string): Promise<RedemptionRow[]> {
  const { restaurant } = await requireStaffSession(slug);
  const admin = createSupabaseAdminClient();
  const { start, end } = localDayRangeUtc(restaurant.timezone);

  const { data: events, error } = await admin
    .from("events")
    .select("id, created_at, source, voided, member_id, grant_id")
    .eq("restaurant_id", restaurant.id)
    .eq("type", "redemption")
    .gte("created_at", start)
    .lt("created_at", end)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const rows = events ?? [];
  if (rows.length === 0) return [];

  const memberIds = [...new Set(rows.map((r) => r.member_id as string))];
  const grantIds = [...new Set(rows.map((r) => r.grant_id as string | null).filter((g): g is string => !!g))];

  const [{ data: members, error: membersError }, { data: grants, error: grantsError }] = await Promise.all([
    admin.from("members").select("id, name").in("id", memberIds),
    admin.from("reward_grants").select("id, reward_text").in("id", grantIds.length > 0 ? grantIds : [""]),
  ]);
  if (membersError) throw membersError;
  if (grantsError) throw grantsError;

  const memberNameById = new Map((members ?? []).map((m) => [m.id as string, m.name as string]));
  const rewardTextById = new Map((grants ?? []).map((g) => [g.id as string, g.reward_text as string]));

  return rows.map((r) => ({
    id: r.id as string,
    createdAt: r.created_at as string,
    source: r.source as EventSource,
    voided: r.voided as boolean,
    memberName: memberNameById.get(r.member_id as string) ?? "Unknown",
    rewardText: r.grant_id ? (rewardTextById.get(r.grant_id as string) ?? "") : "",
  }));
}
