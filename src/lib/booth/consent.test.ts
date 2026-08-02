import { describe, expect, it } from "vitest";
import {
  CONSENT_VERSION,
  SMS_CONSENT_VERSION,
  TCPA_CONSENT_VERSION,
  US_SMS_CONSENT_VERSION,
  consentCopyFor,
  consentVersionFor,
  smsConsentVersionFor,
} from "./consent";

describe("consentVersionFor", () => {
  it("resolves the GB (PECR) version for GB", () => {
    expect(consentVersionFor("GB")).toBe(CONSENT_VERSION);
  });

  it("resolves the US (TCPA) version for US", () => {
    expect(consentVersionFor("US")).toBe(TCPA_CONSENT_VERSION);
  });

  it("falls back to the GB version for an unknown country", () => {
    expect(consentVersionFor("ZZ")).toBe(CONSENT_VERSION);
  });
});

describe("consentCopyFor", () => {
  it("returns PECR copy for GB", () => {
    expect(consentCopyFor("GB", "The Copper Pot")).toContain("The Copper Pot");
    expect(consentCopyFor("GB", "The Copper Pot")).toContain("Reply STOP to opt out, HELP for help");
  });

  it("returns the exact TCPA copy for US", () => {
    expect(consentCopyFor("US", "The Copper Pot")).toBe(
      "By joining, you agree to receive recurring loyalty and marketing texts from The Copper Pot via Booth. Consent is not a condition of purchase. Msg & data rates may apply. Reply STOP to opt out, HELP for help."
    );
  });
});

describe("smsConsentVersionFor", () => {
  it("resolves the GB SMS re-opt-in version for GB", () => {
    expect(smsConsentVersionFor("GB")).toBe(SMS_CONSENT_VERSION);
  });

  it("resolves the US SMS re-opt-in version for US", () => {
    expect(smsConsentVersionFor("US")).toBe(US_SMS_CONSENT_VERSION);
  });

  it("falls back to the GB SMS version for an unknown country", () => {
    expect(smsConsentVersionFor("ZZ")).toBe(SMS_CONSENT_VERSION);
  });
});
