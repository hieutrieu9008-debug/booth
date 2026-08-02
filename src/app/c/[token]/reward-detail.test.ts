/**
 * Unit test for the WS-E item 4 "single-option grants open with QR
 * immediately visible" rule — no jsdom/RTL in this repo, so the reveal
 * decision is extracted as a pure function (initialRevealState) rather than
 * asserted through rendered DOM.
 */
import { describe, expect, it } from "vitest";
import { initialRevealState } from "./reward-detail";

describe("initialRevealState", () => {
  it("reveals immediately when there are no options at all (fixed reward)", () => {
    expect(initialRevealState(null, false)).toBe(true);
  });

  it("reveals immediately when there's only one option (nothing to choose)", () => {
    expect(initialRevealState([{ reward: "Free tea" }], false)).toBe(true);
  });

  it("does NOT reveal immediately when there are multiple options and no QA override", () => {
    expect(initialRevealState([{ reward: "Free naan" }, { reward: "Free dessert" }], false)).toBe(false);
  });

  it("honors the QA initialRevealed override even with multiple options", () => {
    expect(initialRevealState([{ reward: "Free naan" }, { reward: "Free dessert" }], true)).toBe(true);
  });
});
