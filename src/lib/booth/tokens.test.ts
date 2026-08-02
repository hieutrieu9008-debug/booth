import { describe, expect, it } from "vitest";
import { hashStaffPin, newMagicToken, newQrToken, newRewardToken, sha256Hex } from "./tokens";

describe("token minting", () => {
  it("newQrToken has the mqr_ prefix and 24 url-safe chars", () => {
    const token = newQrToken();
    expect(token.startsWith("mqr_")).toBe(true);
    expect(token.slice(4)).toHaveLength(24);
    expect(token.slice(4)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("newRewardToken has the rwd_ prefix and 24 url-safe chars", () => {
    const token = newRewardToken();
    expect(token.startsWith("rwd_")).toBe(true);
    expect(token.slice(4)).toHaveLength(24);
    expect(token.slice(4)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("newMagicToken has the mlt_ prefix and 32 url-safe chars", () => {
    const token = newMagicToken();
    expect(token.startsWith("mlt_")).toBe(true);
    expect(token.slice(4)).toHaveLength(32);
    expect(token.slice(4)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("generates unique values across many calls", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => newQrToken()));
    expect(tokens.size).toBe(200);
  });
});

describe("sha256Hex", () => {
  it("is stable for the same input", () => {
    expect(sha256Hex("hello")).toBe(sha256Hex("hello"));
  });

  it("matches the known SHA-256 hash of 'hello'", () => {
    expect(sha256Hex("hello")).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });

  it("differs for different inputs", () => {
    expect(sha256Hex("hello")).not.toBe(sha256Hex("world"));
  });
});

describe("hashStaffPin", () => {
  it("is stable for the same pin given the same secret", () => {
    process.env.STAFF_AUTH_SECRET = "test-secret";
    expect(hashStaffPin("1234")).toBe(hashStaffPin("1234"));
  });

  it("differs for different pins", () => {
    process.env.STAFF_AUTH_SECRET = "test-secret";
    expect(hashStaffPin("1234")).not.toBe(hashStaffPin("5678"));
  });
});
