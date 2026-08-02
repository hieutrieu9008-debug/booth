/**
 * Integration test against the LOCAL Supabase stack — same pattern as
 * src/lib/booth/integration.test.ts. Exercises the staff choose-then-redeem
 * action path (SPEC-WS3.md item 3) through the real "use server" actions in
 * ./actions.ts, not just the underlying lib functions: lookupPhone must show
 * an unchosen multi-option grant as needing a choice, chooseGrant must stamp
 * it (never a silent default), and only then does redeemLookup succeed with
 * the diner's actual pick.
 *
 * next/headers's cookies() throws outside a real request scope, so the staff
 * session cookie is backed by an in-memory jar here — same read/write shape
 * requireStaffSession (via checkStaffSession/setStaffSessionCookie) expects.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??=
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3103";
process.env.STAFF_AUTH_SECRET ??= "dev-staff-secret";
process.env.SMS_PROVIDER ??= "simulated";

const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => cookieJar.get(name),
    set: (name: string, value: string) => {
      cookieJar.set(name, { value });
    },
    delete: (name: string) => cookieJar.delete(name),
  }),
}));
// Only exercised by the FIX D describe block below, which calls the real
// dashboard deactivateStaffPin action — outside a real Next.js request scope
// requireOwnerRestaurant needs a Supabase Auth session it can't get here, and
// revalidatePath throws ("static generation store missing"), so both are
// mocked. Inert for every other test in this file.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/owner", () => ({
  requireOwnerRestaurant: vi.fn(async () => ({
    id: "00000000-0000-4000-8000-000000000001",
    slug: "demo-kitchen",
    name: "Demo Kitchen",
  })),
}));

const DEMO_RESTAURANT = "00000000-0000-4000-8000-000000000001";
const DEMO_SLUG = "demo-kitchen";
const LADDER_PROGRAM = "00000000-0000-4000-8000-000000000102";
const randPhone = () => `+4477009${String(Math.floor(Math.random() * 90000) + 10000)}`;

let memberId: string;
let choiceGrantId: string;
let choiceToken: string;

describe("staff choose-then-redeem action path (./actions.ts)", () => {
  beforeAll(async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const { joinMember } = await import("@/lib/booth/members");
    const { CONSENT_VERSION } = await import("@/lib/booth/consent");
    const { setStaffSessionCookie } = await import("@/lib/booth/staff-session");
    const { newRewardToken } = await import("@/lib/booth/tokens");
    const admin = createSupabaseAdminClient();

    const { data: pin, error: pinError } = await admin
      .from("staff_pins")
      .select("id")
      .eq("restaurant_id", DEMO_RESTAURANT)
      .eq("active", true)
      .limit(1)
      .single();
    if (pinError) throw new Error(`Local Supabase not reachable/seeded: ${pinError.message}`);
    await setStaffSessionCookie(DEMO_SLUG, DEMO_RESTAURANT, pin!.id);

    const joined = await joinMember({
      restaurantId: DEMO_RESTAURANT,
      phone: randPhone(),
      name: "Action Choice Member",
      consentVersion: CONSENT_VERSION,
      source: "self_scan",
    });
    memberId = joined.member.id;

    choiceToken = newRewardToken();
    const { data: grant, error: grantError } = await admin
      .from("reward_grants")
      .insert({
        restaurant_id: DEMO_RESTAURANT,
        member_id: memberId,
        program_id: LADDER_PROGRAM,
        reward_text: "Free naan or Free dessert",
        reward_options: [{ reward: "Free naan", ring_up_note: "1x naan" }, { reward: "Free dessert" }],
        one_use_token: choiceToken,
        grant_slot: `actions-test-choice:${Date.now()}`,
        state: "earned",
      })
      .select("id")
      .single();
    if (grantError) throw grantError;
    choiceGrantId = grant!.id;
  });

  afterAll(async () => {
    if (!memberId) return;
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    await admin.from("reward_grants").delete().eq("member_id", memberId);
    await admin.from("events").delete().eq("member_id", memberId);
    await admin.from("members").delete().eq("id", memberId);
  });

  it("lookupPhone surfaces the unchosen multi-option grant with its options and no chosen text yet", async () => {
    const { lookupPhone } = await import("./actions");
    const member = await lookupPhone(DEMO_SLUG, randPhone()); // wrong number -> not found, sanity check first
    expect(member).toEqual({ found: false });

    const { findMemberByPhone } = await import("@/lib/booth/members");
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    const { data: row } = await admin.from("members").select("phone").eq("id", memberId).single();
    const found = await findMemberByPhone(DEMO_RESTAURANT, row!.phone);
    expect(found?.id).toBe(memberId);

    const lookup = await lookupPhone(DEMO_SLUG, row!.phone);
    expect(lookup.found).toBe(true);
    if (!lookup.found) throw new Error("unreachable");
    const grant = lookup.grants.find((g) => g.grantId === choiceGrantId);
    expect(grant).toMatchObject({
      chosenAt: null,
      options: [{ reward: "Free naan", ring_up_note: "1x naan" }, { reward: "Free dessert" }],
    });
  });

  it("the DB layer refuses to redeem an unchosen choice grant (server backstop, fn_redeem_grant v3): choice_required, not a silent raw-placeholder redeem", async () => {
    const { redeemLookup } = await import("./actions");
    const outcome = await redeemLookup(DEMO_SLUG, choiceToken);
    expect(outcome.kind).toBe("choice_required");
    if (outcome.kind !== "choice_required") throw new Error("unreachable");
    expect(outcome.rewardText).toBe("Free naan or Free dessert");
  });
});

describe("staff choose-then-redeem action path — fresh grant, choice stamped before redeem", () => {
  let member2Id: string;
  let grant2Id: string;
  let token2: string;

  beforeAll(async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const { joinMember } = await import("@/lib/booth/members");
    const { CONSENT_VERSION } = await import("@/lib/booth/consent");
    const { newRewardToken } = await import("@/lib/booth/tokens");
    const admin = createSupabaseAdminClient();

    const joined = await joinMember({
      restaurantId: DEMO_RESTAURANT,
      phone: randPhone(),
      name: "Action Choose Then Redeem Member",
      consentVersion: CONSENT_VERSION,
      source: "self_scan",
    });
    member2Id = joined.member.id;

    token2 = newRewardToken();
    const { data: grant, error } = await admin
      .from("reward_grants")
      .insert({
        restaurant_id: DEMO_RESTAURANT,
        member_id: member2Id,
        program_id: LADDER_PROGRAM,
        reward_text: "Free naan or Free dessert",
        reward_options: [{ reward: "Free naan" }, { reward: "Free dessert", ring_up_note: "1x dessert" }],
        one_use_token: token2,
        grant_slot: `actions-test-choose-redeem:${Date.now()}`,
        state: "earned",
      })
      .select("id")
      .single();
    if (error) throw error;
    grant2Id = grant!.id;
  });

  afterAll(async () => {
    if (!member2Id) return;
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    await admin.from("reward_grants").delete().eq("member_id", member2Id);
    await admin.from("events").delete().eq("member_id", member2Id);
    await admin.from("members").delete().eq("id", member2Id);
  });

  it("chooseGrant stamps the diner's spoken pick, then redeemLookup redeems exactly that pick", async () => {
    const { chooseGrant, redeemLookup, lookupPhone } = await import("./actions");
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    const { data: row } = await admin.from("members").select("phone").eq("id", member2Id).single();

    const choice = await chooseGrant(DEMO_SLUG, member2Id, grant2Id, 1);
    expect(choice).toEqual({ ok: true, rewardText: "Free dessert", ringUpNote: "1x dessert" });

    const afterChoice = await lookupPhone(DEMO_SLUG, row!.phone);
    expect(afterChoice.found).toBe(true);
    if (!afterChoice.found) throw new Error("unreachable");
    const grantRow = afterChoice.grants.find((g) => g.grantId === grant2Id);
    expect(grantRow).toMatchObject({ rewardText: "Free dessert", ringUpNote: "1x dessert" });
    expect(grantRow?.chosenAt).not.toBeNull();

    const outcome = await redeemLookup(DEMO_SLUG, token2);
    expect(outcome.kind).toBe("redeem_valid");
    if (outcome.kind !== "redeem_valid") throw new Error("unreachable");
    expect(outcome.rewardText).toBe("Free dessert");
    expect(outcome.ringUpNote).toBe("1x dessert");
    expect(typeof outcome.visitAdded).toBe("boolean");
  });
});

describe("requireStaffSession — deactivated PIN locks out mid-session (FIX D)", () => {
  let freshPinId: string;

  beforeAll(async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    const { data: pin, error } = await admin
      .from("staff_pins")
      .insert({
        restaurant_id: DEMO_RESTAURANT,
        label: `FIX-D test pin ${Date.now()}`,
        pin_hash: `fixd-test-hash-${Date.now()}-${Math.random()}`,
      })
      .select("id")
      .single();
    if (error) throw error;
    freshPinId = pin!.id;
  });

  afterAll(async () => {
    if (!freshPinId) return;
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    await admin.from("staff_pins").delete().eq("id", freshPinId);
  });

  it("a staff action fails once the PIN is deactivated via the dashboard action, even with a still-valid session cookie", async () => {
    const { setStaffSessionCookie } = await import("@/lib/booth/staff-session");
    const { lookupPhone } = await import("./actions");
    const { deactivateStaffPin } = await import("@/app/dashboard/staff/actions");

    // Sign in with the fresh (active) PIN — the session cookie itself stays
    // valid for up to 8h regardless of what happens to the PIN row next.
    await setStaffSessionCookie(DEMO_SLUG, DEMO_RESTAURANT, freshPinId);
    await expect(lookupPhone(DEMO_SLUG, "+447700900000")).resolves.toEqual({ found: false }); // sanity: works while active

    // Owner deactivates the PIN from the dashboard — same action a real
    // "Deactivate" click in /dashboard/staff runs.
    const deactivateResult = await deactivateStaffPin(freshPinId);
    expect(deactivateResult).toEqual({ ok: true });

    // Same still-valid cookie, but the PIN row is now inactive — must fail.
    await expect(lookupPhone(DEMO_SLUG, "+447700900000")).rejects.toThrow("Staff PIN deactivated");
  });
});

describe("getRedemptionsToday — DST-correct local-day boundaries (Codex #14)", () => {
  let restaurantId: string;
  let dstSlug: string;
  let memberId: string;
  let lateEventId: string;
  let pinId: string;

  beforeAll(async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const { joinMember } = await import("@/lib/booth/members");
    const { CONSENT_VERSION } = await import("@/lib/booth/consent");
    const { newRewardToken } = await import("@/lib/booth/tokens");
    const { setStaffSessionCookie } = await import("@/lib/booth/staff-session");
    const admin = createSupabaseAdminClient();

    dstSlug = `dst-boundary-test-${Date.now()}`;
    const { data: restaurant, error } = await admin
      .from("restaurants")
      .insert({ slug: dstSlug, name: "DST Boundary Test Kitchen", timezone: "America/Chicago" })
      .select("id")
      .single();
    if (error || !restaurant) throw error;
    restaurantId = restaurant.id;

    const { data: pin, error: pinError } = await admin
      .from("staff_pins")
      .insert({ restaurant_id: restaurantId, label: "DST Test Pin", pin_hash: `dst-test-${Date.now()}` })
      .select("id")
      .single();
    if (pinError || !pin) throw pinError;
    // NOT setting the staff session cookie here: it's re-issued inside the
    // `it` below, AFTER vi.setSystemTime — the cookie's own 8h issuedAt
    // check (staff-session.ts) reads Date.now() too, so a cookie minted
    // under the real clock and then checked under a faked future clock
    // would read as expired.
    pinId = pin.id;

    const joined = await joinMember({ restaurantId, phone: randPhone(), name: "DST Member", consentVersion: CONSENT_VERSION, source: "self_scan" });
    memberId = joined.member.id;

    const { data: program, error: programError } = await admin
      .from("reward_programs")
      .insert({ restaurant_id: restaurantId, type: "anytime", name: "DST Anytime", active: true, config: { reward: "Free tea", per_member_limit: 5 } })
      .select("id")
      .single();
    if (programError || !program) throw programError;

    const { data: grant, error: grantError } = await admin
      .from("reward_grants")
      .insert({
        restaurant_id: restaurantId,
        member_id: memberId,
        program_id: program.id,
        reward_text: "Free tea",
        one_use_token: newRewardToken(),
        grant_slot: `dst-test:${Date.now()}`,
        state: "earned",
      })
      .select("id")
      .single();
    if (grantError || !grant) throw grantError;

    // 2026-11-01 is America/Chicago's fall-back day (CDT -> CST): the clocks
    // repeat 1am-2am local, so the local calendar day is 25 real UTC hours
    // long (05:00Z Nov 1 -> 06:00Z Nov 2). This redemption is at 23:30 local
    // on Nov 1 — still "today" — but lands past the OLD code's fixed
    // start+24h end boundary, which landed at 23:00 local (05:00Z Nov 2), an
    // hour short. These UTC instants were computed independently of the
    // fixed code under test, via a standalone Intl offset probe, not by
    // importing wallTimeToUtc.
    const { data: event, error: eventError } = await admin
      .from("events")
      .insert({
        restaurant_id: restaurantId,
        member_id: memberId,
        type: "redemption",
        source: "staff_scan",
        grant_id: grant.id,
        created_at: "2026-11-02T05:30:00.000Z", // 2026-11-01 23:30 America/Chicago
      })
      .select("id")
      .single();
    if (eventError || !event) throw eventError;
    lateEventId = event.id;
  });

  afterAll(async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    if (memberId) {
      await admin.from("events").delete().eq("member_id", memberId);
      await admin.from("reward_grants").delete().eq("member_id", memberId);
      await admin.from("member_progress").delete().eq("member_id", memberId);
      await admin.from("members").delete().eq("id", memberId);
    }
    if (restaurantId) {
      await admin.from("reward_programs").delete().eq("restaurant_id", restaurantId);
      await admin.from("staff_pins").delete().eq("restaurant_id", restaurantId);
      await admin.from("restaurants").delete().eq("id", restaurantId);
    }
  });

  it("includes a redemption at 23:30 local on a 25-hour (fall-back) local day", async () => {
    // vi.setSystemTime WITHOUT vi.useFakeTimers only patches the global Date
    // object (new Date()/Date.now()) — it leaves setTimeout/setInterval on
    // real timers, so it can't hang this integration test's real network
    // calls to local Supabase the way full fake timers risk doing.
    vi.setSystemTime(new Date("2026-11-01T18:00:00.000Z")); // Nov 1, noon local (America/Chicago)
    try {
      // Mint the staff session UNDER the faked clock (see beforeAll comment).
      const { setStaffSessionCookie } = await import("@/lib/booth/staff-session");
      await setStaffSessionCookie(dstSlug, restaurantId, pinId);
      const { getRedemptionsToday } = await import("./actions");
      const rows = await getRedemptionsToday(dstSlug);
      expect(rows.map((r) => r.id)).toContain(lateEventId);
    } finally {
      vi.useRealTimers();
    }
  });
});
