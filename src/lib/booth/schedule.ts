/**
 * A3 — scheduling correctness. Pure date/time math: wall-clock <-> UTC
 * conversion for the message composer's scheduler, time-picker step
 * generation, past-time rejection, and stale-`sending` staleness math.
 *
 * No DB, no "server-only": safe to import from the client composer AND
 * from server actions / the cron route. DB-touching reclaim logic lives
 * next to its callers (actions.ts, api/cron/campaigns/route.ts), not here.
 */

/** Matches the cron's polling granularity — picking a finer time doesn't buy earlier delivery. */
export const CRON_GRANULARITY_MINUTES = 15;

/** Grace window for "reject past times" — guards against clock skew between browser and server, not a real scheduling allowance. */
export const PAST_GRACE_MINUTES = 2;

/** A campaign stuck in 'sending' longer than this is presumed stalled (crashed mid-run) and eligible for reclaim. */
export const STALE_SENDING_MINUTES = 30;

function partsInZone(ms: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
  }).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { y: get("year"), mo: get("month"), d: get("day"), h: get("hour") % 24, mi: get("minute"), s: get("second") };
}

/** The wall-clock time `ms` reads as in `timeZone`, re-expressed as a UTC-labeled ms value (i.e. "naive local ms"). */
function impliedLocalMs(ms: number, timeZone: string): number {
  const p = partsInZone(ms, timeZone);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
}

/**
 * Converts a restaurant wall-clock date ("YYYY-MM-DD") + time ("HH:mm") to
 * the UTC instant, using the Intl offset-probe technique (fixed-point
 * iteration on the implied local time — same idiom as
 * src/lib/sms/quiet-hours.ts's localParts, generalized to a full instant).
 *
 * DST handling:
 *  - Normal offset (no transition in play): converges in 1-2 iterations.
 *  - Spring-forward gap (the requested local time doesn't exist, e.g.
 *    01:30 on a "clocks go 01:00→02:00" day): the iteration cycles between
 *    the pre/post-transition candidates. We detect the cycle and return the
 *    later (post-transition) instant, matching how most tz libraries
 *    resolve a nonexistent local time.
 */
export function wallTimeToUtc(dateStr: string, timeStr: string, timeZone: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hour, minute] = timeStr.split(":").map(Number);
  const targetLocalMs = Date.UTC(year, month - 1, day, hour, minute, 0);

  let guess = targetLocalMs;
  const seen: number[] = [];
  for (let i = 0; i < 6; i++) {
    const diff = targetLocalMs - impliedLocalMs(guess, timeZone);
    if (diff === 0) break;
    const next = guess + diff;
    if (seen.includes(next)) {
      // Nonexistent local time: oscillating between two candidates — pick
      // the later (post-transition) one.
      guess = Math.max(guess, next);
      break;
    }
    seen.push(guess);
    guess = next;
  }
  return new Date(guess).toISOString();
}

/** True when `utcIso` is more than `graceMinutes` in the past relative to `now` — the server-side past-time reject. */
export function isTooFarInPast(utcIso: string, now = new Date(), graceMinutes = PAST_GRACE_MINUTES): boolean {
  return new Date(utcIso).getTime() < now.getTime() - graceMinutes * 60 * 1000;
}

/** Human-readable resolved send time in the restaurant's own timezone, for the composer's pre-submit summary line. */
export function formatWallTimeSummary(utcIso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(utcIso));
}

export type TimeOption = { value: string; label: string };

function to12h(hour: number, minute: number): string {
  const period = hour < 12 ? "AM" : "PM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${period}`;
}

/** 15-min-step options for the whole day. US-country restaurants get AM/PM labels; everyone else gets 24h. */
export function generateTimeOptions(country: string): TimeOption[] {
  const use12h = country === "US";
  const options: TimeOption[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += CRON_GRANULARITY_MINUTES) {
      const value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      options.push({ value, label: use12h ? to12h(h, m) : value });
    }
  }
  return options;
}

/** Query-side cutoff: campaigns with scheduled_for older than this (and still 'sending') are stale. */
export function staleSendingCutoffIso(now = new Date(), minutes = STALE_SENDING_MINUTES): string {
  return new Date(now.getTime() - minutes * 60 * 1000).toISOString();
}

/**
 * Row-side stale predicate (mirrors the query above) — used for display
 * (History's "stalled" flag) since campaigns has no updated_at column to
 * time a 'sending' claim from; scheduled_for is the best available proxy.
 * Caveat: a legitimately large in-progress campaign that's still on its
 * first run past 30 minutes will also read as "stalled" by this heuristic —
 * there's no way to distinguish that from a genuinely crashed run without a
 * timestamp that updates on claim (see schema note in the cron route).
 */
export function isStaleSending(
  status: string,
  scheduledFor: string | null,
  now = new Date(),
  minutes = STALE_SENDING_MINUTES,
): boolean {
  if (status !== "sending" || !scheduledFor) return false;
  return new Date(scheduledFor).getTime() < now.getTime() - minutes * 60 * 1000;
}
