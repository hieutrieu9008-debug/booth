/**
 * Integration test against the LOCAL Supabase stack. Own throwaway
 * restaurant/program/members — never the shared demo tenant (see
 * src/app/api/sms/inbound/route.test.ts's comment for why: engine.test.ts
 * counts fan-out recipients over the demo restaurant's members elsewhere in
 * this suite).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??=
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3107";
process.env.SMS_PROVIDER ??= "simulated";
process.env.CRON_SECRET ??= "test-cron-secret";

// Codex #11 test support: force createMemberCardLink to throw for exactly
// one member, so the cron's per-grant try/catch (release-the-claim path) is
// exercised without touching every other test's real link creation.
let failLinkForMemberId: string | null = null;
vi.mock("@/lib/booth/links", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/booth/links")>();
  return {
    ...actual,
    createMemberCardLink: async (memberId: string) => {
      if (memberId === failLinkForMemberId) throw new Error("simulated link failure (test)");
      return actual.createMemberCardLink(memberId);
    },
  };
});

const randPhone = () => `+4477009${String(Math.floor(Math.random() * 90000) + 10000)}`;
const daysFromNow = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

function cronRequest(): Request {
  return new Request("http://localhost/api/cron/remind-expiring", {
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
}

let restaurantId: string;
let programId: string;
let memberId: string;
let farMemberId: string; // grant expires outside the reminder window — should never fire
let alreadyRemindedMemberId: string; // capped by the 7-day-per-member rule

describe("GET /api/cron/remind-expiring", () => {
  beforeAll(async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const { joinMember } = await import("@/lib/booth/members");
    const { CONSENT_VERSION } = await import("@/lib/booth/consent");
    const admin = createSupabaseAdminClient();

    const { data: restaurant, error: restaurantError } = await admin
      .from("restaurants")
      .insert({
        name: "Remind Expiring Test Kitchen",
        slug: `remind-expiring-test-${Math.floor(Math.random() * 1e9)}`,
        country: "GB",
        settings: { version: 1, extend_notify_default: true, expiry_reminder_days: 3 },
      })
      .select("id")
      .single();
    if (restaurantError || !restaurant) throw new Error(`Local Supabase not reachable: ${restaurantError?.message}`);
    restaurantId = restaurant.id;

    const { data: program, error: programError } = await admin
      .from("reward_programs")
      .insert({ restaurant_id: restaurantId, type: "anytime", name: "Test anytime", active: true, config: { reward: "Free tea", per_member_limit: 5 } })
      .select("id")
      .single();
    if (programError || !program) throw programError;
    programId = program.id;

    const join = async (name: string) => {
      const joined = await joinMember({ restaurantId, phone: randPhone(), name, consentVersion: CONSENT_VERSION, source: "self_scan" });
      return joined.member.id;
    };
    memberId = await join("Reminder Member");
    farMemberId = await join("Far Expiry Member");
    alreadyRemindedMemberId = await join("Already Reminded Member");

    async function insertGrant(memberIdForGrant: string, expiresAt: string, slot: string) {
      const { error } = await admin.from("reward_grants").insert({
        restaurant_id: restaurantId,
        member_id: memberIdForGrant,
        program_id: programId,
        reward_text: "Free tea",
        one_use_token: `rwd_test_remind_${slot}_${Date.now()}`,
        grant_slot: slot,
        state: "earned",
        expires_at: expiresAt,
      });
      if (error) throw error;
    }

    // Due: expires in 2 days (< the 3-day window), no reminder sent yet.
    await insertGrant(memberId, daysFromNow(2), "due");
    // Not due: expires in 10 days (outside the window).
    await insertGrant(farMemberId, daysFromNow(10), "far");
    // Capped: this member has ANOTHER grant already reminded 1 day ago —
    // this new due grant should be skipped by the 7-day-per-member cap.
    await insertGrant(alreadyRemindedMemberId, daysFromNow(2), "capped-due");
    const { error: priorReminderError } = await admin.from("reward_grants").insert({
      restaurant_id: restaurantId,
      member_id: alreadyRemindedMemberId,
      program_id: programId,
      reward_text: "Free tea (already reminded)",
      one_use_token: `rwd_test_remind_prior_${Date.now()}`,
      grant_slot: "prior-reminded",
      state: "earned",
      expires_at: daysFromNow(1),
      reminder_sent_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    });
    if (priorReminderError) throw priorReminderError;
  });

  afterAll(async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    for (const id of [memberId, farMemberId, alreadyRemindedMemberId]) {
      if (id) await admin.from("members").delete().eq("id", id);
    }
    if (restaurantId) await admin.from("restaurants").delete().eq("id", restaurantId);
  });

  it("401s without a valid cron secret", async () => {
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/cron/remind-expiring"));
    expect(res.status).toBe(401);
  });

  it("reminds the due grant, skips the far-expiry and capped grants, and claims reminder_sent_at", async () => {
    const { GET } = await import("./route");
    const res = await GET(cronRequest());
    const body = await res.json();
    expect(body.sent).toBeGreaterThanOrEqual(1);
    expect(body.skippedCapped).toBeGreaterThanOrEqual(1);

    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();

    const { data: dueGrant } = await admin.from("reward_grants").select("reminder_sent_at").eq("grant_slot", "due").single();
    expect(dueGrant?.reminder_sent_at).not.toBeNull();

    const { data: farGrant } = await admin.from("reward_grants").select("reminder_sent_at").eq("grant_slot", "far").single();
    expect(farGrant?.reminder_sent_at).toBeNull();

    const { data: cappedGrant } = await admin.from("reward_grants").select("reminder_sent_at").eq("grant_slot", "capped-due").single();
    expect(cappedGrant?.reminder_sent_at).toBeNull(); // capped: never claimed, so a later run can still catch it once the cap window passes

    const { data: messages } = await admin
      .from("messages")
      .select("body")
      .eq("restaurant_id", restaurantId)
      .eq("member_id", memberId)
      .eq("kind", "marketing");
    expect(messages?.[0]?.body).toContain("expires");
    expect(messages?.[0]?.body).toContain("Reply STOP to opt out.");
  });

  it("is idempotent on a second run — the claimed grant is never reminded twice", async () => {
    const { GET } = await import("./route");
    const res = await GET(cronRequest());
    const body = await res.json();
    expect(body.sent).toBe(0); // the only previously-due grant is already claimed

    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    const { data: messages } = await admin
      .from("messages")
      .select("id")
      .eq("restaurant_id", restaurantId)
      .eq("member_id", memberId)
      .eq("kind", "marketing");
    expect(messages).toHaveLength(1);
  });
});

describe("GET /api/cron/remind-expiring — claim is released on a transient failure (Codex #11)", () => {
  let restaurantId: string;
  let memberId: string;

  afterEach(() => {
    failLinkForMemberId = null;
  });

  beforeAll(async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const { joinMember } = await import("@/lib/booth/members");
    const { CONSENT_VERSION } = await import("@/lib/booth/consent");
    const admin = createSupabaseAdminClient();

    const { data: restaurant, error: restaurantError } = await admin
      .from("restaurants")
      .insert({
        name: "Remind Expiring Release Test Kitchen",
        slug: `remind-expiring-release-test-${Math.floor(Math.random() * 1e9)}`,
        country: "GB",
        settings: { version: 1, extend_notify_default: true, expiry_reminder_days: 3 },
      })
      .select("id")
      .single();
    if (restaurantError || !restaurant) throw new Error(`Local Supabase not reachable: ${restaurantError?.message}`);
    restaurantId = restaurant.id;

    const { data: program, error: programError } = await admin
      .from("reward_programs")
      .insert({ restaurant_id: restaurantId, type: "anytime", name: "Test anytime", active: true, config: { reward: "Free tea", per_member_limit: 5 } })
      .select("id")
      .single();
    if (programError || !program) throw programError;

    const joined = await joinMember({ restaurantId, phone: randPhone(), name: "Release Test Member", consentVersion: CONSENT_VERSION, source: "self_scan" });
    memberId = joined.member.id;

    const { error: grantError } = await admin.from("reward_grants").insert({
      restaurant_id: restaurantId,
      member_id: memberId,
      program_id: program.id,
      reward_text: "Free tea",
      one_use_token: `rwd_test_release_${Date.now()}`,
      grant_slot: "release-due",
      state: "earned",
      expires_at: daysFromNow(2),
    });
    if (grantError) throw grantError;
  });

  afterAll(async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    if (memberId) await admin.from("members").delete().eq("id", memberId);
    if (restaurantId) await admin.from("restaurants").delete().eq("id", restaurantId);
  });

  it("releases the claim (reminder_sent_at back to null) when link creation throws, so the grant is still due next run", async () => {
    failLinkForMemberId = memberId;
    const { GET } = await import("./route");
    await GET(cronRequest());

    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    const { data: grant } = await admin
      .from("reward_grants")
      .select("reminder_sent_at")
      .eq("restaurant_id", restaurantId)
      .eq("member_id", memberId)
      .eq("grant_slot", "release-due")
      .single();
    // Released, not permanently consumed — a thrown link/send error must not
    // burn the member's one reminder for this grant.
    expect(grant?.reminder_sent_at).toBeNull();

    const { data: messages } = await admin.from("messages").select("id").eq("restaurant_id", restaurantId).eq("member_id", memberId);
    expect(messages ?? []).toHaveLength(0); // no message was ever sent
  });

  it("a later run (once the failure clears) successfully claims and sends the same grant", async () => {
    failLinkForMemberId = null;
    const { GET } = await import("./route");
    const res = await GET(cronRequest());
    const body = await res.json();
    expect(body.sent).toBeGreaterThanOrEqual(1);

    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    const { data: grant } = await admin
      .from("reward_grants")
      .select("reminder_sent_at")
      .eq("restaurant_id", restaurantId)
      .eq("member_id", memberId)
      .eq("grant_slot", "release-due")
      .single();
    expect(grant?.reminder_sent_at).not.toBeNull();
  });
});
