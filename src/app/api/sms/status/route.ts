import "server-only";
import { getProvider } from "@/lib/sms/provider";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

/**
 * Provider-agnostic delivery-status callback (Phase A: buildable now against
 * the simulated provider; live-verified against Twilio/Telnyx in Phase B).
 * A provider POSTs here after a prior send to report the message's terminal
 * outcome. We map the provider's message id back to our `messages` row via
 * provider_sid and advance status forward only:
 *   sent -> delivered   (provider status "delivered")
 *   sent -> failed      (provider status "undelivered" or "failed")
 * A row already at delivered/failed is terminal — a later, out-of-order or
 * regressed callback (e.g. delivered -> sent) must never overwrite it, so
 * the update is conditioned on the row's CURRENT status being 'sent'.
 * Unknown provider_sid and unmapped statuses still return 200 (never 500 —
 * providers retry on failure, which would spam duplicate work).
 */
const STATUS_PATH = "/api/sms/status";

function mapDeliveryStatus(raw: string): "delivered" | "failed" | null {
  switch (raw.trim().toLowerCase()) {
    case "delivered":
      return "delivered";
    case "undelivered":
    case "failed":
      return "failed";
    default:
      return null;
  }
}

/**
 * Parse defensively. Twilio's status callback is form-encoded MessageSid +
 * MessageStatus (queued|sent|delivered|undelivered|failed) — same encoding
 * convention as its inbound webhook (see twilio.ts). JSON {sid, status} is
 * also accepted so the simulated provider can be exercised the same way the
 * simulated inbound path accepts JSON (see SimulatedProvider.parseInbound).
 */
function parseReceipt(rawBody: string, contentType: string | null): { sid: string; status: string } | null {
  if (contentType?.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(rawBody);
    const sid = params.get("MessageSid");
    const status = params.get("MessageStatus");
    if (!sid || !status) return null;
    return { sid, status };
  }
  try {
    const json = JSON.parse(rawBody) as { sid?: string; status?: string };
    if (!json.sid || !json.status) return null;
    return { sid: json.sid, status: json.status };
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const provider = getProvider();
  const raw = await req.text();

  // ACCEPTED RISK (review 2026-07-22, signed off): SimulatedProvider's
  // verifyWebhook is `NODE_ENV !== "production"` — so outside a production
  // build, this endpoint accepts unauthenticated writes (flip a message row
  // to delivered/failed by guessing a provider_sid). Contained because:
  // Vercel builds run NODE_ENV=production (where simulated fails closed),
  // and local dev is localhost-only. Revisit if a non-Vercel staging deploy
  // ever runs a dev build reachable from the internet.
  if (!(await provider.verifyWebhook(req, raw, STATUS_PATH))) {
    return new Response("Forbidden", { status: 403 });
  }

  const receipt = parseReceipt(raw, req.headers.get("content-type"));
  if (!receipt) {
    return new Response("Bad Request", { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data: message } = await admin
    .from("messages")
    .select("id")
    .eq("provider_sid", receipt.sid)
    .maybeSingle();

  if (!message) {
    await admin.from("audit_log").insert({
      restaurant_id: null,
      actor: "system",
      action: "sms.status_orphan",
      detail: { provider_sid: receipt.sid, status: receipt.status },
    });
    return new Response("OK", { status: 200 });
  }

  const mapped = mapDeliveryStatus(receipt.status);
  if (mapped === "delivered") {
    await admin
      .from("messages")
      .update({ status: "delivered", delivered_ts: new Date().toISOString() })
      .eq("id", message.id)
      .eq("status", "sent"); // forward-only: no-op if already delivered/failed
  } else if (mapped === "failed") {
    await admin
      .from("messages")
      .update({ status: "failed" })
      .eq("id", message.id)
      .eq("status", "sent"); // forward-only: no-op if already delivered/failed
  }
  // Unmapped statuses (queued/sent/sending, etc.) are acknowledged, no update.

  return new Response("OK", { status: 200 });
}
