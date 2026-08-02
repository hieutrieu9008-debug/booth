import { describe, expect, it } from "vitest";
import { consumedOnLapReset, dueLadderGrants, ladderTotals, lapComplete, progressDisplay } from "./ladder";
import { parseProgramConfig, type VisitLadderConfig } from "./programs";
import type { MemberProgress } from "./types";

const baseConfig: VisitLadderConfig = {
  endowed_start: 2,
  loop: true,
  rungs: [
    { visits: 6, options: [{ reward: "Free dessert", ring_up_note: "1x dessert, no charge" }] },
    { visits: 10, options: [{ reward: "Free main", ring_up_note: "1x main, no charge" }] },
  ],
};

const choiceConfig: VisitLadderConfig = {
  endowed_start: 0,
  loop: false,
  rungs: [
    {
      visits: 4,
      options: [
        { reward: "Free naan", ring_up_note: "1x naan, no charge" },
        { reward: "Free dessert", ring_up_note: "1x dessert, no charge" },
      ],
    },
  ],
};

function progress(overrides: Partial<MemberProgress> = {}): MemberProgress {
  return {
    member_id: "m1",
    program_id: "p1",
    restaurant_id: "r1",
    endowed_count: 2,
    earned_count: 0,
    cycle: 1,
    updated_at: "2026-07-15T00:00:00.000Z",
    choice_pref: null,
    ...overrides,
  };
}

describe("ladderTotals", () => {
  it("includes the endowed head start only on lap 1", () => {
    expect(ladderTotals(baseConfig, progress({ cycle: 1, endowed_count: 2, earned_count: 3 }))).toBe(5);
  });

  it("excludes endowed_count on any lap after the first", () => {
    expect(ladderTotals(baseConfig, progress({ cycle: 2, endowed_count: 2, earned_count: 3 }))).toBe(3);
  });
});

describe("dueLadderGrants", () => {
  it("excludes rungs whose slot already exists", () => {
    const p = progress({ cycle: 1, endowed_count: 2, earned_count: 4 }); // total 6 -> rung 0 due
    const due = dueLadderGrants(baseConfig, p, new Set(["ladder:0:1"]));
    expect(due).toEqual([]);
  });

  it("returns every newly-crossed rung when multiple are crossed in one call", () => {
    const p = progress({ cycle: 1, endowed_count: 2, earned_count: 8 }); // total 10 -> both rungs due
    const due = dueLadderGrants(baseConfig, p, new Set());
    expect(due).toHaveLength(2);
    expect(due[0]).toEqual({
      rungIndex: 0,
      cycle: 1,
      slot: "ladder:0:1",
      options: [{ reward: "Free dessert", ring_up_note: "1x dessert, no charge" }],
    });
    expect(due[1]).toEqual({
      rungIndex: 1,
      cycle: 1,
      slot: "ladder:1:1",
      options: [{ reward: "Free main", ring_up_note: "1x main, no charge" }],
    });
  });

  it("only returns rungs not yet crossed", () => {
    const p = progress({ cycle: 1, endowed_count: 2, earned_count: 2 }); // total 4 -> nothing due
    expect(dueLadderGrants(baseConfig, p, new Set())).toEqual([]);
  });

  it("carries every option through for a multi-option rung", () => {
    const p = progress({ cycle: 1, endowed_count: 0, earned_count: 4 }); // total 4 -> the choice rung is due
    const due = dueLadderGrants(choiceConfig, p, new Set());
    expect(due).toHaveLength(1);
    expect(due[0].options).toHaveLength(2);
    expect(due[0].options.map((o) => o.reward)).toEqual(["Free naan", "Free dessert"]);
  });
});

describe("lapComplete / consumedOnLapReset", () => {
  it("is complete once the last rung's visits are reached on a looping ladder", () => {
    const p = progress({ cycle: 1, endowed_count: 2, earned_count: 8 }); // total 10
    expect(lapComplete(baseConfig, p)).toBe(true);
  });

  it("is not complete when the ladder doesn't loop", () => {
    const noLoop = { ...baseConfig, loop: false };
    const p = progress({ cycle: 1, endowed_count: 2, earned_count: 8 });
    expect(lapComplete(noLoop, p)).toBe(false);
  });

  it("consumes last-rung visits minus the endowed head start on cycle 1", () => {
    expect(consumedOnLapReset(baseConfig, 1)).toBe(10 - 2);
  });

  it("consumes the full last-rung visits on cycles after the first (no endowment)", () => {
    expect(consumedOnLapReset(baseConfig, 2)).toBe(10);
  });
});

describe("progressDisplay", () => {
  it("shows exact numbers toward the next unearned rung", () => {
    const p = progress({ cycle: 1, endowed_count: 2, earned_count: 2 }); // total 4
    expect(progressDisplay(baseConfig, p)).toEqual({ current: 4, target: 6, label: "4 of 6", lapComplete: false, completed: false });
  });

  it("moves to the second rung after the first is crossed", () => {
    const p = progress({ cycle: 1, endowed_count: 2, earned_count: 4 }); // total 6
    expect(progressDisplay(baseConfig, p)).toEqual({ current: 6, target: 10, label: "6 of 10", lapComplete: false, completed: false });
  });

  it("shows correct exact numbers after a lap rollover (cycle 2, no endowment)", () => {
    // Lap 1 completed at total 10 with 2 endowed; consumedOnLapReset(config, 1) = 8
    // earned_count rolls from e.g. 8 -> 0, cycle -> 2.
    const p = progress({ cycle: 2, endowed_count: 2, earned_count: 0 });
    expect(progressDisplay(baseConfig, p)).toEqual({ current: 0, target: 6, label: "0 of 6", lapComplete: false, completed: false });
  });

  it("shows an honest lap-complete state (not '0 of X') once a looping ladder finishes its last rung", () => {
    const p = progress({ cycle: 1, endowed_count: 2, earned_count: 8 }); // total 10 -> last rung reached
    expect(progressDisplay(baseConfig, p)).toEqual({ current: 10, target: 10, label: "Lap complete", lapComplete: true, completed: false });
  });

  it("shows an honest ladder-complete state (never a dead stuck fraction) once a non-looping ladder finishes its last rung", () => {
    const noLoop = { ...baseConfig, loop: false };
    const p = progress({ cycle: 1, endowed_count: 2, earned_count: 8 }); // total 10
    expect(progressDisplay(noLoop, p)).toEqual({
      current: 10,
      target: 10,
      label: "Ladder complete — 2 rewards earned",
      lapComplete: false,
      completed: true,
    });
  });

  it("singularizes 'reward' for a one-rung non-looping ladder", () => {
    const oneRung: VisitLadderConfig = { endowed_start: 0, loop: false, rungs: [{ visits: 4, options: [{ reward: "Free tea" }] }] };
    const p = progress({ cycle: 1, endowed_count: 0, earned_count: 4 });
    expect(progressDisplay(oneRung, p).label).toBe("Ladder complete — 1 reward earned");
  });
});

describe("parseProgramConfig", () => {
  it("accepts a valid visit_ladder config", () => {
    const result = parseProgramConfig("visit_ladder", baseConfig);
    expect(result).toEqual({ type: "visit_ladder", config: baseConfig });
  });

  it("rejects non-strictly-increasing rungs", () => {
    const bad = {
      endowed_start: 0,
      loop: true,
      rungs: [
        { visits: 6, options: [{ reward: "A" }] },
        { visits: 6, options: [{ reward: "B" }] },
      ],
    };
    expect(() => parseProgramConfig("visit_ladder", bad)).toThrow();
  });

  it("rejects a decreasing rung sequence", () => {
    const bad = {
      endowed_start: 0,
      loop: true,
      rungs: [
        { visits: 10, options: [{ reward: "A" }] },
        { visits: 6, options: [{ reward: "B" }] },
      ],
    };
    expect(() => parseProgramConfig("visit_ladder", bad)).toThrow();
  });

  it("rejects endowed_start >= the first rung's visits", () => {
    const bad = {
      endowed_start: 6,
      loop: true,
      rungs: [
        { visits: 6, options: [{ reward: "A" }] },
        { visits: 10, options: [{ reward: "B" }] },
      ],
    };
    expect(() => parseProgramConfig("visit_ladder", bad)).toThrow();
  });

  it("accepts endowed_start of exactly one less than the first rung", () => {
    const ok = {
      endowed_start: 5,
      loop: true,
      rungs: [
        { visits: 6, options: [{ reward: "A" }] },
        { visits: 10, options: [{ reward: "B" }] },
      ],
    };
    expect(() => parseProgramConfig("visit_ladder", ok)).not.toThrow();
  });

  it("rejects a rung with an empty options array", () => {
    const bad = { endowed_start: 0, loop: false, rungs: [{ visits: 6, options: [] }] };
    expect(() => parseProgramConfig("visit_ladder", bad)).toThrow();
  });

  it("accepts a multi-option rung", () => {
    const ok = {
      endowed_start: 0,
      loop: false,
      rungs: [{ visits: 4, options: [{ reward: "A" }, { reward: "B" }] }],
    };
    expect(() => parseProgramConfig("visit_ladder", ok)).not.toThrow();
  });
});

describe("come_back / birthday config parsing", () => {
  it("accepts a multi-block come_back config with strictly increasing days_quiet and unique ids", () => {
    const ok = {
      blocks: [
        { id: "b1", days_quiet: 7, reward: "A", valid_days: 14 },
        { id: "b2", days_quiet: 14, reward: "B", valid_days: 14 },
        { id: "b3", days_quiet: 60, reward: "C", valid_days: 21 },
      ],
    };
    const result = parseProgramConfig("come_back", ok);
    expect(result.type).toBe("come_back");
    if (result.type === "come_back") expect(result.config.min_days_between_contact).toBe(10); // default
  });

  it("rejects non-strictly-increasing days_quiet", () => {
    const bad = {
      blocks: [
        { id: "b1", days_quiet: 14, reward: "A", valid_days: 14 },
        { id: "b2", days_quiet: 14, reward: "B", valid_days: 14 },
      ],
    };
    expect(() => parseProgramConfig("come_back", bad)).toThrow();
  });

  it("rejects duplicate block ids", () => {
    const bad = {
      blocks: [
        { id: "b1", days_quiet: 7, reward: "A", valid_days: 14 },
        { id: "b1", days_quiet: 14, reward: "B", valid_days: 14 },
      ],
    };
    expect(() => parseProgramConfig("come_back", bad)).toThrow();
  });

  it("birthday defaults to window mode and requires window_days in that mode", () => {
    const result = parseProgramConfig("birthday", { reward: "A", window_days: 14 });
    expect(result.type).toBe("birthday");
    if (result.type === "birthday") expect(result.config.mode).toBe("window");
    expect(() => parseProgramConfig("birthday", { reward: "A" })).toThrow();
  });

  it("birthday month mode does not require window_days", () => {
    expect(() => parseProgramConfig("birthday", { reward: "A", mode: "month" })).not.toThrow();
  });
});
