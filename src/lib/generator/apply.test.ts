import { describe, it, expect } from "vitest";
import { toRealConfig } from "./apply";
import { birthdayConfigSchema, comeBackConfigSchema } from "@/lib/booth/programs";

describe("toRealConfig — draft-to-canonical shape conversion (WS5 item 5)", () => {
  it("passes birthday mode through and satisfies the real birthdayConfigSchema", () => {
    const real = toRealConfig("birthday", { name: "Birthday treat", config: { reward: "Free cake", mode: "window", window_days: 14 } }, 4);
    expect(real).toEqual({ reward: "Free cake", mode: "window", window_days: 14 });
    expect(() => birthdayConfigSchema.parse(real)).not.toThrow();
  });

  it("wraps the draft's single block into a canonical block with days_quiet from gone_quiet_weeks", () => {
    const real = toRealConfig("come_back", { name: "We miss you", config: { blocks: [{ id: "b1", reward: "Free starter", valid_days: 14 }] } }, 4);
    expect(real).toEqual({
      blocks: [{ id: "b1", days_quiet: 28, reward: "Free starter", valid_days: 14 }],
      min_days_between_contact: 10,
    });
    expect(() => comeBackConfigSchema.parse(real)).not.toThrow();
  });
});
