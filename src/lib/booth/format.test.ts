import { describe, expect, it } from "vitest";
import { daysInMonth, formatCurrency, formatPhoneNational, isValidBirthday, normalizePhone } from "./format";

describe("normalizePhone", () => {
  it("+44: strips a leading trunk 0 before prefixing", () => {
    expect(normalizePhone("07700 900000", "+44")).toBe("+447700900000");
  });

  it("+44: accepts a number with no leading 0", () => {
    expect(normalizePhone("7700900000", "+44")).toBe("+447700900000");
  });

  it("+44: passes through an already-E.164 value", () => {
    expect(normalizePhone("+447700900000", "+44")).toBe("+447700900000");
  });

  // Review finding #2: "+44 07700..." (trunk zero kept after the country
  // code) used to normalize to a DIFFERENT string than the canonical form,
  // letting format variants bypass the opted-out and suppressed-phone guards,
  // which compare exact strings. All three trunk-zero countries covered.
  it("+ branch: strips a trunk zero after a trunk-zero country code so variants collapse to one canonical form", () => {
    expect(normalizePhone("+44 07700 900000", "+44")).toBe("+447700900000");
    expect(normalizePhone("+4407700900000", "+1")).toBe("+447700900000"); // restaurant prefix irrelevant to the + branch
    expect(normalizePhone("+353 087 1234567", "+353")).toBe("+353871234567");
    expect(normalizePhone("+61 0412 345 678", "+61")).toBe("+61412345678");
  });

  it("+ branch: does not strip after +1 (NANP has no trunk zero)", () => {
    expect(normalizePhone("+13345550182", "+1")).toBe("+13345550182");
  });

  it("+1: accepts a bare 10-digit NANP number", () => {
    expect(normalizePhone("(334) 555-0182", "+1")).toBe("+13345550182");
  });

  it("+1: accepts an 11-digit number with a leading 1, and does NOT trunk-strip it", () => {
    expect(normalizePhone("13345550182", "+1")).toBe("+13345550182");
  });

  it("+1: rejects an area code starting 0 or 1", () => {
    expect(normalizePhone("0345550182", "+1")).toBeNull();
    expect(normalizePhone("1345550182", "+1")).toBeNull();
  });

  it("+1: rejects a number that isn't 10 (or 11-with-leading-1) digits", () => {
    expect(normalizePhone("33455501", "+1")).toBeNull();
  });

  it("rejects obviously-too-short input", () => {
    expect(normalizePhone("123", "+44")).toBeNull();
  });
});

describe("formatPhoneNational", () => {
  it("formats a UK E.164 number with UK grouping", () => {
    expect(formatPhoneNational("+447700900000", "+44")).toBe("07700 900000");
  });

  it("formats a US E.164 number as (XXX) XXX-XXXX", () => {
    expect(formatPhoneNational("+13345550182", "+1")).toBe("(334) 555-0182");
  });

  it("falls back to grouped digits for an unhandled prefix", () => {
    expect(formatPhoneNational("+353871234567", "+353")).toBe("+353 871 234 567");
  });

  it("returns the raw value if it doesn't start with the given prefix", () => {
    expect(formatPhoneNational("+13345550182", "+44")).toBe("+13345550182");
  });
});

describe("formatCurrency", () => {
  it("formats GBP via en-GB", () => {
    expect(formatCurrency(12, "GBP", "GB")).toBe("£12");
  });

  it("formats USD via en-US", () => {
    expect(formatCurrency(12, "USD", "US")).toBe("$12");
  });

  it("falls back to the Intl default locale for another currency code", () => {
    expect(formatCurrency(12, "EUR")).toContain("12");
  });
});

describe("daysInMonth / isValidBirthday", () => {
  it("allows Feb 29 (no year is stored)", () => {
    expect(daysInMonth(2)).toBe(29);
    expect(isValidBirthday(2, 29)).toBe(true);
  });

  it("rejects Feb 30", () => {
    expect(isValidBirthday(2, 30)).toBe(false);
  });

  it("rejects Apr 31 (30-day month)", () => {
    expect(daysInMonth(4)).toBe(30);
    expect(isValidBirthday(4, 31)).toBe(false);
  });

  it("allows Jan 31 (31-day month)", () => {
    expect(isValidBirthday(1, 31)).toBe(true);
  });

  it("rejects an out-of-range month", () => {
    expect(isValidBirthday(13, 1)).toBe(false);
    expect(isValidBirthday(0, 1)).toBe(false);
  });
});
