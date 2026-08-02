import "server-only";
import { TwilioProvider } from "./twilio";
import { TelnyxProvider } from "./telnyx";

/**
 * Provider abstraction (PRD: channel abstraction; provider decided at M8 —
 * candidates: Twilio, Telnyx). Everything provider-specific lives behind this
 * interface; the rest of the app only ever sees `SmsProvider`.
 */

export type SendResult =
  | { ok: true; providerSid: string | null }
  | { ok: false; error: string };

export type InboundSms = {
  from: string; // E.164
  to: string;   // E.164 — the restaurant's dedicated number
  body: string;
  providerSid: string | null;
};

export interface SmsProvider {
  readonly name: string;
  send(to: string, body: string, from: string | null): Promise<SendResult>;
  /**
   * Verify a webhook request genuinely came from the provider. `path` is the
   * webhook route the signature was computed over (Twilio signs the full
   * request URL); defaults to the inbound-message route since that was the
   * first caller. Pass "/api/sms/status" from the delivery-status route.
   */
  verifyWebhook(req: Request, rawBody: string, path?: string): Promise<boolean>;
  /** Parse the provider's inbound payload into our shape. */
  parseInbound(rawBody: string, contentType: string | null): InboundSms | null;
}

/**
 * Dev/default provider: no external calls, marks messages 'simulated'.
 * Webhooks "verify" only outside production so a misconfigured prod
 * deployment fails closed.
 */
export class SimulatedProvider implements SmsProvider {
  readonly name = "simulated";

  async send(): Promise<SendResult> {
    return { ok: true, providerSid: null };
  }

  async verifyWebhook(): Promise<boolean> {
    return process.env.NODE_ENV !== "production";
  }

  parseInbound(rawBody: string, contentType: string | null): InboundSms | null {
    // Accepts Twilio-style form encoding (From/To/Body) so local webhook
    // testing with curl mirrors a real provider's shape.
    if (contentType?.includes("application/x-www-form-urlencoded")) {
      const params = new URLSearchParams(rawBody);
      const from = params.get("From");
      const to = params.get("To");
      const body = params.get("Body");
      if (!from || !to || body === null) return null;
      return { from, to, body, providerSid: params.get("MessageSid") };
    }
    try {
      const json = JSON.parse(rawBody);
      if (!json.from || !json.to || typeof json.body !== "string") return null;
      return { from: json.from, to: json.to, body: json.body, providerSid: json.sid ?? null };
    } catch {
      return null;
    }
  }
}

/** Resolved once per process from SMS_PROVIDER; 'simulated' is the default. */
export function getProvider(): SmsProvider {
  const which = process.env.SMS_PROVIDER ?? "simulated";
  switch (which) {
    case "simulated":
      return new SimulatedProvider();
    case "twilio":
      return new TwilioProvider();
    case "telnyx":
      return new TelnyxProvider();
    default:
      throw new Error(`Unknown SMS_PROVIDER: ${which}`);
  }
}
