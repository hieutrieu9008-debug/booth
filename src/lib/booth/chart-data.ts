import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { buildWeeklySeries, type WeeklyPoint } from "./weeks";

/**
 * Overview trend charts data — WS4. Computed live from full history on every
 * request (no rollup tables, per spec); the client slices the returned
 * series into the selected time range rather than refetching. Visits
 * includes auto-visits materialized by a redemption (they're `type='visit'`
 * events like any other — deliberate semantics, see README "Counting visits").
 * The zero-fill/bucketing shaping itself is pure and unit-tested in weeks.ts
 * (buildWeeklySeries) — this is just the Supabase-fetching wrapper around it.
 */

export type { WeeklyPoint };

export async function getWeeklySeries(restaurantId: string, timeZone: string, now = new Date()): Promise<WeeklyPoint[]> {
  const admin = createSupabaseAdminClient();

  const [visitsRes, redemptionsRes, membersRes] = await Promise.all([
    admin.from("events").select("created_at").eq("restaurant_id", restaurantId).eq("type", "visit").eq("voided", false),
    admin.from("events").select("created_at").eq("restaurant_id", restaurantId).eq("type", "redemption").eq("voided", false),
    admin.from("members").select("joined_at, opted_out_ts").eq("restaurant_id", restaurantId),
  ]);
  if (visitsRes.error) throw visitsRes.error;
  if (redemptionsRes.error) throw redemptionsRes.error;
  if (membersRes.error) throw membersRes.error;

  const visitIso = (visitsRes.data ?? []).map((r) => r.created_at as string);
  const redemptionIso = (redemptionsRes.data ?? []).map((r) => r.created_at as string);
  const joinIso = (membersRes.data ?? []).map((r) => r.joined_at as string);
  const optOutIso = (membersRes.data ?? [])
    .map((r) => r.opted_out_ts as string | null)
    .filter((v): v is string => v != null);

  return buildWeeklySeries(timeZone, { visitIso, redemptionIso, joinIso, optOutIso }, now);
}
