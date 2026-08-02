import { describe, expect, it } from "vitest";
import { parseMessageTemplates, parseRestaurantSettings, validateMessageTemplates } from "./settings";

describe("parseRestaurantSettings", () => {
  it("applies coded defaults for an empty row", () => {
    expect(parseRestaurantSettings({})).toEqual({ version: 1, extend_notify_default: true, expiry_reminder_days: 3 });
  });

  it("applies coded defaults for a null column", () => {
    expect(parseRestaurantSettings(null)).toEqual({ version: 1, extend_notify_default: true, expiry_reminder_days: 3 });
  });

  it("preserves explicit owner-set values", () => {
    expect(parseRestaurantSettings({ version: 1, extend_notify_default: false, expiry_reminder_days: 5 })).toEqual({
      version: 1,
      extend_notify_default: false,
      expiry_reminder_days: 5,
    });
  });

  it("falls back to defaults rather than throwing on a malformed row", () => {
    expect(parseRestaurantSettings({ expiry_reminder_days: -1 })).toEqual({
      version: 1,
      extend_notify_default: true,
      expiry_reminder_days: 3,
    });
  });
});

describe("parseMessageTemplates", () => {
  it("defaults to no custom templates set", () => {
    expect(parseMessageTemplates({})).toEqual({ version: 1 });
  });

  it("preserves set templates", () => {
    expect(parseMessageTemplates({ version: 1, welcome: "Hi {name} → {link}" })).toEqual({
      version: 1,
      welcome: "Hi {name} → {link}",
    });
  });
});

describe("validateMessageTemplates", () => {
  it("requires {link} on every standalone template key", () => {
    const errors = validateMessageTemplates({ welcome: "Welcome!", reward_earned: "Earned! {link}" });
    expect(errors.welcome).toBeDefined();
    expect(errors.reward_earned).toBeUndefined();
  });

  it("skips unset keys", () => {
    expect(validateMessageTemplates({})).toEqual({});
  });
});
