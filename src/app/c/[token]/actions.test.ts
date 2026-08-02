/**
 * Integration test against the LOCAL Supabase stack — exercises the
 * card-token-scoped chooseRewardAction wrapper (not just the underlying
 * chooseGrantOption, which choice.test.ts already covers): a diner's own
 * magic-token link must resolve to their own member id, and a wrong/expired
 * token must never leak a choice write.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??=
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3102";
process.env.STAFF_AUTH_SECRET ??= "dev-staff-secret";
process.env.SMS_PROVIDER ??= "simulated";

const DEMO_RESTAURANT = "00000000-0000-4000-8000-000000000001";
const LADDER_PROGRAM = "00000000-0000-4000-8000-000000000102";
const randPhone = () => `+4477009${String(Math.floor(Math.random() * 90000) + 10000)}`;

let memberId: string;
let otherMemberId: string;
let token: string;
let otherToken: string;
let choiceGrantId: string;

describe("chooseRewardAction (card-token scoped)", () => {
  beforeAll(async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const { joinMember } = await import("@/lib/booth/members");
    const { CONSENT_VERSION } = await import("@/lib/booth/consent");
    const { createMemberCardLink } = await import("@/lib/booth/links");
    const admin = createSupabaseAdminClient();

    const joined = await joinMember({ restaurantId: DEMO_RESTAURANT, phone: randPhone(), name: "Action Test Member", consentVersion: CONSENT_VERSION, source: "self_scan" });
    memberId = joined.member.id;
    token = (await createMemberCardLink(memberId)).split("/c/")[1];

    const other = await joinMember({ restaurantId: DEMO_RESTAURANT, phone: randPhone(), name: "Action Test Other", consentVersion: CONSENT_VERSION, source: "self_scan" });
    otherMemberId = other.member.id;
    otherToken = (await createMemberCardLink(otherMemberId)).split("/c/")[1];

    const { data: grant, error } = await admin
      .from("reward_grants")
      .insert({
        restaurant_id: DEMO_RESTAURANT,
        member_id: memberId,
        program_id: LADDER_PROGRAM,
        reward_text: "Free naan or Free dessert",
        reward_options: [{ reward: "Free naan", ring_up_note: "1x naan" }, { reward: "Free dessert" }],
        one_use_token: `rwd_test_action_${Date.now()}`,
        grant_slot: `action-test:${Date.now()}`,
        state: "earned",
      })
      .select("id")
      .single();
    if (error) throw error;
    choiceGrantId = grant!.id;
  });

  afterAll(async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    for (const id of [memberId, otherMemberId]) {
      if (id) await admin.from("members").delete().eq("id", id);
    }
  });

  it("rejects an invalid/expired token before touching the grant", async () => {
    const { chooseRewardAction } = await import("./actions");
    const result = await chooseRewardAction("not-a-real-token", choiceGrantId, 0);
    expect(result).toEqual({ ok: false, error: "This link has expired." });
  });

  it("rejects a diner's token against a grant that belongs to someone else", async () => {
    const { chooseRewardAction } = await import("./actions");
    const result = await chooseRewardAction(otherToken, choiceGrantId, 0);
    expect(result).toEqual({ ok: false, error: "Grant not found." });
  });

  it("resolves the diner's own token to their member id and stamps the pick", async () => {
    const { chooseRewardAction } = await import("./actions");
    const first = await chooseRewardAction(token, choiceGrantId, 1);
    expect(first).toEqual({ ok: true, rewardText: "Free dessert", ringUpNote: null });

    // Re-choosable while still earned (SPEC-WS2 §Member card 2).
    const second = await chooseRewardAction(token, choiceGrantId, 0);
    expect(second).toEqual({ ok: true, rewardText: "Free naan", ringUpNote: "1x naan" });
  });
});
