/**
 * Quiet-hours math (pure; unit-tested). Marketing sends pause at
 * quiet_hours_start (e.g. 20 = 8pm local) and resume at quiet_hours_end
 * (e.g. 8 = 8am local). Transactional messages are exempt (PRD).
 *
 * PLATFORM_QUIET_START/END are the hard-coded compliance floor (AGENTS.md:
 * "Compliance floor is hard-coded, never per-tenant-overridable"). A
 * restaurant's quiet_hours_start/end may only WIDEN the quiet window beyond
 * the floor — never narrow it. Marketing consumers must call the
 * floor-aware wrappers (isQuietForMarketing / nextMarketingWindowOpen)
 * below, never the raw inQuietHours/nextWindowOpen, so a misconfigured or
 * malicious tenant row (e.g. start === end, or a narrower window) can never
 * disable the floor.
 */

export const PLATFORM_QUIET_START = 20;
export const PLATFORM_QUIET_END = 8;

function localParts(now: Date, timeZone: string): { hour: number; y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "numeric",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { hour: get("hour") % 24, y: get("year"), m: get("month"), d: get("day") };
}

export function inQuietHours(startHour: number, endHour: number, timeZone: string, now = new Date()): boolean {
  const { hour } = localParts(now, timeZone);
  if (startHour === endHour) return false; // degenerate config = never quiet
  if (startHour > endHour) {
    // window wraps midnight (20 → 8)
    return hour >= startHour || hour < endHour;
  }
  return hour >= startHour && hour < endHour;
}

/**
 * Next moment (UTC) the marketing window opens: today at endHour local if
 * still ahead, else tomorrow at endHour local. Computed by scanning hourly
 * UTC candidates — timezone-safe without a tz library.
 */
export function nextWindowOpen(startHour: number, endHour: number, timeZone: string, now = new Date()): Date {
  const candidate = new Date(now);
  candidate.setUTCMinutes(0, 5, 0); // hh:00:05 — just past the hour boundary
  for (let i = 0; i < 49; i++) {
    candidate.setTime(candidate.getTime() + 60 * 60 * 1000);
    if (!inQuietHours(startHour, endHour, timeZone, candidate) &&
        localParts(candidate, timeZone).hour === endHour % 24) {
      return new Date(candidate);
    }
  }
  // Unreachable with sane configs; fall back to +12h rather than dropping the send.
  return new Date(now.getTime() + 12 * 60 * 60 * 1000);
}

/**
 * Floor-aware quiet check for marketing sends: quiet if the tenant's
 * configured window says quiet, OR the platform floor (20:00-08:00) says
 * quiet — whichever is wider wins. This is the only quiet-hours check
 * marketing dispatch paths may use.
 */
export function isQuietForMarketing(
  tenantStart: number,
  tenantEnd: number,
  timeZone: string,
  now = new Date(),
): boolean {
  return (
    inQuietHours(tenantStart, tenantEnd, timeZone, now) ||
    inQuietHours(PLATFORM_QUIET_START, PLATFORM_QUIET_END, timeZone, now)
  );
}

/**
 * Next moment (UTC) neither the tenant window nor the platform floor is
 * quiet — the combined window's open. Same hourly-scan approach as
 * nextWindowOpen, but against the floor-aware check so a narrowing tenant
 * config can't pull the "open" moment earlier than the floor allows.
 */
export function nextMarketingWindowOpen(
  tenantStart: number,
  tenantEnd: number,
  timeZone: string,
  now = new Date(),
): Date {
  const candidate = new Date(now);
  candidate.setUTCMinutes(0, 5, 0); // hh:00:05 — just past the hour boundary
  for (let i = 0; i < 49; i++) {
    candidate.setTime(candidate.getTime() + 60 * 60 * 1000);
    if (!isQuietForMarketing(tenantStart, tenantEnd, timeZone, candidate)) {
      return new Date(candidate);
    }
  }
  // Unreachable with sane configs; fall back to +12h rather than dropping the send.
  return new Date(now.getTime() + 12 * 60 * 60 * 1000);
}
