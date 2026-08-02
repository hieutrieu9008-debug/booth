import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { notifyNewGrants } from "./engine";
import { progressDisplay, type ProgressDisplay } from "./ladder";
import { parseProgramConfig } from "./programs";
import { materializeGrants, type NewGrant } from "./rewards";
import type { EventSource, MemberProgress, RedeemResult, RewardProgram, UndoResult, VisitResult } from "./types";

/**
 * Server-side staff-action orchestration on top of the RPCs + pure ladder
 * math. One of three ways to identify the visiting member:
 *  - `memberId`: staff already resolved the member (e.g. phone lookup).
 *  - `qrToken`: member's own QR was scanned.
 *  - `selfScanToken` + `memberId`: diner self-check-in — the venue-wide code
 *    scanned must match the member's restaurant's self_scan_token.
 */
export type RecordVisitInput =
  | { memberId: string; source: EventSource; staffPinId?: string }
  | { qrToken: string; source: EventSource; staffPinId?: string }
  | { selfScanToken: string; memberId: string; source: EventSource; staffPinId?: string };

export type RecordVisitResult = {
  status: VisitResult["status"];
  memberName: string | null;
  newGrants: NewGrant[];
  progressDisplays: ProgressDisplay[];
};

export class InvalidSelfScanTokenError extends Error {
  constructor() {
    super("self_scan_token does not match this restaurant");
    this.name = "InvalidSelfScanTokenError";
  }
}

async function resolveMemberId(
  admin: SupabaseClient,
  input: RecordVisitInput
): Promise<string | null> {
  if ("selfScanToken" in input) {
    const { data: member, error } = await admin
      .from("members")
      .select("id, restaurant_id")
      .eq("id", input.memberId)
      .maybeSingle();
    if (error) throw error;
    if (!member) return null;
    const { data: restaurant, error: restaurantError } = await admin
      .from("restaurants")
      .select("self_scan_token")
      .eq("id", member.restaurant_id)
      .single();
    if (restaurantError) throw restaurantError;
    if (restaurant.self_scan_token !== input.selfScanToken) throw new InvalidSelfScanTokenError();
    return member.id;
  }
  if ("qrToken" in input) {
    const { data: member, error } = await admin
      .from("members")
      .select("id")
      .eq("qr_token", input.qrToken)
      .maybeSingle();
    if (error) throw error;
    return member?.id ?? null;
  }
  return input.memberId;
}

async function getProgressDisplays(admin: SupabaseClient, memberId: string): Promise<ProgressDisplay[]> {
  const { data: rows, error } = await admin
    .from("member_progress")
    .select("*, reward_programs!inner(*)")
    .eq("member_id", memberId)
    .eq("reward_programs.type", "visit_ladder")
    .eq("reward_programs.active", true);
  if (error) throw error;

  const displays: ProgressDisplay[] = [];
  for (const row of (rows ?? []) as (MemberProgress & { reward_programs: RewardProgram })[]) {
    const { reward_programs: program, ...progress } = row;
    const parsed = parseProgramConfig(program.type, program.config);
    if (parsed.type !== "visit_ladder") continue;
    displays.push(progressDisplay(parsed.config, progress));
  }
  return displays;
}

/** Records a visit, materializes any newly-earned ladder grants, and returns what the staff/diner screen needs. */
export async function recordVisit(input: RecordVisitInput): Promise<RecordVisitResult> {
  const admin = createSupabaseAdminClient();
  const memberId = await resolveMemberId(admin, input);
  if (!memberId) {
    return { status: "member_not_found", memberName: null, newGrants: [], progressDisplays: [] };
  }

  const { data, error } = await admin.rpc("fn_record_visit", {
    p_member_id: memberId,
    p_source: input.source,
    p_staff_pin_id: input.staffPinId ?? null,
  });
  if (error) throw error;
  const result = data as VisitResult;

  if (result.status !== "visit_added") {
    return {
      status: result.status,
      memberName: "member_name" in result ? result.member_name : null,
      newGrants: [],
      progressDisplays: [],
    };
  }

  const { newGrants } = await materializeGrants(memberId, result.event_id);
  const progressDisplays = await getProgressDisplays(admin, memberId);

  return { status: "visit_added", memberName: result.member_name, newGrants, progressDisplays };
}

/**
 * Redeems a one-use grant token. A redemption also atomically creates a
 * visit (fn_redeem_grant v2) — when that happened, materialize any
 * newly-earned ladder grants and notify, same as a normal scan [Cx2-3].
 * Idempotent: materializeGrants is grant_slot-unique, so a crash here
 * self-heals on the member's next scan.
 */
export async function redeemReward(
  token: string,
  source: EventSource,
  staffPinId?: string
): Promise<RedeemResult> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("fn_redeem_grant", {
    p_token: token,
    p_source: source,
    p_staff_pin_id: staffPinId ?? null,
  });
  if (error) throw error;
  const result = data as RedeemResult;

  if (result.status === "valid" && result.visit_added && result.visit_event_id) {
    const { newGrants } = await materializeGrants(result.member_id, result.visit_event_id);
    if (newGrants.length > 0) {
      const { data: restaurant, error: restaurantError } = await admin
        .from("restaurants")
        .select("id, name")
        .eq("id", result.restaurant_id)
        .single();
      if (restaurantError) throw restaurantError;
      await notifyNewGrants({ id: result.member_id }, restaurant, newGrants);
    }
  }

  return result;
}

/** Undoes a staff mis-scan (visit or redemption). */
export async function undoEvent(eventId: string, staffPinId?: string): Promise<UndoResult> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("fn_undo_event", {
    p_event_id: eventId,
    p_staff_pin_id: staffPinId ?? null,
  });
  if (error) throw error;
  return data as UndoResult;
}
