/**
 * Integration test against the LOCAL Supabase stack — same pattern as
 * ./integration.test.ts. Exercises chooseGrantOption's validation branches.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??=
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3005";
process.env.STAFF_AUTH_SECRET ??= "dev-staff-secret";
process.env.SMS_PROVIDER ??= "simulated";

const DEMO_RESTAURANT = "00000000-0000-4000-8000-000000000001";
const LADDER_PROGRAM = "00000000-0000-4000-8000-000000000102";
const randPhone = () => `+4477009${String(Math.floor(Math.random() * 90000) + 10000)}`;

let memberId: string;
let otherMemberId: string;
let choiceGrantId: string;
let fixedGrantId: string;

describe("chooseGrantOption", () => {
  beforeAll(async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const { joinMember } = await import("./members");
    const { CONSENT_VERSION } = await import("./consent");
    const admin = createSupabaseAdminClient();

    const joined = await joinMember({
      restaurantId: DEMO_RESTAURANT,
      phone: randPhone(),
      name: "Choice Test Member",
      consentVersion: CONSENT_VERSION,
      source: "self_scan",
    });
    memberId = joined.member.id;
    const other = await joinMember({
      restaurantId: DEMO_RESTAURANT,
      phone: randPhone(),
      name: "Choice Test Other Member",
      consentVersion: CONSENT_VERSION,
      source: "self_scan",
    });
    otherMemberId = other.member.id;

    const { data: choiceGrant, error: choiceError } = await admin
      .from("reward_grants")
      .insert({
        restaurant_id: DEMO_RESTAURANT,
        member_id: memberId,
        program_id: LADDER_PROGRAM,
        reward_text: "Free naan or Free dessert",
        reward_options: [{ reward: "Free naan", ring_up_note: "1x naan" }, { reward: "Free dessert" }],
        one_use_token: `rwd_test_choice_${Date.now()}`,
        grant_slot: `choice-test:${Date.now()}`,
        state: "earned",
      })
      .select("id")
      .single();
    if (choiceError) throw choiceError;
    choiceGrantId = choiceGrant!.id;

    const { data: fixedGrant, error: fixedError } = await admin
      .from("reward_grants")
      .insert({
        restaurant_id: DEMO_RESTAURANT,
        member_id: memberId,
        program_id: LADDER_PROGRAM,
        reward_text: "Free naan",
        reward_options: null,
        one_use_token: `rwd_test_fixed_${Date.now()}`,
        grant_slot: `fixed-test:${Date.now()}`,
        state: "earned",
      })
      .select("id")
      .single();
    if (fixedError) throw fixedError;
    fixedGrantId = fixedGrant!.id;
  });

  afterAll(async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    for (const id of [memberId, otherMemberId]) {
      if (id) await admin.from("members").delete().eq("id", id);
    }
  });

  it("rejects a grant belonging to a different member", async () => {
    const { chooseGrantOption } = await import("./choice");
    const result = await chooseGrantOption({ grantId: choiceGrantId, memberId: otherMemberId, optionIndex: 0 });
    expect(result).toEqual({ ok: false, error: "Grant not found." });
  });

  it("rejects a grant with no options snapshot", async () => {
    const { chooseGrantOption } = await import("./choice");
    const result = await chooseGrantOption({ grantId: fixedGrantId, memberId, optionIndex: 0 });
    expect(result).toEqual({ ok: false, error: "This reward has no choice to make." });
  });

  it("rejects an out-of-range option index", async () => {
    const { chooseGrantOption } = await import("./choice");
    const result = await chooseGrantOption({ grantId: choiceGrantId, memberId, optionIndex: 5 });
    expect(result).toEqual({ ok: false, error: "Invalid choice." });
  });

  it("stamps the chosen option and allows re-choosing while still earned", async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const { chooseGrantOption } = await import("./choice");
    const admin = createSupabaseAdminClient();

    const first = await chooseGrantOption({ grantId: choiceGrantId, memberId, optionIndex: 0 });
    expect(first).toEqual({ ok: true, rewardText: "Free naan", ringUpNote: "1x naan" });

    const { data: afterFirst } = await admin
      .from("reward_grants")
      .select("reward_text, ring_up_note, chosen_at")
      .eq("id", choiceGrantId)
      .single();
    expect(afterFirst?.reward_text).toBe("Free naan");
    expect(afterFirst?.chosen_at).not.toBeNull();

    // Re-choosing while still earned is allowed and overwrites the pick.
    const second = await chooseGrantOption({ grantId: choiceGrantId, memberId, optionIndex: 1 });
    expect(second).toEqual({ ok: true, rewardText: "Free dessert", ringUpNote: null });
  });

  it("rejects choosing on a redeemed grant", async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const { chooseGrantOption } = await import("./choice");
    const admin = createSupabaseAdminClient();
    await admin.from("reward_grants").update({ state: "redeemed", redeemed_at: new Date().toISOString() }).eq("id", choiceGrantId);

    const result = await chooseGrantOption({ grantId: choiceGrantId, memberId, optionIndex: 0 });
    expect(result).toEqual({ ok: false, error: "This reward isn't available to choose right now." });
  });
});

describe("setChoicePref (WS-E item 3 — pre-choice storage)", () => {
  // Own member, own beforeAll/afterAll — a sibling describe's hooks don't
  // wrap this block (vitest/jest only nest hooks within their own describe),
  // so reusing the outer describe's memberId here would run against an
  // already-deleted member once that describe's afterAll has fired.
  let prefMemberId: string;

  beforeAll(async () => {
    const { joinMember } = await import("./members");
    const { CONSENT_VERSION } = await import("./consent");
    const joined = await joinMember({
      restaurantId: DEMO_RESTAURANT,
      phone: randPhone(),
      name: "Pre-choice Test Member",
      consentVersion: CONSENT_VERSION,
      source: "self_scan",
    });
    prefMemberId = joined.member.id;
  });

  afterAll(async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    if (prefMemberId) await createSupabaseAdminClient().from("members").delete().eq("id", prefMemberId);
  });

  it("rejects a member not enrolled in the program", async () => {
    const { setChoicePref } = await import("./choice");
    const result = await setChoicePref({
      memberId: "00000000-0000-4000-8000-000000000fff",
      programId: LADDER_PROGRAM,
      rungVisits: 6,
      cycle: 1,
      optionReward: "Free naan",
    });
    expect(result).toEqual({ ok: false, error: "You're not enrolled in this reward." });
  });

  it("rejects a rung that doesn't exist on the program's config", async () => {
    const { setChoicePref } = await import("./choice");
    const result = await setChoicePref({ memberId: prefMemberId, programId: LADDER_PROGRAM, rungVisits: 999, cycle: 1, optionReward: "Free naan" });
    expect(result).toEqual({ ok: false, error: "That reward step doesn't exist." });
  });

  it("rejects an option that isn't one of the rung's real options", async () => {
    const { setChoicePref } = await import("./choice");
    const result = await setChoicePref({ memberId: prefMemberId, programId: LADDER_PROGRAM, rungVisits: 6, cycle: 1, optionReward: "Free everything" });
    expect(result).toEqual({ ok: false, error: "Invalid choice." });
  });

  it("stores a valid pick and lets it be changed", async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const { setChoicePref, choicePrefFor, parseChoicePref } = await import("./choice");
    const admin = createSupabaseAdminClient();

    const first = await setChoicePref({ memberId: prefMemberId, programId: LADDER_PROGRAM, rungVisits: 6, cycle: 1, optionReward: "Free naan" });
    expect(first).toEqual({ ok: true });

    const { data: afterFirst } = await admin.from("member_progress").select("choice_pref").eq("member_id", prefMemberId).eq("program_id", LADDER_PROGRAM).single();
    expect(choicePrefFor(parseChoicePref(afterFirst?.choice_pref), 6, 1)).toBe("Free naan");

    const second = await setChoicePref({ memberId: prefMemberId, programId: LADDER_PROGRAM, rungVisits: 6, cycle: 1, optionReward: "Free dessert" });
    expect(second).toEqual({ ok: true });

    const { data: afterSecond } = await admin.from("member_progress").select("choice_pref").eq("member_id", prefMemberId).eq("program_id", LADDER_PROGRAM).single();
    expect(choicePrefFor(parseChoicePref(afterSecond?.choice_pref), 6, 1)).toBe("Free dessert");
  });

  it("concurrent picks for two different laps don't lose either write (CAS retry, Codex #13)", async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const { setChoicePref, choicePrefFor, parseChoicePref } = await import("./choice");
    const admin = createSupabaseAdminClient();

    // Both target the SAME member_progress row (rungVisits 6 is a real,
    // valid rung for both — only the cycle/lap and picked option differ),
    // fired concurrently. The old read-whole-document/write-whole-document
    // code would let one write silently clobber the other's key; the CAS
    // fix makes the loser re-read and retry instead, so both picks land.
    const [a, b] = await Promise.all([
      setChoicePref({ memberId: prefMemberId, programId: LADDER_PROGRAM, rungVisits: 6, cycle: 5, optionReward: "Free naan" }),
      setChoicePref({ memberId: prefMemberId, programId: LADDER_PROGRAM, rungVisits: 6, cycle: 6, optionReward: "Free dessert" }),
    ]);
    expect(a).toEqual({ ok: true });
    expect(b).toEqual({ ok: true });

    const { data: row } = await admin
      .from("member_progress")
      .select("choice_pref")
      .eq("member_id", prefMemberId)
      .eq("program_id", LADDER_PROGRAM)
      .single();
    const pref = parseChoicePref(row?.choice_pref);
    expect(choicePrefFor(pref, 6, 5)).toBe("Free naan");
    expect(choicePrefFor(pref, 6, 6)).toBe("Free dessert");
  });
});
