import { describe, expect, it } from "vitest";
import { signsBaseUrl } from "./page";

/** Codex #21: missing/blank NEXT_PUBLIC_APP_URL must never produce a QR pointing at a relative URL — the page renders an owner-safe error card instead. This covers the pure guard the page branches on. */
describe("signsBaseUrl", () => {
  it("returns null when unset", () => {
    expect(signsBaseUrl(undefined)).toBeNull();
  });

  it("returns null when blank/whitespace", () => {
    expect(signsBaseUrl("")).toBeNull();
    expect(signsBaseUrl("   ")).toBeNull();
  });

  it("returns the trimmed, trailing-slash-stripped URL when set", () => {
    expect(signsBaseUrl("https://booth.example.com/")).toBe("https://booth.example.com");
    expect(signsBaseUrl("https://booth.example.com")).toBe("https://booth.example.com");
  });
});
