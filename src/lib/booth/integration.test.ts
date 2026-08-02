/**
 * Integration test against the LOCAL Supabase stack (npx supabase start).
 * Exercises the real join → visit → materialize → redeem wiring including
 * the DB RPCs — the part unit tests can't see. Requires the seeded demo
 * tenant (supabase db reset).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??=
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3005";
process.env.STAFF_AUTH_SECRET ??= "dev-staff-secret";
process.env.SMS_PROVIDER ??= "simulated";

const DEMO_RESTAURANT = "00000000-0000-4000-8000-000000000001";
const TEST_PHONE = `+4477009${String(Math.floor(Math.random() * 90000) + 10000)}`;

let memberId: string;

describe("join → visit → redeem against local stack", () => {
  beforeAll(async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    // ensure stack reachable; fail fast with a clear message otherwise
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("restaurants").select("id").eq("id", DEMO_RESTAURANT).single();
    if (error) throw new Error(`Local Supabase not reachable/seeded: ${error.message}`);
  });

  afterAll(async () => {
    if (!memberId) return;
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    await createSupabaseAdminClient().from("members").delete().eq("id", memberId);
  });

  it("joinMember creates member, endowed progress, welcome grant", async () => {
    const { joinMember } = await import("./members");
    const { CONSENT_VERSION } = await import("./consent");
    const joined = await joinMember({
      restaurantId: DEMO_RESTAURANT,
      phone: TEST_PHONE,
      name: "Integration Test",
      consentVersion: CONSENT_VERSION,
      source: "self_scan",
    });
    memberId = joined.member.id;
    expect(joined.alreadyMember).toBe(false);
    expect(joined.member.qr_token.startsWith("mqr_")).toBe(true);
    expect(joined.welcomeGrant?.rewardText).toContain("garlic naan");

    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const { data: progress } = await createSupabaseAdminClient()
      .from("member_progress")
      .select("endowed_count, earned_count, cycle")
      .eq("member_id", memberId);
    expect(progress).toHaveLength(1);
    expect(progress![0]).toMatchObject({ endowed_count: 2, earned_count: 0, cycle: 1 });
  });

  it("magic card link stores only a hash and resolves", async () => {
    const { createMemberCardLink } = await import("./links");
    const { sha256Hex } = await import("./tokens");
    const url = await createMemberCardLink(memberId);
    const raw = url.split("/c/")[1];
    expect(raw.startsWith("mlt_")).toBe(true);

    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const { data: row } = await createSupabaseAdminClient()
      .from("magic_tokens")
      .select("member_id, expires_at")
      .eq("token_hash", sha256Hex(raw))
      .single();
    expect(row?.member_id).toBe(memberId);
    expect(new Date(row!.expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it("fn_record_visit adds a visit once per day and bumps progress", async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    const first = await admin.rpc("fn_record_visit", { p_member_id: memberId, p_source: "lookup" });
    expect(first.data.status).toBe("visit_added");
    const second = await admin.rpc("fn_record_visit", { p_member_id: memberId, p_source: "lookup" });
    expect(second.data.status).toBe("already_today");

    const { data: progress } = await admin
      .from("member_progress")
      .select("earned_count")
      .eq("member_id", memberId)
      .single();
    expect(progress?.earned_count).toBe(1);
  });

  it("welcome grant redeems exactly once via fn_redeem_grant", async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    const { data: grant } = await admin
      .from("reward_grants")
      .select("one_use_token")
      .eq("member_id", memberId)
      .eq("grant_slot", "welcome")
      .single();

    const valid = await admin.rpc("fn_redeem_grant", { p_token: grant!.one_use_token, p_source: "lookup" });
    expect(valid.data.status).toBe("valid");
    expect(valid.data.member_name).toBe("Integration Test");

    const again = await admin.rpc("fn_redeem_grant", { p_token: grant!.one_use_token, p_source: "lookup" });
    expect(again.data.status).toBe("already_used");
  });

  it("repeat join (not opted out) refreshes name/birthday/consent and flags repeatJoin, without double-enrolling or double-granting (Codex #48)", async () => {
    const { joinMember } = await import("./members");
    const { CONSENT_VERSION, TCPA_CONSENT_VERSION } = await import("./consent");

    const first = await joinMember({
      restaurantId: DEMO_RESTAURANT,
      phone: TEST_PHONE, // same phone as the earlier join in this describe block
      name: "Integration Test",
      consentVersion: CONSENT_VERSION,
      source: "self_scan",
    });
    expect(first.repeatJoin).toBe(true); // already joined earlier in this describe block, not opted out
    expect(first.alreadyMember).toBe(true);
    expect(first.welcomeGrant).toBeNull(); // welcome grant already exists from the first join (unique on slot)

    const second = await joinMember({
      restaurantId: DEMO_RESTAURANT,
      phone: TEST_PHONE,
      name: "Updated Name",
      birthdayMonth: 6,
      birthdayDay: 15,
      consentVersion: TCPA_CONSENT_VERSION,
      source: "self_scan",
    });
    expect(second.repeatJoin).toBe(true);
    expect(second.member.name).toBe("Updated Name");
    expect(second.member.birthday_month).toBe(6);
    expect(second.member.birthday_day).toBe(15);
    expect(second.member.consent_version).toBe(TCPA_CONSENT_VERSION);

    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const { data: progressRows } = await createSupabaseAdminClient()
      .from("member_progress")
      .select("program_id")
      .eq("member_id", memberId);
    expect(progressRows).toHaveLength(1); // no double-enrollment
  });

  it("dispatch suppresses marketing to an opted-out member", async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    await admin.from("members").update({ opted_out: true, opted_out_ts: new Date().toISOString() }).eq("id", memberId);

    const { sendMarketing } = await import("@/lib/sms/dispatch");
    const result = await sendMarketing({ restaurantId: DEMO_RESTAURANT, memberId, body: "test blast" });
    expect(result.status).toBe("suppressed_optout");

    const { data: logged } = await admin
      .from("messages")
      .select("status, kind")
      .eq("member_id", memberId)
      .order("created_at", { ascending: false })
      .limit(1);
    expect(logged![0]).toMatchObject({ status: "suppressed", kind: "marketing" });
  });
});

const LADDER_PROGRAM = "00000000-0000-4000-8000-000000000102"; // demo seed: rung0 (6 visits) is 2-option, rung1 (10) is single

describe("Plan V2: choice-aware grants, atomic redeem-auto-visit, undo cascades", () => {
  let v2MemberId: string;

  afterAll(async () => {
    if (!v2MemberId) return;
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    await createSupabaseAdminClient().from("members").delete().eq("id", v2MemberId);
  });

  it("rung options normalize into grant text: single option is fixed, multi-option is choice-aware", async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const { joinMember } = await import("./members");
    const { CONSENT_VERSION } = await import("./consent");
    const { materializeGrants } = await import("./rewards");
    const admin = createSupabaseAdminClient();

    const joined = await joinMember({
      restaurantId: DEMO_RESTAURANT,
      phone: randPhoneLocal(),
      name: "Choice Ladder Member",
      consentVersion: CONSENT_VERSION,
      source: "self_scan",
    });
    v2MemberId = joined.member.id;

    // total = endowed(2) + earned -> jump straight to 10 so both rungs materialize in one call.
    await admin
      .from("member_progress")
      .update({ earned_count: 8 })
      .eq("member_id", v2MemberId)
      .eq("program_id", LADDER_PROGRAM);

    const { newGrants } = await materializeGrants(v2MemberId);
    const rung0 = newGrants.find((g) => g.slot === "ladder:0:1");
    const rung1 = newGrants.find((g) => g.slot === "ladder:1:1");
    expect(rung0).toMatchObject({ hasChoice: true, rewardText: "Free naan or Free dessert", ringUpNote: null });
    expect(rung1).toMatchObject({ hasChoice: false, ringUpNote: "1x main, no charge" });

    const { data: rung0Row } = await admin
      .from("reward_grants")
      .select("reward_options")
      .eq("member_id", v2MemberId)
      .eq("grant_slot", "ladder:0:1")
      .single();
    expect(rung0Row?.reward_options).toHaveLength(2);
  });

  it("an unchosen choice grant cannot be redeemed (choice_required), but redeems fine once chosen", async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const { joinMember } = await import("./members");
    const { CONSENT_VERSION } = await import("./consent");
    const { chooseGrantOption } = await import("./choice");
    const { newRewardToken } = await import("./tokens");
    const admin = createSupabaseAdminClient();

    const joined = await joinMember({
      restaurantId: DEMO_RESTAURANT,
      phone: randPhoneLocal(),
      name: "Choice Backstop Member",
      consentVersion: CONSENT_VERSION,
      source: "self_scan",
    });
    const memberId6 = joined.member.id;

    try {
      const token = newRewardToken();
      const { data: grant } = await admin
        .from("reward_grants")
        .insert({
          restaurant_id: DEMO_RESTAURANT, member_id: memberId6, program_id: LADDER_PROGRAM,
          reward_text: "Free naan or Free dessert",
          reward_options: [{ reward: "Free naan" }, { reward: "Free dessert" }],
          one_use_token: token, grant_slot: `choice-backstop-test:${Date.now()}`, state: "earned",
        })
        .select("id")
        .single();

      const blocked = await admin.rpc("fn_redeem_grant", { p_token: token, p_source: "lookup" });
      expect(blocked.data.status).toBe("choice_required");
      expect(blocked.data.reward_text).toBe("Free naan or Free dessert");

      const { data: grantAfterBlock } = await admin
        .from("reward_grants")
        .select("state")
        .eq("id", grant!.id)
        .single();
      expect(grantAfterBlock?.state).toBe("earned"); // untouched, not redeemed

      const chosen = await chooseGrantOption({ grantId: grant!.id, memberId: memberId6, optionIndex: 1 });
      expect(chosen).toEqual({ ok: true, rewardText: "Free dessert", ringUpNote: null });

      const redeemed = await admin.rpc("fn_redeem_grant", { p_token: token, p_source: "lookup" });
      expect(redeemed.data.status).toBe("valid");
      expect(redeemed.data.reward_text).toBe("Free dessert");
    } finally {
      await admin.from("reward_grants").delete().eq("member_id", memberId6);
      await admin.from("events").delete().eq("member_id", memberId6);
      await admin.from("members").delete().eq("id", memberId6);
    }
  });

  it("redeem auto-adds a visit; a same-day second redeem is idempotent (no second visit)", async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const { joinMember } = await import("./members");
    const { CONSENT_VERSION } = await import("./consent");
    const { redeemReward } = await import("./scan");
    const { newRewardToken } = await import("./tokens");
    const admin = createSupabaseAdminClient();

    const joined = await joinMember({
      restaurantId: DEMO_RESTAURANT,
      phone: randPhoneLocal(),
      name: "Auto Visit Member",
      consentVersion: CONSENT_VERSION,
      source: "self_scan",
    });
    const memberId2 = joined.member.id;

    try {
      const tokenA = newRewardToken();
      const tokenB = newRewardToken();
      await admin.from("reward_grants").insert([
        {
          restaurant_id: DEMO_RESTAURANT, member_id: memberId2, program_id: LADDER_PROGRAM,
          reward_text: "Grant A", one_use_token: tokenA, grant_slot: `auto-visit-test-a:${Date.now()}`, state: "earned",
        },
        {
          restaurant_id: DEMO_RESTAURANT, member_id: memberId2, program_id: LADDER_PROGRAM,
          reward_text: "Grant B", one_use_token: tokenB, grant_slot: `auto-visit-test-b:${Date.now()}`, state: "earned",
        },
      ]);

      const first = await redeemReward(tokenA, "lookup");
      expect(first.status).toBe("valid");
      if (first.status !== "valid") throw new Error("unreachable");
      expect(first.visit_added).toBe(true);
      expect(first.visit_event_id).not.toBeNull();

      const { data: progressAfterFirst } = await admin
        .from("member_progress")
        .select("earned_count")
        .eq("member_id", memberId2)
        .eq("program_id", LADDER_PROGRAM)
        .single();
      expect(progressAfterFirst?.earned_count).toBe(1);

      const second = await redeemReward(tokenB, "lookup");
      expect(second.status).toBe("valid");
      if (second.status !== "valid") throw new Error("unreachable");
      expect(second.visit_added).toBe(false);
      expect(second.visit_event_id).toBeNull();

      const { data: progressAfterSecond } = await admin
        .from("member_progress")
        .select("earned_count")
        .eq("member_id", memberId2)
        .eq("program_id", LADDER_PROGRAM)
        .single();
      expect(progressAfterSecond?.earned_count).toBe(1); // unchanged — no second visit
    } finally {
      await admin.from("reward_grants").delete().eq("member_id", memberId2);
      await admin.from("events").delete().eq("member_id", memberId2);
      await admin.from("members").delete().eq("id", memberId2);
    }
  });

  it("redeem-undo cascades to the auto-visit, decrements progress, and preserves a stamped choice", async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const { joinMember } = await import("./members");
    const { CONSENT_VERSION } = await import("./consent");
    const { redeemReward, undoEvent } = await import("./scan");
    const { chooseGrantOption } = await import("./choice");
    const { newRewardToken } = await import("./tokens");
    const admin = createSupabaseAdminClient();

    const joined = await joinMember({
      restaurantId: DEMO_RESTAURANT,
      phone: randPhoneLocal(),
      name: "Undo Cascade Member",
      consentVersion: CONSENT_VERSION,
      source: "self_scan",
    });
    const memberId3 = joined.member.id;

    try {
      const token = newRewardToken();
      const { data: grant } = await admin
        .from("reward_grants")
        .insert({
          restaurant_id: DEMO_RESTAURANT, member_id: memberId3, program_id: LADDER_PROGRAM,
          reward_text: "Free naan or Free dessert",
          reward_options: [{ reward: "Free naan" }, { reward: "Free dessert" }],
          one_use_token: token, grant_slot: `undo-cascade-test:${Date.now()}`, state: "earned",
        })
        .select("id")
        .single();

      const chosen = await chooseGrantOption({ grantId: grant!.id, memberId: memberId3, optionIndex: 1 });
      expect(chosen).toEqual({ ok: true, rewardText: "Free dessert", ringUpNote: null });

      const redeemed = await redeemReward(token, "lookup");
      expect(redeemed.status).toBe("valid");
      if (redeemed.status !== "valid") throw new Error("unreachable");
      expect(redeemed.visit_added).toBe(true);
      const visitEventId = redeemed.visit_event_id!;
      const redemptionEventId = redeemed.event_id;

      const undoResult = await undoEvent(redemptionEventId);
      expect(undoResult).toMatchObject({ status: "undone", type: "redemption", visit_undone: "yes" });

      const { data: grantAfter } = await admin
        .from("reward_grants")
        .select("state, reward_text, chosen_at, redeemed_at")
        .eq("id", grant!.id)
        .single();
      expect(grantAfter?.state).toBe("earned");
      expect(grantAfter?.redeemed_at).toBeNull();
      // Choice preserved across undo [Cx2-8] — never resets to an unchosen state.
      expect(grantAfter?.reward_text).toBe("Free dessert");
      expect(grantAfter?.chosen_at).not.toBeNull();

      const { data: visitEvent } = await admin.from("events").select("voided").eq("id", visitEventId).single();
      expect(visitEvent?.voided).toBe(true);

      const { data: progressAfterUndo } = await admin
        .from("member_progress")
        .select("earned_count")
        .eq("member_id", memberId3)
        .eq("program_id", LADDER_PROGRAM)
        .single();
      expect(progressAfterUndo?.earned_count).toBe(0);
    } finally {
      await admin.from("reward_grants").delete().eq("member_id", memberId3);
      await admin.from("events").delete().eq("member_id", memberId3);
      await admin.from("members").delete().eq("id", memberId3);
    }
  });

  it("undoing a visit voids the rung grant it caused (earned_event_id fix)", async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const { joinMember } = await import("./members");
    const { CONSENT_VERSION } = await import("./consent");
    const { recordVisit, undoEvent } = await import("./scan");
    const admin = createSupabaseAdminClient();

    const joined = await joinMember({
      restaurantId: DEMO_RESTAURANT,
      phone: randPhoneLocal(),
      name: "Earned Event Undo Member",
      consentVersion: CONSENT_VERSION,
      source: "self_scan",
    });
    const memberId4 = joined.member.id;

    try {
      // total = endowed(2) + earned(3) = 5 -> one visit away from rung0 (6 visits).
      await admin
        .from("member_progress")
        .update({ earned_count: 3 })
        .eq("member_id", memberId4)
        .eq("program_id", LADDER_PROGRAM);

      const visitResult = await recordVisit({ memberId: memberId4, source: "lookup" });
      expect(visitResult.status).toBe("visit_added");
      expect(visitResult.newGrants.some((g) => g.slot === "ladder:0:1")).toBe(true);

      const { data: visitEvent } = await admin
        .from("events")
        .select("id")
        .eq("member_id", memberId4)
        .eq("type", "visit")
        .eq("voided", false)
        .single();

      const undoResult = await undoEvent(visitEvent!.id);
      expect(undoResult).toEqual({ status: "undone", type: "visit" });

      const { data: grantAfter } = await admin
        .from("reward_grants")
        .select("state")
        .eq("member_id", memberId4)
        .eq("grant_slot", "ladder:0:1")
        .single();
      expect(grantAfter?.state).toBe("voided");

      const { data: progressAfter } = await admin
        .from("member_progress")
        .select("earned_count")
        .eq("member_id", memberId4)
        .eq("program_id", LADDER_PROGRAM)
        .single();
      expect(progressAfter?.earned_count).toBe(3);
    } finally {
      await admin.from("reward_grants").delete().eq("member_id", memberId4);
      await admin.from("events").delete().eq("member_id", memberId4);
      await admin.from("members").delete().eq("id", memberId4);
    }
  });

  it("redeem -> undo -> redeem: the reopened slot lets a fresh visit land [Cx2-28]", async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const { joinMember } = await import("./members");
    const { CONSENT_VERSION } = await import("./consent");
    const { redeemReward, undoEvent } = await import("./scan");
    const admin = createSupabaseAdminClient();

    const joined = await joinMember({
      restaurantId: DEMO_RESTAURANT,
      phone: randPhoneLocal(),
      name: "Redeem Undo Redeem Member",
      consentVersion: CONSENT_VERSION,
      source: "self_scan",
    });
    const memberId5 = joined.member.id;

    try {
      const { data: welcomeGrant } = await admin
        .from("reward_grants")
        .select("one_use_token")
        .eq("member_id", memberId5)
        .eq("grant_slot", "welcome")
        .single();
      const token = welcomeGrant!.one_use_token;

      const first = await redeemReward(token, "lookup");
      expect(first.status).toBe("valid");
      if (first.status !== "valid") throw new Error("unreachable");
      expect(first.visit_added).toBe(true);
      const firstVisitId = first.visit_event_id!;

      const undoResult = await undoEvent(first.event_id);
      expect(undoResult).toMatchObject({ status: "undone", type: "redemption", visit_undone: "yes" });

      const second = await redeemReward(token, "lookup");
      expect(second.status).toBe("valid");
      if (second.status !== "valid") throw new Error("unreachable");
      expect(second.visit_added).toBe(true); // slot reopened by the voided undo -> a fresh visit lands
      expect(second.visit_event_id).not.toBe(firstVisitId);
    } finally {
      await admin.from("reward_grants").delete().eq("member_id", memberId5);
      await admin.from("events").delete().eq("member_id", memberId5);
      await admin.from("members").delete().eq("id", memberId5);
    }
  });
});

function randPhoneLocal(): string {
  return `+4477009${String(Math.floor(Math.random() * 90000) + 10000)}`;
}
