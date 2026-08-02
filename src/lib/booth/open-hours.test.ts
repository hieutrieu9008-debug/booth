import { describe, expect, it } from "vitest";
import { DAY_ORDER, isOpenNow, todayHoursLabel, type DayKey, type OpenHours } from "./open-hours";

// UTC-anchored fixed instants so tests never depend on the machine's local
// timezone or the day the suite happens to run — the "today"/"yesterday" day
// keys are derived from the same fixed date rather than hardcoded, since
// which weekday July 22 2026 falls on isn't something worth hand-verifying.
function dateAt(hour: number, minute = 0): Date {
  return new Date(Date.UTC(2026, 6, 22, hour, minute));
}
const BASE = dateAt(12, 0);
const TODAY: DayKey = DAY_ORDER[BASE.getUTCDay()];
const YESTERDAY: DayKey = DAY_ORDER[(BASE.getUTCDay() + 6) % 7];

describe("isOpenNow", () => {
  it("missing config (null/undefined/empty) is always open", () => {
    expect(isOpenNow(null, "UTC", dateAt(3))).toBe(true);
    expect(isOpenNow(undefined, "UTC", dateAt(3))).toBe(true);
    expect(isOpenNow({}, "UTC", dateAt(3))).toBe(true);
  });

  it("a day explicitly null, or absent once other days are configured, is closed", () => {
    const hours: OpenHours = { [YESTERDAY]: { open: "09:00", close: "17:00" } };
    expect(isOpenNow({ ...hours, [TODAY]: null }, "UTC", dateAt(12))).toBe(false);
    expect(isOpenNow(hours, "UTC", dateAt(12))).toBe(false); // TODAY absent entirely
  });

  it("same-day window: open at the open boundary, closed at the close boundary", () => {
    const hours: OpenHours = { [TODAY]: { open: "09:00", close: "17:00" } };
    expect(isOpenNow(hours, "UTC", dateAt(9, 0))).toBe(true); // open boundary, inclusive
    expect(isOpenNow(hours, "UTC", dateAt(16, 59))).toBe(true);
    expect(isOpenNow(hours, "UTC", dateAt(17, 0))).toBe(false); // close boundary, exclusive
    expect(isOpenNow(hours, "UTC", dateAt(8, 59))).toBe(false);
  });

  it("overnight window (close < open) stays open past midnight", () => {
    const hours: OpenHours = { [TODAY]: { open: "22:00", close: "02:00" } };
    expect(isOpenNow(hours, "UTC", dateAt(23, 0))).toBe(true); // same day, past open
    expect(isOpenNow(hours, "UTC", dateAt(10, 0))).toBe(false); // same day, before open, no yesterday config
  });

  it("overnight window bleeds into today from yesterday's config", () => {
    const hours: OpenHours = { [YESTERDAY]: { open: "22:00", close: "02:00" } };
    expect(isOpenNow(hours, "UTC", dateAt(0, 30))).toBe(true); // just after midnight, before yesterday's close
    expect(isOpenNow(hours, "UTC", dateAt(2, 0))).toBe(false); // at yesterday's close boundary
    expect(isOpenNow(hours, "UTC", dateAt(3, 0))).toBe(false);
  });

  it("close === open is treated as open 24h (degenerate config)", () => {
    const hours: OpenHours = { [TODAY]: { open: "10:00", close: "10:00" } };
    expect(isOpenNow(hours, "UTC", dateAt(3, 0))).toBe(true);
  });
});

describe("todayHoursLabel", () => {
  it("labels missing config as always open", () => {
    expect(todayHoursLabel(null, "UTC", dateAt(3))).toBe("always open");
  });

  it("labels an explicitly closed day", () => {
    expect(todayHoursLabel({ [TODAY]: null }, "UTC", dateAt(3))).toBe("closed today");
  });

  it("labels a configured day's window", () => {
    expect(todayHoursLabel({ [TODAY]: { open: "11:00", close: "23:00" } }, "UTC", dateAt(3))).toBe("11:00–23:00");
  });
});
