import { describe, expect, it, beforeEach } from "vitest";
import { createHmac, generateKeyPairSync, sign as edSign } from "node:crypto";

describe("TwilioProvider", () => {
  beforeEach(() => {
    process.env.TWILIO_ACCOUNT_SID = "ACtest";
    process.env.TWILIO_AUTH_TOKEN = "testtoken";
    process.env.NEXT_PUBLIC_APP_URL = "https://booth.example";
  });

  it("verifies a correctly signed webhook and rejects a tampered one", async () => {
    const { TwilioProvider } = await import("./twilio");
    const p = new TwilioProvider();
    const rawBody = new URLSearchParams({ From: "+447700900001", To: "+447700900999", Body: "STOP", MessageSid: "SM1" }).toString();
    const url = "https://booth.example/api/sms/inbound";
    const params = new URLSearchParams(rawBody);
    const data = url + [...params.keys()].sort().map((k) => k + params.get(k)).join("");
    const sig = createHmac("sha1", "testtoken").update(data).digest("base64");

    const mkReq = (s: string) => new Request(url, { method: "POST", headers: { "x-twilio-signature": s } });
    expect(await p.verifyWebhook(mkReq(sig), rawBody)).toBe(true);
    expect(await p.verifyWebhook(mkReq(sig), rawBody + "&Body=HELP")).toBe(false);
    expect(await p.verifyWebhook(new Request(url, { method: "POST" }), rawBody)).toBe(false);
  });

  it("parses inbound form payloads", async () => {
    const { TwilioProvider } = await import("./twilio");
    const p = new TwilioProvider();
    const parsed = p.parseInbound("From=%2B447700900001&To=%2B447700900999&Body=STOP&MessageSid=SM1");
    expect(parsed).toEqual({ from: "+447700900001", to: "+447700900999", body: "STOP", providerSid: "SM1" });
    expect(p.parseInbound("Body=STOP")).toBeNull();
  });
});

describe("TelnyxProvider", () => {
  it("verifies an Ed25519-signed webhook (raw 32-byte pubkey) and rejects bad signatures", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    // raw 32-byte public key = last 32 bytes of SPKI DER
    const spki = publicKey.export({ format: "der", type: "spki" });
    process.env.TELNYX_PUBLIC_KEY = Buffer.from(spki.subarray(spki.length - 32)).toString("base64");
    process.env.TELNYX_API_KEY = "key";

    const { TelnyxProvider } = await import("./telnyx");
    const p = new TelnyxProvider();
    const rawBody = JSON.stringify({ data: { event_type: "message.received", payload: { from: { phone_number: "+447700900001" }, to: [{ phone_number: "+447700900999" }], text: "HELP", id: "tx1" } } });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const sig = edSign(null, Buffer.from(`${timestamp}|${rawBody}`), privateKey).toString("base64");

    const mkReq = (s: string, t: string) =>
      new Request("https://x/api/sms/inbound", { method: "POST", headers: { "telnyx-signature-ed25519": s, "telnyx-timestamp": t } });
    expect(await p.verifyWebhook(mkReq(sig, timestamp), rawBody)).toBe(true);
    expect(await p.verifyWebhook(mkReq(sig, timestamp), rawBody.replace("HELP", "STOP"))).toBe(false);
    expect(await p.verifyWebhook(mkReq(sig, "1000"), rawBody)).toBe(false); // stale timestamp

    const parsed = p.parseInbound(rawBody);
    expect(parsed).toEqual({ from: "+447700900001", to: "+447700900999", body: "HELP", providerSid: "tx1" });
  });
});
