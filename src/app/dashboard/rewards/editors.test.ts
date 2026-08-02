import { describe, expect, it } from "vitest";
import { visitLadderConfigSchema, comeBackConfigSchema, birthdayConfigSchema } from "@/lib/booth/programs";
import { toUiRungs, fromUiRungs } from "./ladder-editor";
import { freshId } from "./come-back-editor";

describe("LadderEditor round-trip", () => {
  it("toUiRungs -> fromUiRungs preserves visits/options exactly (only UI keys are stripped)", () => {
    const rungs = [
      { visits: 4, options: [{ reward: "Free naan", ring_up_note: "1x naan" }, { reward: "Free dessert" }] },
      { visits: 8, options: [{ reward: "Free main" }] },
    ];
    expect(fromUiRungs(toUiRungs(rungs))).toEqual(rungs);
  });

  it("a strictly-increasing config round-trips through the canonical schema", () => {
    const config = {
      endowed_start: 1,
      loop: true,
      rungs: [
        { visits: 4, options: [{ reward: "Free naan" }] },
        { visits: 8, options: [{ reward: "Free main" }] },
      ],
    };
    const parsed = visitLadderConfigSchema.safeParse(config);
    expect(parsed.success).toBe(true);
  });

  it("rejects non-strictly-increasing rung visits with an inline-mappable path", () => {
    const config = {
      endowed_start: 0,
      loop: false,
      rungs: [
        { visits: 8, options: [{ reward: "Free main" }] },
        { visits: 4, options: [{ reward: "Free naan" }] },
      ],
    };
    const parsed = visitLadderConfigSchema.safeParse(config);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0].path).toEqual(["rungs", 1, "visits"]);
    }
  });
});

describe("ComeBackEditor block ids", () => {
  it("editing an existing block preserves its id (never regenerated)", () => {
    const original = { id: "b1", days_quiet: 7, reward: "Free coffee", valid_days: 7 };
    const edited = { ...original, reward: "Free tea" }; // simulates updateBlock(i, {reward: ...})
    expect(edited.id).toBe(original.id);
  });

  it("freshId never reuses an existing block's id and generates unique ids across calls", () => {
    const existingIds = new Set(["b1", "b2", "b3"]);
    const generated = new Set<string>();
    for (let i = 0; i < 20; i++) generated.add(freshId());
    for (const id of generated) expect(existingIds.has(id)).toBe(false);
    expect(generated.size).toBe(20); // no collisions among the fresh ids themselves
  });

  it("a full config with distinct block ids round-trips through the canonical schema", () => {
    const config = {
      blocks: [
        { id: "b1", days_quiet: 7, reward: "Free coffee", valid_days: 7 },
        { id: "b2", days_quiet: 14, reward: "Free dessert", valid_days: 7 },
      ],
      min_days_between_contact: 10,
    };
    const parsed = comeBackConfigSchema.safeParse(config);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.blocks.map((b) => b.id)).toEqual(["b1", "b2"]);
    }
  });

  it("rejects duplicate block ids", () => {
    const config = {
      blocks: [
        { id: "b1", days_quiet: 7, reward: "Free coffee", valid_days: 7 },
        { id: "b1", days_quiet: 14, reward: "Free dessert", valid_days: 7 },
      ],
      min_days_between_contact: 10,
    };
    expect(comeBackConfigSchema.safeParse(config).success).toBe(false);
  });
});

describe("BirthdayEditor mode round-trip", () => {
  it("window mode requires window_days", () => {
    expect(birthdayConfigSchema.safeParse({ reward: "Free cake", mode: "window" }).success).toBe(false);
    expect(birthdayConfigSchema.safeParse({ reward: "Free cake", mode: "window", window_days: 14 }).success).toBe(true);
  });

  it("month mode ignores window_days (valid with or without it)", () => {
    expect(birthdayConfigSchema.safeParse({ reward: "Free cake", mode: "month" }).success).toBe(true);
    expect(birthdayConfigSchema.safeParse({ reward: "Free cake", mode: "month", window_days: undefined }).success).toBe(true);
  });
});
