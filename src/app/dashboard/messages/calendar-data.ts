"use server";

import { requireOwnerRestaurant } from "@/lib/owner";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { localYMD } from "@/lib/booth/engine";

export type CalendarDots = Record<string, number>; // "YYYY-MM-DD" -> count of scheduled/sent campaigns that day

/**
 * Scheduled/sent campaign counts per restaurant-local day, for the given
 * month (1-12) of `year`. Called from the client Calendar on month
 * navigation — restaurant scoping comes from the owner session, never a
 * client-supplied id.
 */
export async function getCalendarMonthDotsAction(year: number, month: number): Promise<CalendarDots> {
  const restaurant = await requireOwnerRestaurant();
  const admin = createSupabaseAdminClient();

  const { data: restaurantRow, error: restaurantError } = await admin
    .from("restaurants")
    .select("timezone")
    .eq("id", restaurant.id)
    .single();
  if (restaurantError) throw restaurantError;
  const timezone = restaurantRow.timezone as string;

  const { data, error } = await admin
    .from("campaigns")
    .select("scheduled_for, sent_at, status")
    .eq("restaurant_id", restaurant.id)
    .in("status", ["scheduled", "sending", "sent"]);
  if (error) throw error;

  const dots: CalendarDots = {};
  for (const row of data ?? []) {
    const at = (row.sent_at as string | null) ?? (row.scheduled_for as string | null);
    if (!at) continue;
    const local = localYMD(timezone, new Date(at));
    if (local.year !== year || local.month !== month) continue;
    const key = `${local.year}-${String(local.month).padStart(2, "0")}-${String(local.day).padStart(2, "0")}`;
    dots[key] = (dots[key] ?? 0) + 1;
  }
  return dots;
}
