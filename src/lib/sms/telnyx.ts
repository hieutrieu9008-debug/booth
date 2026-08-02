import "server-only";
import { createPublicKey, verify as edVerify } from "node:crypto";
import type { InboundSms, SendResult, SmsProvider } from "./provider";

/**
 * Telnyx adapter (raw REST). Env: TELNYX_API_KEY, TELNYX_PUBLIC_KEY (base64
 * Ed25519 key from Mission Control). Webhooks are signed
 * Ed25519(`${timestamp}|${rawBody}`) in telnyx-signature-ed25519 +
 * telnyx-timestamp headers.
 *
 * NOTE (docs/PROVIDER-DECISION.md): Telnyx UK long codes default to 0.1 msg/s
 * per number — fine for transactional, a real constraint for blasts unless a
 * rate raise is negotiated. Twilio is the working primary; this adapter keeps
 * the switch cheap.
 */
export class TelnyxProvider implements SmsProvider {
  readonly name = "telnyx";
  private apiKey = process.env.TELNYX_API_KEY ?? "";
  private publicKeyB64 = process.env.TELNYX_PUBLIC_KEY ?? "";

  async send(to: string, body: string, from: string | null): Promise<SendResult> {
    if (!this.apiKey) return { ok: false, error: "telnyx not configured" };
    if (!from) return { ok: false, error: "no dedicated number for this restaurant" };
    const res = await fetch("https://api.telnyx.com/v2/messages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to, from, text: body }),
    });
    const json = (await res.json()) as { data?: { id?: string }; errors?: Array<{ detail?: string }> };
    if (!res.ok) return { ok: false, error: json.errors?.[0]?.detail ?? `telnyx ${res.status}` };
    return { ok: true, providerSid: json.data?.id ?? null };
  }

  async verifyWebhook(req: Request, rawBody: string): Promise<boolean> {
    if (!this.publicKeyB64) return false; // fail closed
    const signature = req.headers.get("telnyx-signature-ed25519");
    const timestamp = req.headers.get("telnyx-timestamp");
    if (!signature || !timestamp) return false;
    // reject replays older than 5 minutes
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
    try {
      // Telnyx publishes a raw 32-byte Ed25519 key (base64); node needs SPKI DER.
      const raw = Buffer.from(this.publicKeyB64, "base64");
      const derPrefix = Buffer.from("302a300506032b6570032100", "hex");
      const key = createPublicKey({
        key: Buffer.concat([derPrefix, raw]),
        format: "der",
        type: "spki",
      });
      return edVerify(
        null,
        Buffer.from(`${timestamp}|${rawBody}`),
        key,
        Buffer.from(signature, "base64"),
      );
    } catch {
      return false;
    }
  }

  parseInbound(rawBody: string): InboundSms | null {
    try {
      const json = JSON.parse(rawBody) as {
        data?: { event_type?: string; payload?: { from?: { phone_number?: string }; to?: Array<{ phone_number?: string }>; text?: string; id?: string } };
      };
      const p = json.data?.payload;
      if (json.data?.event_type !== "message.received" || !p?.from?.phone_number || !p.to?.[0]?.phone_number) {
        return null;
      }
      return {
        from: p.from.phone_number,
        to: p.to[0].phone_number,
        body: p.text ?? "",
        providerSid: p.id ?? null,
      };
    } catch {
      return null;
    }
  }
}
