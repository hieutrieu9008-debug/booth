import { z } from "zod";

/**
 * Pure open-hours math (no I/O, unit-tested) — parses
 * `restaurants.open_hours` jsonb (app-validated only, per docs/ARCHITECTURE.md's
 * "Config schema versioning convention": {mon:{open,close}|null,...}, all
 * keys optional).
 *
 * Semantics:
 *  - The whole column missing/null (no config at all) -> always open. Most
 *    restaurants haven't configured hours yet; self-scan shouldn't lock them
 *    out by default.
 *  - A day explicitly set to `null`, or simply absent from the object once
 *    ANY hours are configured -> closed that day.
 *  - `close <= open` -> overnight window (open today, closes after midnight
 *    tomorrow); `close === open` is treated as open 24h (mirrors
 *    src/lib/sms/quiet-hours.ts's inQuietHours degenerate-config convention).
 */

export type DayKey = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";
export type DayHours = { open: string; close: string };
export type OpenHours = Partial<Record<DayKey, DayHours | null>>;

export const DAY_ORDER: DayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const timeRe = /^([01]\d|2[0-3]):([0-5]\d)$/;
const dayHoursSchema = z.object({ open: z.string().regex(timeRe), close: z.string().regex(timeRe) });
export const openHoursSchema: z.ZodType<OpenHours> = z.object({
  sun: dayHoursSchema.nullable().optional(),
  mon: dayHoursSchema.nullable().optional(),
  tue: dayHoursSchema.nullable().optional(),
  wed: dayHoursSchema.nullable().optional(),
  thu: dayHoursSchema.nullable().optional(),
  fri: dayHoursSchema.nullable().optional(),
  sat: dayHoursSchema.nullable().optional(),
});

function localDayAndMinutes(timeZone: string, now: Date): { day: DayKey; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const day = get("weekday").toLowerCase().slice(0, 3) as DayKey;
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  return { day, minutes: hour * 60 + minute };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function dayBefore(day: DayKey): DayKey {
  const idx = DAY_ORDER.indexOf(day);
  return DAY_ORDER[(idx + DAY_ORDER.length - 1) % DAY_ORDER.length];
}

/** True if `hours` (today's config) covers local minute-of-day `minutes`. */
function coversToday(hours: DayHours, minutes: number): boolean {
  const open = toMinutes(hours.open);
  const close = toMinutes(hours.close);
  if (close > open) return minutes >= open && minutes < close;
  if (close < open) return minutes >= open; // overnight: open today through midnight
  return true; // close === open -> degenerate config, treat as open 24h
}

/** True if yesterday's overnight window (close < open) bleeds into today before `close`. */
function coversFromYesterday(hours: DayHours, minutes: number): boolean {
  const open = toMinutes(hours.open);
  const close = toMinutes(hours.close);
  return close < open && minutes < close;
}

/** Whether the restaurant is open right now, restaurant-local time. No GPS — purely config + clock. */
export function isOpenNow(openHours: OpenHours | null | undefined, timeZone: string, now = new Date()): boolean {
  if (!openHours || Object.keys(openHours).length === 0) return true;
  const { day, minutes } = localDayAndMinutes(timeZone, now);
  const today = openHours[day];
  if (today && coversToday(today, minutes)) return true;
  const yesterday = openHours[dayBefore(day)];
  if (yesterday && coversFromYesterday(yesterday, minutes)) return true;
  return false;
}

/** Restaurant-local hours label for today, for the "we're closed right now" screen. */
export function todayHoursLabel(openHours: OpenHours | null | undefined, timeZone: string, now = new Date()): string {
  if (!openHours || Object.keys(openHours).length === 0) return "always open";
  const { day } = localDayAndMinutes(timeZone, now);
  const today = openHours[day];
  if (!today) return "closed today";
  return `${today.open}–${today.close}`;
}
