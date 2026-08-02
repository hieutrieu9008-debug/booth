import { describe, it, expect, vi } from "vitest";

// applySetup must never reach Supabase for an invalid draft — safeParse
// fails first — so a broken/unmocked admin client here would still catch a
// regression that reaches past validation.
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseAdminClient: vi.fn(() => {
    throw new Error("should not be called for an invalid draft");
  }),
}));

import { applySetup } from "./actions";
import type { GeneratedSetup } from "@/lib/generator/schema";

const VALID_DRAFT: GeneratedSetup = {
  welcome: { name: "Welcome perk", config: { reward: "Free garlic bread", ring_up_note: null, valid_days: 14 } },
  ladder: {
    name: "Visit rewards",
    config: { endowed_start: 2, loop: true, rungs: [{ visits: 6, options: [{ reward: "Free naan", ring_up_note: null }] }] },
  },
  birthday: { name: "Birthday treat", config: { reward: "Free dessert", mode: "window", window_days: 14 } },
  come_back: { name: "We miss you", config: { blocks: [{ id: "b1", reward: "Free starter", valid_days: 14 }] } },
  campaigns: [
    { body: "[Name], come back this week. Reply STOP to opt out.", audience: "redeemed_before", suggested_send_note: "note" },
    { body: "Fancy popping in? Reply STOP to opt out.", audience: "gone_quiet", suggested_send_note: "note" },
    { body: "Thanks for joining! Reply STOP to opt out.", audience: "new", suggested_send_note: "note" },
    { body: "It's quiet tonight. Reply STOP to opt out.", audience: "all", suggested_send_note: "note" },
  ],
  join_page: null,
};

describe("applySetup — regression test for the generator's silent-failure bug", () => {
  it("returns a structured error (never throws) when the client-edited draft fails schema validation", async () => {
    // Simulates a client mutation that breaks the shape — e.g. clearing a
    // required field. Before the fix this reached generatedSetupSchema.parse
    // (throws), which rejected the server action with no visible feedback.
    const brokenDraft = {
      ...VALID_DRAFT,
      welcome: { ...VALID_DRAFT.welcome, config: { ...VALID_DRAFT.welcome.config, valid_days: "not a number" } },
    } as unknown as GeneratedSetup;

    const result = await applySetup("demo-kitchen", brokenDraft, false);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.conflict).toBe(false);
      if (!result.conflict) {
        expect(result.errors._draft).toBeDefined();
        expect(result.errors._draft).toContain("welcome");
      }
    }
  });

  it("does not throw for a structurally valid draft that later fails on the DB call", async () => {
    // getRestaurantId is the first DB touch after a successful safeParse —
    // confirms a valid draft clears validation and only fails downstream.
    await expect(applySetup("demo-kitchen", VALID_DRAFT, false)).rejects.toThrow("should not be called for an invalid draft");
  });
});
