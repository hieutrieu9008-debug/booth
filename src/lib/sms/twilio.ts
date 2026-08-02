import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { InboundSms, SendResult, SmsProvider } from "./provider";

/**
 * Twilio adapter (raw REST, no SDK). Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN.
 * Webhook verification follows Twilio's scheme: base64(HMAC-SHA1(authToken,
 * url + concat(sortedParamKeys+values))) compared to X-Twilio-Signature.
 * The canonical webhook URL is derived from NEXT_PUBLIC_APP_URL so proxy/host
 * rewrites can't break verification.
 */
export class TwilioProvider implements SmsProvider {
  readonly name = "twilio";
  private sid = process.env.TWILIO_ACCOUNT_SID ?? "";
  private token = process.env.TWILIO_AUTH_TOKEN ?? "";

  private configured() {
    return !!this.sid && !!this.token;
  }

  async send(to: string, body: string, from: string | null): Promise<SendResult> {
    if (!this.configured()) return { ok: false, error: "twilio not configured" };
    if (!from) return { ok: false, error: "no dedicated number for this restaurant" };
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${this.sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.sid}:${this.token}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: to, From: from, Body: body }),
      },
    );
    const json = (await res.json()) as { sid?: string; message?: string };
    if (!res.ok) return { ok: false, error: json.message ?? `twilio ${res.status}` };
    return { ok: true, providerSid: json.sid ?? null };
  }

  async verifyWebhook(req: Request, rawBody: string, path = "/api/sms/inbound"): Promise<boolean> {
    if (!this.configured()) return false; // fail closed
    const signature = req.headers.get("x-twilio-signature");
    if (!signature) return false;
    const base = process.env.NEXT_PUBLIC_APP_URL;
    if (!base) return false;
    const url = `${base.replace(/\/$/, "")}${path}`;
    const params = new URLSearchParams(rawBody);
    const sorted = [...params.keys()].sort();
    const data = url + sorted.map((k) => k + params.get(k)).join("");
    const expected = createHmac("sha1", this.token).update(data).digest("base64");
    // Constant-time compare (review finding: this method now guards two
    // routes, inbound + status). Length check first: timingSafeEqual throws
    // on unequal lengths.
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parseInbound(rawBody: string): InboundSms | null {
    const params = new URLSearchParams(rawBody);
    const from = params.get("From");
    const to = params.get("To");
    const body = params.get("Body");
    if (!from || !to || body === null) return null;
    return { from, to, body, providerSid: params.get("MessageSid") };
  }
}
