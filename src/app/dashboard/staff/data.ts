import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import type { StaffPin } from "@/lib/booth/types";

export type StaffPinActivity = {
  visits: number;
  redemptions: number;
  undos: number;
  lastActiveAt: string | null;
};

export type StaffPinWithActivity = StaffPin & { activity: StaffPinActivity };

const EMPTY_ACTIVITY: StaffPinActivity = { visits: 0, redemptions: 0, undos: 0, lastActiveAt: null };

/**
 * Staff PINs plus per-PIN activity (SPEC-WSB-F.md WS-F item 2, "F1 — Per-PIN
 * activity"): visits/redemptions attributed via events.staff_pin_id (who
 * scanned/looked up), undos attributed via events.voided_by_staff_pin_id (who
 * ran the undo — may be a different PIN than the one who redeemed). Plain
 * in-memory aggregation over the restaurant's events, not a SQL view/RPC —
 * this is a small per-tenant table, not a reporting surface.
 *
 * Codex #15: visits/redemptions only count events that are still
 * `voided=false` — "effective activity", not "every attempt ever made".
 * A visit or redemption that was later undone stays out of those totals
 * (it already counts toward `undos` via the voided_by_staff_pin_id branch
 * below); undos themselves are never voided and always count.
 */
export async function getStaffPins(restaurantId: string): Promise<StaffPinWithActivity[]> {
  const admin = createSupabaseAdminClient();
  const { data: pins, error } = await admin
    .from("staff_pins")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const pinRows = (pins ?? []) as StaffPin[];
  if (pinRows.length === 0) return [];

  const { data: events, error: eventsError } = await admin
    .from("events")
    .select("type, staff_pin_id, voided, voided_at, voided_by_staff_pin_id, created_at")
    .eq("restaurant_id", restaurantId)
    .or("staff_pin_id.not.is.null,voided_by_staff_pin_id.not.is.null");
  if (eventsError) throw eventsError;

  const activityByPin = new Map<string, StaffPinActivity>();
  function touch(pinId: string, at: string): StaffPinActivity {
    const existing = activityByPin.get(pinId) ?? { ...EMPTY_ACTIVITY };
    if (!existing.lastActiveAt || at > existing.lastActiveAt) existing.lastActiveAt = at;
    activityByPin.set(pinId, existing);
    return existing;
  }

  for (const e of events ?? []) {
    const staffPinId = e.staff_pin_id as string | null;
    const createdAt = e.created_at as string;
    if (staffPinId) {
      const activity = touch(staffPinId, createdAt);
      // Effective activity only: an undone visit/redemption stays out of
      // these totals (it's already reflected in `undos` below).
      if (!e.voided) {
        if (e.type === "visit") activity.visits += 1;
        if (e.type === "redemption") activity.redemptions += 1;
      }
    }
    const voidedByPinId = e.voided_by_staff_pin_id as string | null;
    const voidedAt = e.voided_at as string | null;
    if (voidedByPinId && voidedAt) {
      const activity = touch(voidedByPinId, voidedAt);
      activity.undos += 1;
    }
  }

  return pinRows.map((p) => ({ ...p, activity: activityByPin.get(p.id) ?? { ...EMPTY_ACTIVITY } }));
}
