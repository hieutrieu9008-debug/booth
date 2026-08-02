import { describe, expect, it } from "vitest";
import {
  CRON_GRANULARITY_MINUTES,
  formatWallTimeSummary,
  generateTimeOptions,
  isStaleSending,
  isTooFarInPast,
  staleSendingCutoffIso,
  wallTimeToUtc,
} from "./schedule";

const LONDON = "Europe/London";
const CHICAGO = "America/Chicago";

describe("wallTimeToUtc", () => {
  it("GMT (winter, offset 0)", () => {
    expect(wallTimeToUtc("2026-01-15", "09:00", LONDON)).toBe("2026-01-15T09:00:00.000Z");
  });

  it("BST (summer, +1h)", () => {
    expect(wallTimeToUtc("2026-07-15", "14:00", LONDON)).toBe("2026-07-15T13:00:00.000Z");
  });

  it("GMT/BST spring-forward boundary — just before the jump (still GMT)", () => {
    expect(wallTimeToUtc("2026-03-29", "00:30", LONDON)).toBe("2026-03-29T00:30:00.000Z");
  });

  it("GMT/BST spring-forward boundary — just after the jump (already BST)", () => {
    expect(wallTimeToUtc("2026-03-29", "03:00", LONDON)).toBe("2026-03-29T02:00:00.000Z");
  });

  it("GMT/BST spring-forward gap (01:30 doesn't exist — clocks jump 01:00→02:00): resolves to the post-transition instant", () => {
    const result = wallTimeToUtc("2026-03-29", "01:30", LONDON);
    // Post-transition means the real local time read back is >= 02:00 (BST), not the pre-transition 01:30 GMT reading.
    const localHour = new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, hour: "numeric", hour12: false }).format(
      new Date(result),
    );
    expect(Number(localHour) % 24).toBeGreaterThanOrEqual(2);
  });

  it("America/Chicago CST (winter, -6h)", () => {
    expect(wallTimeToUtc("2026-01-15", "09:00", CHICAGO)).toBe("2026-01-15T15:00:00.000Z");
  });

  it("America/Chicago CDT (summer, -5h)", () => {
    expect(wallTimeToUtc("2026-07-15", "14:00", CHICAGO)).toBe("2026-07-15T19:00:00.000Z");
  });

  it("America/Chicago spring-forward gap (02:30 doesn't exist — clocks jump 02:00→03:00): resolves post-transition", () => {
    const result = wallTimeToUtc("2026-03-08", "02:30", CHICAGO);
    const localHour = new Intl.DateTimeFormat("en-GB", { timeZone: CHICAGO, hour: "numeric", hour12: false }).format(
      new Date(result),
    );
    expect(Number(localHour) % 24).toBeGreaterThanOrEqual(3);
  });
});

describe("isTooFarInPast", () => {
  it("rejects a time well in the past", () => {
    const past = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    expect(isTooFarInPast(past)).toBe(true);
  });
  it("allows a time within the grace window (clock skew)", () => {
    const almostNow = new Date(Date.now() - 60 * 1000).toISOString();
    expect(isTooFarInPast(almostNow)).toBe(false);
  });
  it("allows a future time", () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    expect(isTooFarInPast(future)).toBe(false);
  });
});

describe("generateTimeOptions", () => {
  it("GB gets 24h labels equal to the value", () => {
    const options = generateTimeOptions("GB");
    expect(options.find((o) => o.value === "14:30")?.label).toBe("14:30");
    expect(options.find((o) => o.value === "00:00")?.label).toBe("00:00");
  });
  it("US gets AM/PM labels", () => {
    const options = generateTimeOptions("US");
    expect(options.find((o) => o.value === "14:30")?.label).toBe("2:30 PM");
    expect(options.find((o) => o.value === "00:00")?.label).toBe("12:00 AM");
    expect(options.find((o) => o.value === "12:00")?.label).toBe("12:00 PM");
  });
  it("steps in 15-minute increments matching cron granularity", () => {
    const options = generateTimeOptions("GB");
    expect(options.length).toBe((24 * 60) / CRON_GRANULARITY_MINUTES);
    expect(options[1].value).toBe("00:15");
  });
});

describe("formatWallTimeSummary", () => {
  it("renders the resolved instant in the restaurant's own timezone", () => {
    const summary = formatWallTimeSummary("2026-07-15T13:00:00.000Z", LONDON);
    expect(summary).toContain("14:00"); // BST +1h from the UTC instant
  });
});

describe("stale-`sending` claim logic", () => {
  it("staleSendingCutoffIso is `minutes` before now", () => {
    const now = new Date("2026-07-18T12:00:00.000Z");
    expect(staleSendingCutoffIso(now, 30)).toBe("2026-07-18T11:30:00.000Z");
  });

  it("isStaleSending is false for non-'sending' statuses", () => {
    const now = new Date("2026-07-18T12:00:00.000Z");
    expect(isStaleSending("sent", "2026-07-18T11:00:00.000Z", now)).toBe(false);
    expect(isStaleSending("scheduled", "2026-07-18T11:00:00.000Z", now)).toBe(false);
  });

  it("isStaleSending is false with no scheduled_for", () => {
    const now = new Date("2026-07-18T12:00:00.000Z");
    expect(isStaleSending("sending", null, now)).toBe(false);
  });

  it("isStaleSending is true once 'sending' has aged past the threshold", () => {
    const now = new Date("2026-07-18T12:00:00.000Z");
    expect(isStaleSending("sending", "2026-07-18T11:29:00.000Z", now)).toBe(true); // 31 min ago
    expect(isStaleSending("sending", "2026-07-18T11:31:00.000Z", now)).toBe(false); // 29 min ago
  });
});
