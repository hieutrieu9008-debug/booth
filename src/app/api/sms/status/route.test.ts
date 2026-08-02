/**
 * Integration test against the LOCAL Supabase stack — same pattern as
 * src/app/api/sms/inbound/route.test.ts. Exercises the delivery-status
 * callback: happy-path delivered/failed, unknown provider_sid (orphan),
 * forward-only status advancement (downgrade attempts ignored), and Twilio
 * signature rejection.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??=
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3005";

// Own throwaway restaurant, NOT the shared demo tenant (AGENTS.md: never join
// members into demo-kitchen from new test files).
let testRestaurantId: string;
let testMemberId: string;
const messageIds: string[] = [];
const randPhone = () => `+4477009${String(Math.floor(Math.random() * 90000) + 10000)}`;
const randSid = () => `SM${Math.floor(Math.random() * 1e12)}`;

function statusRequest(sid: string, status: string) {
  return new Request("http://localhost/api/sms/status", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ MessageSid: sid, MessageStatus: status }).toString(),
  });
}

async function insertSentMessage(providerSid: string, status: "sent" | "delivered" | "failed" = "sent") {
  const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("messages")
    .insert({
      restaurant_id: testRestaurantId,
      member_id: testMemberId,
      direction: "outbound",
      kind: "transactional",
      body: "test message",
      status,
      provider_sid: providerSid,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`seed insert failed: ${error?.message}`);
  messageIds.push(data.id);
  return data.id;
}

describe("POST /api/sms/status", () => {
  beforeAll(async () => {
    process.env.SMS_PROVIDER = "simulated"; // signature check is a no-op outside production
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const { joinMember } = await import("@/lib/booth/members");
    const { CONSENT_VERSION } = await import("@/lib/booth/consent");
    const admin = createSupabaseAdminClient();
    const { data: restaurant, error } = await admin
      .from("restaurants")
      .insert({
        name: "Status Callback Test Kitchen",
        slug: `status-cb-test-${Math.floor(Math.random() * 1e9)}`,
        country: "GB",
      })
      .select("id")
      .single();
    if (error || !restaurant) throw new Error(`Local Supabase not reachable: ${error?.message}`);
    testRestaurantId = restaurant.id;

    const joined = await joinMember({
      restaurantId: testRestaurantId,
      phone: randPhone(),
      name: "Status Callback Member",
      consentVersion: CONSENT_VERSION,
      source: "self_scan",
    });
    testMemberId = joined.member.id;
  });

  afterEach(() => {
    process.env.SMS_PROVIDER = "simulated";
  });

  afterAll(async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    for (const id of messageIds) {
      await admin.from("messages").delete().eq("id", id);
    }
    if (testMemberId) {
      await admin.from("magic_tokens").delete().eq("member_id", testMemberId);
      await admin.from("members").delete().eq("id", testMemberId);
    }
    if (testRestaurantId) {
      await admin.from("audit_log").delete().eq("restaurant_id", testRestaurantId);
      await admin.from("restaurants").delete().eq("id", testRestaurantId);
    }
  });

  it("delivered receipt: advances sent -> delivered and stamps delivered_ts", async () => {
    const sid = randSid();
    const id = await insertSentMessage(sid);
    const { POST } = await import("./route");
    const res = await POST(statusRequest(sid, "delivered"));
    expect(res.status).toBe(200);

    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    const { data } = await admin.from("messages").select("status, delivered_ts").eq("id", id).single();
    expect(data?.status).toBe("delivered");
    expect(data?.delivered_ts).not.toBeNull();
  });

  it("undelivered/failed receipt: advances sent -> failed", async () => {
    const sid = randSid();
    const id = await insertSentMessage(sid);
    const { POST } = await import("./route");
    const res = await POST(statusRequest(sid, "undelivered"));
    expect(res.status).toBe(200);

    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    const { data } = await admin.from("messages").select("status").eq("id", id).single();
    expect(data?.status).toBe("failed");
  });

  it("unknown provider_sid: responds 200 and logs an sms.status_orphan audit row, no message touched", async () => {
    const sid = randSid(); // never inserted
    const { POST } = await import("./route");
    const res = await POST(statusRequest(sid, "delivered"));
    expect(res.status).toBe(200);

    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    const { data: logs } = await admin
      .from("audit_log")
      .select("action, actor, detail")
      .eq("action", "sms.status_orphan")
      .contains("detail", { provider_sid: sid });
    expect(logs).toHaveLength(1);
    expect(logs![0].actor).toBe("system");
  });

  it("downgrade attempt ignored: a row already delivered is not moved backward by a later 'sent'/'failed' callback", async () => {
    const sid = randSid();
    const id = await insertSentMessage(sid, "delivered"); // already terminal
    const { POST } = await import("./route");
    const res = await POST(statusRequest(sid, "failed"));
    expect(res.status).toBe(200);

    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    const { data } = await admin.from("messages").select("status").eq("id", id).single();
    expect(data?.status).toBe("delivered"); // unchanged, not downgraded to failed
  });

  it("correctly signed Twilio callback at the STATUS path is accepted and applies the update", async () => {
    process.env.SMS_PROVIDER = "twilio";
    process.env.TWILIO_ACCOUNT_SID = "ACtest";
    process.env.TWILIO_AUTH_TOKEN = "testtoken";
    process.env.NEXT_PUBLIC_APP_URL = "https://booth.example";

    const sid = randSid();
    const id = await insertSentMessage(sid);
    const rawBody = new URLSearchParams({ MessageSid: sid, MessageStatus: "delivered" }).toString();
    // Signature computed exactly per Twilio's scheme against the STATUS url —
    // covers the path parameterization of verifyWebhook (review finding #3:
    // the only prior positive-signature test used the inbound path).
    const url = "https://booth.example/api/sms/status";
    const params = new URLSearchParams(rawBody);
    const data = url + [...params.keys()].sort().map((k) => k + params.get(k)).join("");
    const sig = createHmac("sha1", "testtoken").update(data).digest("base64");

    const req = new Request(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": sig },
      body: rawBody,
    });
    const { POST } = await import("./route");
    const res = await POST(req);
    expect(res.status).toBe(200);
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    const { data: row } = await admin.from("messages").select("status, delivered_ts").eq("id", id).single();
    expect(row?.status).toBe("delivered");
    expect(row?.delivered_ts).not.toBeNull();
  });

  it("bad HMAC signature is rejected with 403 (Twilio provider active)", async () => {
    process.env.SMS_PROVIDER = "twilio";
    process.env.TWILIO_ACCOUNT_SID = "ACtest";
    process.env.TWILIO_AUTH_TOKEN = "testtoken";
    process.env.NEXT_PUBLIC_APP_URL = "https://booth.example";

    const sid = randSid();
    const rawBody = new URLSearchParams({ MessageSid: sid, MessageStatus: "delivered" }).toString();
    const url = "https://booth.example/api/sms/status";
    // Deliberately wrong signature (not computed from the HMAC scheme).
    const badSig = createHmac("sha1", "wrong-token").update(url + rawBody).digest("base64");

    const req = new Request(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": badSig },
      body: rawBody,
    });
    const { POST } = await import("./route");
    const res = await POST(req);
    expect(res.status).toBe(403);
  });
});
