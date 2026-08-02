import "server-only";

/**
 * UK number provisioning seam (M8). White-glove flow at onboarding:
 *   search → purchase → submit KYC (RC bundle) → poll approval →
 *   configure webhook → write restaurants.sms_from.
 *
 * EXTERNAL BLOCKER (docs/PROVIDER-DECISION.md): the provider account must be
 * created under the business entity before any of this runs for real. Twilio
 * is the working primary; every provider-specific call lives here.
 *
 * Numbers take hours–days to clear KYC; joins captured before activation get
 * their welcome text at go-live (dispatch already queues on send failure via
 * the messages log — a manual resend from /internal covers the gap for MVP).
 */

export type UkNumberCandidate = { phoneNumber: string; monthlyCostUsd: string | null };
export type ProvisioningStatus =
  | { stage: "none" }
  | { stage: "purchased"; phoneNumber: string }
  | { stage: "kyc_pending"; phoneNumber: string; bundleSid: string }
  | { stage: "active"; phoneNumber: string };

export interface NumberProvisioner {
  searchUkMobile(limit?: number): Promise<UkNumberCandidate[]>;
  /** Buys the number and points its inbound webhook at our endpoint. */
  purchase(phoneNumber: string): Promise<{ providerNumberSid: string }>;
}

export class TwilioProvisioner implements NumberProvisioner {
  private sid = process.env.TWILIO_ACCOUNT_SID ?? "";
  private token = process.env.TWILIO_AUTH_TOKEN ?? "";

  private auth() {
    return `Basic ${Buffer.from(`${this.sid}:${this.token}`).toString("base64")}`;
  }

  private assertConfigured() {
    if (!this.sid || !this.token) {
      throw new Error(
        "Twilio not configured — the business-entity provider account is an external blocker (docs/PROVIDER-DECISION.md).",
      );
    }
  }

  async searchUkMobile(limit = 10): Promise<UkNumberCandidate[]> {
    this.assertConfigured();
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${this.sid}/AvailablePhoneNumbers/GB/Mobile.json?SmsEnabled=true&PageSize=${limit}`,
      { headers: { Authorization: this.auth() } },
    );
    if (!res.ok) throw new Error(`twilio number search failed: ${res.status}`);
    const json = (await res.json()) as { available_phone_numbers: Array<{ phone_number: string }> };
    return json.available_phone_numbers.map((n) => ({ phoneNumber: n.phone_number, monthlyCostUsd: null }));
  }

  async purchase(phoneNumber: string): Promise<{ providerNumberSid: string }> {
    this.assertConfigured();
    const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
    if (!base) throw new Error("NEXT_PUBLIC_APP_URL required to set the inbound webhook");
    // NOTE: UK numbers require an approved RC bundle (BundleSid) since May
    // 2024 — purchase will 4xx without one. Bundle creation is API-driven
    // (Twilio Regulatory Compliance API) but needs real company details, so
    // for MVP the bundle is created once in the Twilio console per the
    // white-glove runbook and its SID supplied via TWILIO_UK_BUNDLE_SID.
    const bundleSid = process.env.TWILIO_UK_BUNDLE_SID;
    const params = new URLSearchParams({
      PhoneNumber: phoneNumber,
      SmsUrl: `${base}/api/sms/inbound`,
      SmsMethod: "POST",
    });
    if (bundleSid) params.set("BundleSid", bundleSid);
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${this.sid}/IncomingPhoneNumbers.json`,
      {
        method: "POST",
        headers: { Authorization: this.auth(), "Content-Type": "application/x-www-form-urlencoded" },
        body: params,
      },
    );
    const json = (await res.json()) as { sid?: string; message?: string };
    if (!res.ok || !json.sid) throw new Error(json.message ?? `twilio purchase failed: ${res.status}`);
    return { providerNumberSid: json.sid };
  }
}

export function getProvisioner(): NumberProvisioner {
  // Provider choice follows SMS_PROVIDER; only Twilio provisioning is
  // implemented (see PROVIDER-DECISION.md — Telnyx stays a send-adapter
  // candidate until its UK mobile inventory/pricing is verified on a live
  // account).
  return new TwilioProvisioner();
}
