/**
 * Integration test against the LOCAL Supabase stack — exercises
 * materializeGrants' pre-choice pref copy-at-earn behavior (WS-E item 3).
 * Own throwaway restaurant + program, NOT the shared demo tenant: joining
 * members into the demo restaurant races src/lib/booth/engine.test.ts's
 * fan-out recipient counts (see src/app/api/sms/inbound/route.test.ts's
 * comment for the same rationale).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??=
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3106";
process.env.STAFF_AUTH_SECRET ??= "dev-staff-secret";
process.env.SMS_PROVIDER ??= "simulated";

const randPhone = () => `+4477009${String(Math.floor(Math.random() * 90000) + 10000)}`;

let restaurantId: string;
let programId: string;
let memberId: string;
let unchosenMemberId: string;

describe("materializeGrants — pre-choice pref copy-at-earn", () => {
  beforeAll(async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const { joinMember } = await import("./members");
    const { CONSENT_VERSION } = await import("./consent");
    const admin = createSupabaseAdminClient();

    const { data: restaurant, error: restaurantError } = await admin
      .from("restaurants")
      .insert({ name: "Pre-choice Test Kitchen", slug: `prechoice-test-${Math.floor(Math.random() * 1e9)}`, country: "GB" })
      .select("id")
      .single();
    if (restaurantError || !restaurant) throw new Error(`Local Supabase not reachable: ${restaurantError?.message}`);
    restaurantId = restaurant.id;

    const { data: program, error: programError } = await admin
      .from("reward_programs")
      .insert({
        restaurant_id: restaurantId,
        type: "visit_ladder",
        name: "Loyalty ladder",
        active: true,
        config: {
          endowed_start: 0,
          loop: false,
          rungs: [{ visits: 4, options: [{ reward: "Free naan", ring_up_note: "1x naan" }, { reward: "Free dessert" }] }],
        },
      })
      .select("id")
      .single();
    if (programError || !program) throw programError;
    programId = program.id;

    const joined = await joinMember({ restaurantId, phone: randPhone(), name: "Pre-choice Member", consentVersion: CONSENT_VERSION, source: "self_scan" });
    memberId = joined.member.id;
    const unchosen = await joinMember({ restaurantId, phone: randPhone(), name: "No Pref Member", consentVersion: CONSENT_VERSION, source: "self_scan" });
    unchosenMemberId = unchosen.member.id;

    // joinMember's ladder enrollment races the beforeAll insert order above —
    // enroll explicitly here rather than depending on it having seen the
    // program already (it does, since the program insert happens first, but
    // this keeps the test's intent self-contained).
    await admin
      .from("member_progress")
      .update({ earned_count: 4 })
      .eq("member_id", memberId)
      .eq("program_id", programId);
    await admin
      .from("member_progress")
      .update({ earned_count: 4 })
      .eq("member_id", unchosenMemberId)
      .eq("program_id", programId);
  });

  afterAll(async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    for (const id of [memberId, unchosenMemberId]) {
      if (id) await admin.from("members").delete().eq("id", id);
    }
    if (restaurantId) await admin.from("restaurants").delete().eq("id", restaurantId);
  });

  it("copies the diner's pre-choice pref onto the grant, chosen_at stamped, hasChoice false", async () => {
    const { setChoicePref } = await import("./choice");
    const { materializeGrants } = await import("./rewards");

    const setResult = await setChoicePref({ memberId, programId, rungVisits: 4, cycle: 1, optionReward: "Free dessert" });
    expect(setResult).toEqual({ ok: true });

    const { newGrants } = await materializeGrants(memberId);
    expect(newGrants).toHaveLength(1);
    expect(newGrants[0].rewardText).toBe("Free dessert");
    expect(newGrants[0].hasChoice).toBe(false);

    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    const { data: grant } = await admin
      .from("reward_grants")
      .select("reward_text, ring_up_note, reward_options, chosen_at")
      .eq("member_id", memberId)
      .eq("program_id", programId)
      .single();
    expect(grant?.reward_text).toBe("Free dessert");
    expect(grant?.chosen_at).not.toBeNull();
    expect(grant?.reward_options).toHaveLength(2); // snapshot preserved for later re-choice
  });

  it("leaves reward_text as staff-readable 'or' text and hasChoice true when no pref was set", async () => {
    const { materializeGrants } = await import("./rewards");
    const { newGrants } = await materializeGrants(unchosenMemberId);
    expect(newGrants).toHaveLength(1);
    expect(newGrants[0].rewardText).toBe("Free naan or Free dessert");
    expect(newGrants[0].hasChoice).toBe(true);

    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    const { data: grant } = await admin
      .from("reward_grants")
      .select("chosen_at")
      .eq("member_id", unchosenMemberId)
      .eq("program_id", programId)
      .single();
    expect(grant?.chosen_at).toBeNull();
  });
});
