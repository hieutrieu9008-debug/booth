/**
 * Integration test against the LOCAL Supabase stack — same pattern as
 * src/lib/booth/integration.test.ts. Exercises the CARD/LINK keyword
 * handling (SPEC-WSA A4 item 1, Codex #31) through the real route handler.
 *
 * The demo restaurant's sms_from is unset in the seed, so every scenario
 * here goes through the "unambiguous single-member" fallback path (the same
 * one the HELP catch-all already relies on) rather than mutating the shared
 * demo restaurant row.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??=
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3005";
process.env.SMS_PROVIDER ??= "simulated";

// Own throwaway restaurant, NOT the shared demo tenant: engine.test.ts runs
// in parallel in the same suite and counts fan-out recipients over the demo
// restaurant's members — joining members there mid-suite races its counts.
let testRestaurantId: string;
const randPhone = () => `+4477009${String(Math.floor(Math.random() * 90000) + 10000)}`;
const UNMATCHED_TO = "+15550001234"; // no restaurant's sms_from equals this

function inboundRequest(from: string, body: string) {
  return new Request("http://localhost/api/sms/inbound", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ from, to: UNMATCHED_TO, body }),
  });
}

let memberPhone: string;
let memberId: string;
let optedOutPhone: string;
let optedOutMemberId: string;

describe("POST /api/sms/inbound — CARD/LINK keyword", () => {
  beforeAll(async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const { joinMember } = await import("@/lib/booth/members");
    const { CONSENT_VERSION } = await import("@/lib/booth/consent");
    const admin = createSupabaseAdminClient();
    const { data: restaurant, error } = await admin
      .from("restaurants")
      .insert({
        name: "Card Keyword Test Kitchen",
        slug: `card-kw-test-${Math.floor(Math.random() * 1e9)}`,
        country: "GB",
      })
      .select("id")
      .single();
    if (error || !restaurant) throw new Error(`Local Supabase not reachable: ${error?.message}`);
    testRestaurantId = restaurant.id;

    memberPhone = randPhone();
    const joined = await joinMember({
      restaurantId: testRestaurantId,
      phone: memberPhone,
      name: "Card Keyword Member",
      consentVersion: CONSENT_VERSION,
      source: "self_scan",
    });
    memberId = joined.member.id;

    optedOutPhone = randPhone();
    const joinedOptedOut = await joinMember({
      restaurantId: testRestaurantId,
      phone: optedOutPhone,
      name: "Opted Out Member",
      consentVersion: CONSENT_VERSION,
      source: "self_scan",
    });
    optedOutMemberId = joinedOptedOut.member.id;
    await admin
      .from("members")
      .update({ opted_out: true, opted_out_ts: new Date().toISOString() })
      .eq("id", optedOutMemberId);
  });

  afterAll(async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    for (const id of [memberId, optedOutMemberId]) {
      if (!id) continue;
      await admin.from("magic_tokens").delete().eq("member_id", id);
      await admin.from("messages").delete().eq("member_id", id);
      await admin.from("members").delete().eq("id", id);
    }
    if (testRestaurantId) {
      await admin.from("audit_log").delete().eq("restaurant_id", testRestaurantId);
      await admin.from("reward_grants").delete().eq("restaurant_id", testRestaurantId);
      await admin.from("restaurants").delete().eq("id", testRestaurantId);
    }
  });

  it("known, opted-in member: sends a fresh transactional card link", async () => {
    const { POST } = await import("./route");
    const res = await POST(inboundRequest(memberPhone, "CARD"));
    expect(res.status).toBe(200);

    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    const { data: outbound } = await admin
      .from("messages")
      .select("kind, body, status")
      .eq("member_id", memberId)
      .eq("direction", "outbound")
      .order("created_at", { ascending: false })
      .limit(1);
    expect(outbound).toHaveLength(1);
    expect(outbound![0].kind).toBe("transactional");
    expect(outbound![0].body).toContain("/c/");
    expect(["sent", "simulated"]).toContain(outbound![0].status);

    const { data: tokenRows } = await admin.from("magic_tokens").select("token_hash").eq("member_id", memberId);
    expect((tokenRows ?? []).length).toBeGreaterThan(0);
  });

  it("also responds to the bare LINK keyword", async () => {
    const { POST } = await import("./route");
    const res = await POST(inboundRequest(memberPhone, "link"));
    expect(res.status).toBe(200);
  });

  it("opted-out member: replies telling them to START first, no card link sent", async () => {
    const { POST } = await import("./route");
    const res = await POST(inboundRequest(optedOutPhone, "CARD"));
    expect(res.status).toBe(200);

    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    const { data: outbound } = await admin
      .from("messages")
      .select("kind, body")
      .eq("member_id", optedOutMemberId)
      .eq("direction", "outbound")
      .order("created_at", { ascending: false })
      .limit(1);
    expect(outbound).toHaveLength(1);
    expect(outbound![0].body).toContain("START");
    expect(outbound![0].body).not.toContain("/c/");
  });

  it("unknown number: no restaurant/member resolvable, handled without error (nothing to attribute a log or reply to)", async () => {
    const { POST } = await import("./route");
    const unknownPhone = randPhone();
    const res = await POST(inboundRequest(unknownPhone, "CARD"));
    expect(res.status).toBe(200);
  });
});

/**
 * SPEC item: harden inbound keyword handling — punctuation-tolerant
 * first-word matching, the expanded opt-out synonym list, and the explicit
 * HELP reply. Uses its own restaurant with sms_from SET (unlike the
 * CARD/LINK suite above) because the START/UNSTOP re-opt-in path only
 * resolves a restaurant via the direct sms_from match — there is no
 * shared-number fallback for it (existing behavior, unchanged here).
 */
describe("POST /api/sms/inbound — keyword normalization (opt-out/opt-in/HELP)", () => {
  let kwRestaurantId: string;
  let kwSmsFrom: string;
  const kwMemberIds: string[] = [];

  function kwInboundRequest(from: string, body: string) {
    return new Request("http://localhost/api/sms/inbound", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from, to: kwSmsFrom, body }),
    });
  }

  async function freshMember(optedOut = false) {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const { joinMember } = await import("@/lib/booth/members");
    const { CONSENT_VERSION } = await import("@/lib/booth/consent");
    const admin = createSupabaseAdminClient();
    const phone = randPhone();
    const joined = await joinMember({
      restaurantId: kwRestaurantId,
      phone,
      name: "Keyword Test Member",
      consentVersion: CONSENT_VERSION,
      source: "self_scan",
    });
    kwMemberIds.push(joined.member.id);
    if (optedOut) {
      await admin
        .from("members")
        .update({ opted_out: true, opted_out_ts: new Date().toISOString() })
        .eq("id", joined.member.id);
    }
    return { phone, memberId: joined.member.id };
  }

  beforeAll(async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    kwSmsFrom = `+1555${String(Math.floor(Math.random() * 9000000) + 1000000)}`;
    const { data: restaurant, error } = await admin
      .from("restaurants")
      .insert({
        name: "Keyword Normalization Test Kitchen",
        slug: `kw-norm-test-${Math.floor(Math.random() * 1e9)}`,
        country: "GB",
        sms_from: kwSmsFrom,
      })
      .select("id")
      .single();
    if (error || !restaurant) throw new Error(`Local Supabase not reachable: ${error?.message}`);
    kwRestaurantId = restaurant.id;
  });

  afterAll(async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    for (const id of kwMemberIds) {
      await admin.from("magic_tokens").delete().eq("member_id", id);
      await admin.from("messages").delete().eq("member_id", id);
      await admin.from("members").delete().eq("id", id);
    }
    if (kwRestaurantId) {
      await admin.from("audit_log").delete().eq("restaurant_id", kwRestaurantId);
      await admin.from("reward_grants").delete().eq("restaurant_id", kwRestaurantId);
      await admin.from("restaurants").delete().eq("id", kwRestaurantId);
    }
  });

  it.each(["Stop!", "STOP.", " stop ", "CANCEL", "End.", "quit"])(
    "opts out on punctuation/case-variant keyword %j",
    async (body) => {
      const { phone, memberId } = await freshMember();
      const { POST } = await import("./route");
      const res = await POST(kwInboundRequest(phone, body));
      expect(res.status).toBe(200);

      const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
      const admin = createSupabaseAdminClient();
      const { data: memberRow } = await admin.from("members").select("opted_out").eq("id", memberId).single();
      expect(memberRow?.opted_out).toBe(true);
    },
  );

  it("re-opts in on punctuation-tolerant START", async () => {
    const { phone, memberId } = await freshMember(true);
    const { POST } = await import("./route");
    const res = await POST(kwInboundRequest(phone, "Start!"));
    expect(res.status).toBe(200);

    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    const { data: memberRow } = await admin.from("members").select("opted_out").eq("id", memberId).single();
    expect(memberRow?.opted_out).toBe(false);
  });

  it("HELP (punctuation-tolerant) replies with restaurant name, the CARD pointer, and STOP", async () => {
    const { phone, memberId } = await freshMember();
    const { POST } = await import("./route");
    const res = await POST(kwInboundRequest(phone, "HELP?"));
    expect(res.status).toBe(200);

    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    const { data: outbound } = await admin
      .from("messages")
      .select("body")
      .eq("member_id", memberId)
      .eq("direction", "outbound")
      .order("created_at", { ascending: false })
      .limit(1);
    expect(outbound).toHaveLength(1);
    const body = outbound![0].body as string;
    expect(body).toContain("Keyword Normalization Test Kitchen");
    expect(body).toContain("CARD");
    expect(body).toContain("STOP");
  });

  it('"please stop" does NOT opt out — carrier-standard first-word match sees PLEASE, not STOP', async () => {
    const { phone, memberId } = await freshMember();
    const { POST } = await import("./route");
    const res = await POST(kwInboundRequest(phone, "please stop"));
    expect(res.status).toBe(200);

    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    const { data: memberRow } = await admin.from("members").select("opted_out").eq("id", memberId).single();
    expect(memberRow?.opted_out).toBe(false);

    const { data: outbound } = await admin
      .from("messages")
      .select("body")
      .eq("member_id", memberId)
      .eq("direction", "outbound")
      .order("created_at", { ascending: false })
      .limit(1);
    expect(outbound).toHaveLength(1);
    expect(outbound![0].body).not.toContain("opted out");
  });
});
