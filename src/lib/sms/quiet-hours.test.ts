import { describe, expect, it } from "vitest";
import {
  inQuietHours,
  isQuietForMarketing,
  nextMarketingWindowOpen,
  nextWindowOpen,
  PLATFORM_QUIET_END,
  PLATFORM_QUIET_START,
} from "./quiet-hours";

// London is UTC+1 in July (BST). Construct UTC instants for local-time cases.
const LONDON = "Europe/London";
const july = (utcHour: number, min = 0) => new Date(Date.UTC(2026, 6, 15, utcHour, min));

describe("inQuietHours (20 → 8 wrap-midnight window)", () => {
  it("is quiet at 21:00 local (20:00 UTC)", () => {
    expect(inQuietHours(20, 8, LONDON, july(20))).toBe(true);
  });
  it("is quiet at 03:00 local", () => {
    expect(inQuietHours(20, 8, LONDON, july(2))).toBe(true);
  });
  it("is quiet at exactly 20:00 local (boundary in)", () => {
    expect(inQuietHours(20, 8, LONDON, july(19))).toBe(true);
  });
  it("is NOT quiet at exactly 08:00 local (boundary out)", () => {
    expect(inQuietHours(20, 8, LONDON, july(7))).toBe(false);
  });
  it("is NOT quiet at 14:00 local", () => {
    expect(inQuietHours(20, 8, LONDON, july(13))).toBe(false);
  });
  it("degenerate equal hours = never quiet", () => {
    expect(inQuietHours(8, 8, LONDON, july(20))).toBe(false);
  });
  it("non-wrapping window (2 → 6) works", () => {
    expect(inQuietHours(2, 6, LONDON, july(2))).toBe(true); // 03:00 local
    expect(inQuietHours(2, 6, LONDON, july(13))).toBe(false);
  });
});

describe("nextWindowOpen", () => {
  it("from 21:00 local resolves to 08:00 local next morning", () => {
    const open = nextWindowOpen(20, 8, LONDON, july(20)); // 21:00 local
    const localHour = Number(
      new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, hour: "numeric", hour12: false })
        .format(open),
    );
    expect(localHour).toBe(8);
    expect(open.getTime()).toBeGreaterThan(july(20).getTime());
    // must be within ~12h of the queue moment
    expect(open.getTime() - july(20).getTime()).toBeLessThan(12 * 3600 * 1000);
  });
  it("from 02:00 local resolves to 08:00 the same morning", () => {
    const open = nextWindowOpen(20, 8, LONDON, july(1)); // 02:00 local
    const diffH = (open.getTime() - july(1).getTime()) / 3600000;
    expect(diffH).toBeGreaterThan(4);
    expect(diffH).toBeLessThanOrEqual(7);
  });
  it("result is not inside quiet hours", () => {
    const open = nextWindowOpen(20, 8, LONDON, july(23, 30));
    expect(inQuietHours(20, 8, LONDON, open)).toBe(false);
  });
});

describe("platform quiet-hours floor (20:00-08:00, never tenant-overridable)", () => {
  it("PLATFORM_QUIET_START/END are the 20/8 floor", () => {
    expect(PLATFORM_QUIET_START).toBe(20);
    expect(PLATFORM_QUIET_END).toBe(8);
  });

  it("degenerate tenant config (start === end, 'never quiet') still blocks 20:00-08:00", () => {
    // Raw inQuietHours would say "never quiet" for a degenerate tenant row —
    // isQuietForMarketing must still enforce the floor.
    expect(inQuietHours(8, 8, LONDON, july(21))).toBe(false); // raw check: the bug this floor covers
    expect(isQuietForMarketing(8, 8, LONDON, july(21))).toBe(true); // 22:00 local
    expect(isQuietForMarketing(8, 8, LONDON, july(2))).toBe(true); // 03:00 local
    expect(isQuietForMarketing(8, 8, LONDON, july(19))).toBe(true); // 20:00 local (boundary in)
    expect(isQuietForMarketing(8, 8, LONDON, july(7))).toBe(false); // 08:00 local (boundary out)
    expect(isQuietForMarketing(8, 8, LONDON, july(13))).toBe(false); // 14:00 local
  });

  it("tenant widening (19-9) is respected outside the platform floor", () => {
    // Wider than the 20-8 floor on both ends — the tenant's extra hour
    // (19:00-20:00 and 08:00-09:00) must be honored, not clipped to the floor.
    expect(isQuietForMarketing(19, 9, LONDON, july(18, 30))).toBe(true); // 19:30 local
    expect(isQuietForMarketing(19, 9, LONDON, july(7, 30))).toBe(true); // 08:30 local
    expect(isQuietForMarketing(19, 9, LONDON, july(13))).toBe(false); // 14:00 local
  });

  it("tenant narrowing attempt (22-6) still blocks the full 20:00-08:00 floor", () => {
    // Tenant window is narrower than the floor on both ends — the floor must
    // still cover 20:00-22:00 and 06:00-08:00 even though the tenant row
    // claims those hours are open.
    expect(inQuietHours(22, 6, LONDON, july(19))).toBe(false); // raw tenant check: not yet 22:00
    expect(isQuietForMarketing(22, 6, LONDON, july(19))).toBe(true); // 20:00 local — floor still blocks
    expect(isQuietForMarketing(22, 6, LONDON, july(23, 30))).toBe(true); // 00:30 local — tenant blocks too
    expect(inQuietHours(22, 6, LONDON, july(6))).toBe(false); // raw tenant check: already past 06:00
    expect(isQuietForMarketing(22, 6, LONDON, july(6))).toBe(true); // 07:00 local — floor still blocks
    expect(isQuietForMarketing(22, 6, LONDON, july(13))).toBe(false); // 14:00 local — genuinely open
  });

  it("nextMarketingWindowOpen lands on the combined-window open, never earlier than the floor allows", () => {
    // Tenant narrower than the floor (22-6): the combined window can only
    // open at the floor's 08:00, not the tenant's 06:00.
    const openNarrow = nextMarketingWindowOpen(22, 6, LONDON, july(19)); // 20:00 local
    const narrowLocalHour = Number(
      new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, hour: "numeric", hour12: false }).format(openNarrow),
    );
    expect(narrowLocalHour).toBe(8);
    expect(isQuietForMarketing(22, 6, LONDON, openNarrow)).toBe(false);

    // Tenant wider than the floor (19-9): the combined window opens at the
    // tenant's later 09:00, not the floor's 08:00.
    const openWide = nextMarketingWindowOpen(19, 9, LONDON, july(18, 30)); // 19:30 local
    const wideLocalHour = Number(
      new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, hour: "numeric", hour12: false }).format(openWide),
    );
    expect(wideLocalHour).toBe(9);
    expect(isQuietForMarketing(19, 9, LONDON, openWide)).toBe(false);

    // Degenerate tenant config (8, 8): combined window is exactly the floor.
    const openDegenerate = nextMarketingWindowOpen(8, 8, LONDON, july(21)); // 22:00 local
    const degenerateLocalHour = Number(
      new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, hour: "numeric", hour12: false }).format(
        openDegenerate,
      ),
    );
    expect(degenerateLocalHour).toBe(8);
    expect(isQuietForMarketing(8, 8, LONDON, openDegenerate)).toBe(false);
  });
});
