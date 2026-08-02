import { describe, expect, it } from "vitest";
import { formatUkMobile } from "./phone-format";

describe("formatUkMobile", () => {
  it("groups an 11-digit UK mobile as 5 + 6", () => {
    expect(formatUkMobile("07700900000")).toBe("07700 900000");
  });

  it("strips non-digit characters before grouping", () => {
    expect(formatUkMobile("077 00-900 000")).toBe("07700 900000");
  });

  it("caps at 11 digits, ignoring extra input", () => {
    expect(formatUkMobile("077009000001234")).toBe("07700 900000");
  });

  it("formats a partial number without a trailing space", () => {
    expect(formatUkMobile("077")).toBe("077");
    expect(formatUkMobile("07700")).toBe("07700");
    expect(formatUkMobile("077009")).toBe("07700 9");
  });

  it("handles empty input", () => {
    expect(formatUkMobile("")).toBe("");
  });
});
