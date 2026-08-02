import { localYMD } from "./engine";

/**
 * PURE week-bucketing helpers for the Overview trend charts — no I/O,
 * unit-testable (mirrors ladder.ts's split of pure math from I/O). Weeks are
 * restaurant-local, Monday-start, labeled by their Monday's 'YYYY-MM-DD'.
 * Uses the same "local Y/M/D treated as UTC ms" simplification as
 * engine.ts's birthdayMsForYear (no tz-conversion library in this codebase).
 */

/** Monday-start week label for the week containing `iso`, in `timeZone`. */
export function weekStartLabel(timeZone: string, iso: string): string {
  const { year, month, day } = localYMD(timeZone, new Date(iso));
  const dateUtc = Date.UTC(year, month - 1, day);
  const dow = new Date(dateUtc).getUTCDay(); // 0=Sun..6=Sat
  const offsetFromMonday = (dow + 6) % 7; // Mon=0..Sun=6
  const mondayUtc = dateUtc - offsetFromMonday * 24 * 60 * 60 * 1000;
  return new Date(mondayUtc).toISOString().slice(0, 10);
}

/** `label` (a 'YYYY-MM-DD' Monday) shifted by `n` weeks (n may be negative). */
export function addWeeks(label: string, n: number): string {
  const ms = new Date(`${label}T00:00:00.000Z`).getTime() + n * 7 * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Every Monday label from `from` to `to` inclusive (both already Monday labels; from <= to). */
export function weekRange(from: string, to: string): string[] {
  const labels: string[] = [];
  let cur = from;
  while (cur <= to) {
    labels.push(cur);
    cur = addWeeks(cur, 1);
  }
  return labels;
}

/** Counts of `isoTimestamps` grouped by their restaurant-local Monday-start week. Weeks with no events are simply absent (zero-fill happens at the range-building step, never faked here). */
export function bucketCountsByWeek(timeZone: string, isoTimestamps: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const iso of isoTimestamps) {
    const label = weekStartLabel(timeZone, iso);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return counts;
}

export type WeeklyPoint = { weekStart: string; visits: number; joins: number; redemptions: number; optOuts: number };

/**
 * PURE shaping step for the Overview trend charts: raw timestamp lists in,
 * a zero-filled Monday-start weekly series out (no I/O — chart-data.ts's
 * getWeeklySeries is a thin Supabase-fetching wrapper around this). Weeks
 * with genuinely no activity get an explicit 0, never omitted or faked.
 */
export function buildWeeklySeries(
  timeZone: string,
  raw: { visitIso: string[]; redemptionIso: string[]; joinIso: string[]; optOutIso: string[] },
  now: Date,
): WeeklyPoint[] {
  const visitCounts = bucketCountsByWeek(timeZone, raw.visitIso);
  const redemptionCounts = bucketCountsByWeek(timeZone, raw.redemptionIso);
  const joinCounts = bucketCountsByWeek(timeZone, raw.joinIso);
  const optOutCounts = bucketCountsByWeek(timeZone, raw.optOutIso);

  const nowLabel = weekStartLabel(timeZone, now.toISOString());
  const allLabels = [...visitCounts.keys(), ...redemptionCounts.keys(), ...joinCounts.keys(), ...optOutCounts.keys()];
  const earliestLabel = allLabels.length > 0 ? allLabels.reduce((a, b) => (a < b ? a : b)) : nowLabel;

  return weekRange(earliestLabel, nowLabel).map((weekStart) => ({
    weekStart,
    visits: visitCounts.get(weekStart) ?? 0,
    joins: joinCounts.get(weekStart) ?? 0,
    redemptions: redemptionCounts.get(weekStart) ?? 0,
    optOuts: optOutCounts.get(weekStart) ?? 0,
  }));
}
