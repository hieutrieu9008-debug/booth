import { describe, expect, it } from "vitest";
import { addWeeks, buildWeeklySeries, bucketCountsByWeek, weekRange, weekStartLabel } from "./weeks";

describe("weekStartLabel", () => {
  it("returns the Monday of the week for a mid-week UTC-timezone date", () => {
    // 2026-07-15 is a Wednesday; that week's Monday is 2026-07-13.
    expect(weekStartLabel("UTC", "2026-07-15T10:00:00.000Z")).toBe("2026-07-13");
  });

  it("is idempotent on a Monday itself", () => {
    expect(weekStartLabel("UTC", "2026-07-13T00:00:00.000Z")).toBe("2026-07-13");
  });

  it("rolls a Sunday back to the prior Monday", () => {
    expect(weekStartLabel("UTC", "2026-07-19T23:00:00.000Z")).toBe("2026-07-13");
  });

  it("respects restaurant-local timezone, not just UTC", () => {
    // 2026-07-13 01:00 UTC is still 2026-07-12 (Sunday) in America/New_York (-04:00 in July).
    expect(weekStartLabel("America/New_York", "2026-07-13T01:00:00.000Z")).toBe("2026-07-06");
  });
});

describe("addWeeks", () => {
  it("shifts forward and backward by whole weeks", () => {
    expect(addWeeks("2026-07-13", 1)).toBe("2026-07-20");
    expect(addWeeks("2026-07-13", -1)).toBe("2026-07-06");
    expect(addWeeks("2026-07-13", 0)).toBe("2026-07-13");
  });
});

describe("weekRange", () => {
  it("enumerates every Monday inclusive", () => {
    expect(weekRange("2026-07-06", "2026-07-27")).toEqual(["2026-07-06", "2026-07-13", "2026-07-20", "2026-07-27"]);
  });

  it("returns a single label when from === to", () => {
    expect(weekRange("2026-07-13", "2026-07-13")).toEqual(["2026-07-13"]);
  });
});

describe("bucketCountsByWeek", () => {
  it("counts timestamps into their local week, leaving empty weeks absent (no faked zeros baked in)", () => {
    const counts = bucketCountsByWeek("UTC", [
      "2026-07-13T09:00:00.000Z",
      "2026-07-14T09:00:00.000Z",
      "2026-07-20T09:00:00.000Z",
    ]);
    expect(counts.get("2026-07-13")).toBe(2);
    expect(counts.get("2026-07-20")).toBe(1);
    expect(counts.has("2026-07-06")).toBe(false);
  });

  it("returns an empty map for no timestamps", () => {
    expect(bucketCountsByWeek("UTC", []).size).toBe(0);
  });
});

describe("buildWeeklySeries", () => {
  const now = new Date("2026-07-27T12:00:00.000Z"); // a Monday

  it("zero-fills weeks with no activity between earliest data and now, honestly (never omitted, never faked non-zero)", () => {
    const series = buildWeeklySeries(
      "UTC",
      { visitIso: ["2026-07-06T09:00:00.000Z", "2026-07-06T10:00:00.000Z"], redemptionIso: [], joinIso: [], optOutIso: [] },
      now,
    );
    expect(series.map((p) => p.weekStart)).toEqual(["2026-07-06", "2026-07-13", "2026-07-20", "2026-07-27"]);
    expect(series[0]).toEqual({ weekStart: "2026-07-06", visits: 2, joins: 0, redemptions: 0, optOuts: 0 });
    expect(series[1]).toEqual({ weekStart: "2026-07-13", visits: 0, joins: 0, redemptions: 0, optOuts: 0 });
  });

  it("shapes all four series (visits/joins/redemptions/optOuts) into the same weekly buckets", () => {
    const series = buildWeeklySeries(
      "UTC",
      {
        visitIso: ["2026-07-20T09:00:00.000Z"],
        redemptionIso: ["2026-07-20T09:00:00.000Z"],
        joinIso: ["2026-07-13T09:00:00.000Z"],
        optOutIso: ["2026-07-27T09:00:00.000Z"],
      },
      now,
    );
    const week20 = series.find((p) => p.weekStart === "2026-07-20")!;
    expect(week20.visits).toBe(1);
    expect(week20.redemptions).toBe(1);
    const week13 = series.find((p) => p.weekStart === "2026-07-13")!;
    expect(week13.joins).toBe(1);
    const week27 = series.find((p) => p.weekStart === "2026-07-27")!;
    expect(week27.optOuts).toBe(1);
  });

  it("returns a single current-week zero row for a brand-new tenant with no history at all", () => {
    const series = buildWeeklySeries("UTC", { visitIso: [], redemptionIso: [], joinIso: [], optOutIso: [] }, now);
    expect(series).toEqual([{ weekStart: "2026-07-27", visits: 0, joins: 0, redemptions: 0, optOuts: 0 }]);
  });
});
