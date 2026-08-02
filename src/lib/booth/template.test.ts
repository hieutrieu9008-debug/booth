import { describe, expect, it } from "vitest";
import { renderTemplate, validateTemplate, withStopSuffix } from "./template";

describe("renderTemplate", () => {
  it("substitutes all four vars", () => {
    expect(renderTemplate("Hi {name}, {reward} at {restaurant} → {link}", {
      name: "Alex",
      reward: "a free coffee",
      restaurant: "Demo Kitchen",
      link: "https://bth.link/abc",
    })).toBe("Hi Alex, a free coffee at Demo Kitchen → https://bth.link/abc");
  });

  it("renders missing vars as empty string rather than leaving the placeholder", () => {
    expect(renderTemplate("Hi {name}!", {})).toBe("Hi !");
  });

  it("leaves unrelated braces untouched", () => {
    expect(renderTemplate("50% off {reward} (limited)", { reward: "dessert" })).toBe("50% off dessert (limited)");
  });
});

describe("withStopSuffix", () => {
  it("appends the STOP line when absent", () => {
    expect(withStopSuffix("Hello")).toBe("Hello Reply STOP to opt out.");
  });

  it("never doubles the STOP line", () => {
    const once = withStopSuffix("Hello Reply STOP to opt out.");
    expect(withStopSuffix(once)).toBe(once);
  });
});

describe("validateTemplate", () => {
  it("flags a required {link} that's missing", () => {
    expect(validateTemplate("Happy birthday, {reward} is waiting!", { requireLink: true })).toBe("missing_link");
  });

  it("passes when {link} is present", () => {
    expect(validateTemplate("Happy birthday, {reward} is waiting → {link}", { requireLink: true })).toBeNull();
  });

  it("skips the check when link isn't required", () => {
    expect(validateTemplate("No link needed here", { requireLink: false })).toBeNull();
  });
});
