/**
 * WS-D — region-aware notable dates for the messages calendar. Only
 * dates we're certain of: fixed-date holidays, plus a small set of
 * well-known "nth weekday of month" rules and UK Mothering Sunday (computed
 * from Easter). No invented/approximate dates beyond these named rules.
 * Pure, no DB — safe to import client-side for the calendar's month view.
 */

export type NotableDate = { date: string; label: string }; // date = "YYYY-MM-DD"
export type NotableDateCountry = "GB" | "US";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function fmt(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** Day-of-month for the nth occurrence of `weekday` (0=Sun..6=Sat) in `month` of `year`. */
function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): number {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const offset = (weekday - firstWeekday + 7) % 7;
  return 1 + offset + (n - 1) * 7;
}

/** Anonymous Gregorian algorithm (Meeus/Jones/Butcher) — Easter Sunday for `year`. */
export function easterDate(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

/** UK Mothering Sunday: the 4th Sunday of Lent = Easter Sunday minus 21 days. */
function ukMothersDay(year: number): { year: number; month: number; day: number } {
  const easter = easterDate(year);
  const d = new Date(Date.UTC(year, easter.month - 1, easter.day) - 21 * 24 * 60 * 60 * 1000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/**
 * Fixed-date + rule-computed notable dates for a restaurant's country, for
 * one calendar year. GB and US sets per the plan (no invented dates):
 *  - GB: Valentine's, Mothering Sunday (computed), Father's Day, Halloween,
 *    Bonfire Night, Christmas, New Year's Eve.
 *  - US: Valentine's, Super Bowl Sunday (2nd Sun Feb), Mother's Day (2nd Sun
 *    May), Father's Day (3rd Sun June), 4th of July, Thanksgiving (4th Thu
 *    Nov), Christmas, New Year's Eve.
 */
export function notableDatesForCountry(country: NotableDateCountry, year: number): NotableDate[] {
  const dates: NotableDate[] = [{ date: fmt(year, 2, 14), label: "Valentine's Day" }];
  const fathersDay = nthWeekdayOfMonth(year, 6, 0, 3); // 3rd Sunday of June, both markets

  if (country === "US") {
    dates.push({ date: fmt(year, 2, nthWeekdayOfMonth(year, 2, 0, 2)), label: "Super Bowl Sunday" });
    dates.push({ date: fmt(year, 5, nthWeekdayOfMonth(year, 5, 0, 2)), label: "Mother's Day" });
    dates.push({ date: fmt(year, 6, fathersDay), label: "Father's Day" });
    dates.push({ date: fmt(year, 7, 4), label: "4th of July" });
    dates.push({ date: fmt(year, 11, nthWeekdayOfMonth(year, 11, 4, 4)), label: "Thanksgiving" });
  } else {
    const mothersDay = ukMothersDay(year);
    dates.push({ date: fmt(mothersDay.year, mothersDay.month, mothersDay.day), label: "Mother's Day (Mothering Sunday)" });
    dates.push({ date: fmt(year, 6, fathersDay), label: "Father's Day" });
    dates.push({ date: fmt(year, 10, 31), label: "Halloween" });
    dates.push({ date: fmt(year, 11, 5), label: "Bonfire Night" });
  }

  dates.push({ date: fmt(year, 12, 25), label: "Christmas Day" });
  dates.push({ date: fmt(year, 12, 31), label: "New Year's Eve" });

  return dates.sort((a, b) => a.date.localeCompare(b.date));
}
