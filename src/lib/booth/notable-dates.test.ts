import { describe, expect, it } from "vitest";
import { easterDate, notableDatesForCountry } from "./notable-dates";

describe("easterDate", () => {
  it("matches known Gregorian Easter Sundays", () => {
    expect(easterDate(2024)).toEqual({ month: 3, day: 31 });
    expect(easterDate(2025)).toEqual({ month: 4, day: 20 });
    expect(easterDate(2026)).toEqual({ month: 4, day: 5 });
    expect(easterDate(2027)).toEqual({ month: 3, day: 28 });
  });
});

describe("notableDatesForCountry — GB", () => {
  const dates = notableDatesForCountry("GB", 2026);

  it("includes fixed-date holidays", () => {
    expect(dates).toContainEqual({ date: "2026-02-14", label: "Valentine's Day" });
    expect(dates).toContainEqual({ date: "2026-10-31", label: "Halloween" });
    expect(dates).toContainEqual({ date: "2026-11-05", label: "Bonfire Night" });
    expect(dates).toContainEqual({ date: "2026-12-25", label: "Christmas Day" });
    expect(dates).toContainEqual({ date: "2026-12-31", label: "New Year's Eve" });
  });

  it("computes Mothering Sunday as Easter minus 21 days (2026 Easter = 5 Apr)", () => {
    expect(dates).toContainEqual({ date: "2026-03-15", label: "Mother's Day (Mothering Sunday)" });
  });

  it("computes Father's Day as the 3rd Sunday of June", () => {
    expect(dates).toContainEqual({ date: "2026-06-21", label: "Father's Day" });
  });

  it("is sorted chronologically", () => {
    const sorted = [...dates].sort((a, b) => a.date.localeCompare(b.date));
    expect(dates).toEqual(sorted);
  });

  it("never invents a US-only date", () => {
    expect(dates.some((d) => d.label === "Thanksgiving")).toBe(false);
    expect(dates.some((d) => d.label === "4th of July")).toBe(false);
  });
});

describe("notableDatesForCountry — US", () => {
  const dates = notableDatesForCountry("US", 2026);

  it("includes fixed-date holidays", () => {
    expect(dates).toContainEqual({ date: "2026-02-14", label: "Valentine's Day" });
    expect(dates).toContainEqual({ date: "2026-07-04", label: "4th of July" });
    expect(dates).toContainEqual({ date: "2026-12-25", label: "Christmas Day" });
  });

  it("computes Super Bowl Sunday as the 2nd Sunday of February", () => {
    expect(dates).toContainEqual({ date: "2026-02-08", label: "Super Bowl Sunday" });
  });

  it("computes Mother's Day as the 2nd Sunday of May", () => {
    expect(dates).toContainEqual({ date: "2026-05-10", label: "Mother's Day" });
  });

  it("computes Father's Day as the 3rd Sunday of June", () => {
    expect(dates).toContainEqual({ date: "2026-06-21", label: "Father's Day" });
  });

  it("computes Thanksgiving as the 4th Thursday of November", () => {
    expect(dates).toContainEqual({ date: "2026-11-26", label: "Thanksgiving" });
  });

  it("never invents a GB-only date", () => {
    expect(dates.some((d) => d.label === "Bonfire Night")).toBe(false);
    expect(dates.some((d) => d.label.includes("Mothering"))).toBe(false);
  });
});
