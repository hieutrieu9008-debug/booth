/**
 * Multi-tenant isolation + concurrency proof — Phase B evidence that the
 * platform needs ZERO per-client code to run many different restaurants at
 * once. Builds two THROWAWAY restaurants of its own (never demo-kitchen,
 * never scripts/seed-variety.mjs's tenants — this file cleans up everything
 * it creates in afterAll), then runs joinMember / fn_record_visit /
 * fn_redeem_grant INTERLEAVED (Promise.all) across both and asserts every
 * table a tenant's data can land in — members, member_progress,
 * reward_grants, events, messages, consent_events, staff_pins,
 * campaign_recipients — never crosses tenant lines, even under concurrency
 * and even when both tenants happen to use the identical staff PIN digits.
 *
 * Same pattern as src/lib/booth/integration.test.ts / src/app/dashboard/
 * members/custom-offer.test.ts: dynamic imports inside beforeAll/it (env
 * vars below must be set before any module that reads them at call time
 * loads), a real local Supabase stack (npx supabase start), cleanup via
 * `restaurants` delete cascading through every composite FK in the schema.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??=
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3005";
process.env.STAFF_AUTH_SECRET ??= "dev-staff-secret";
process.env.SMS_PROVIDER ??= "simulated";

// Deliberately IDENTICAL across both tenants — staff_pins is only unique on
// (restaurant_id, pin_hash), so two tenants may legitimately share a PIN.
// Any lookup that isn't correctly restaurant-scoped would resolve tenant B's
// login to tenant A's pin row (or vice versa); every assertion below proves
// that never happens despite the hash collision.
const SAME_PIN = "9090";

function randPhone(tag: string): string {
  return `+4477${tag}${String(Math.floor(Math.random() * 900000) + 100000)}`;
}

type Tenant = {
  restaurantId: string;
  slug: string;
  staffPinId: string;
  welcomeProgramId: string;
  ladderProgramId: string;
};

async function createTenant(label: string): Promise<Tenant> {
  const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
  const { hashStaffPin } = await import("@/lib/booth/tokens");
  const admin = createSupabaseAdminClient();

  const restaurantId = crypto.randomUUID();
  const slug = `mt-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const { error: restaurantError } = await admin.from("restaurants").insert({
    id: restaurantId,
    slug,
    name: `Multi-Tenant Test ${label}`,
    timezone: "Europe/London",
    phone_prefix: "+44",
    currency: "GBP",
    country: "GB",
  });
  if (restaurantError) throw restaurantError;

  const welcomeProgramId = crypto.randomUUID();
  const ladderProgramId = crypto.randomUUID();
  const { error: programsError } = await admin.from("reward_programs").insert([
    {
      id: welcomeProgramId,
      restaurant_id: restaurantId,
      type: "welcome",
      name: "Welcome",
      active: true,
      config: { reward: `Test welcome reward (${label})`, valid_days: 14 },
    },
    {
      id: ladderProgramId,
      restaurant_id: restaurantId,
      type: "visit_ladder",
      name: "Ladder",
      active: true,
      // endowed_start:0, single rung at visits:1 — one visit (or a
      // welcome-redeem's auto-visit) immediately materializes a new grant,
      // which is what drives a `messages` row for the isolation checks below.
      // loop:false — a looping single-rung ladder rolls earned_count back to
      // 0 the instant it's crossed (lapComplete/consumedOnLapReset in
      // ladder.ts); non-looping keeps this test's arithmetic to plain
      // cumulative visit counts, which is all the isolation proof needs.
      config: { endowed_start: 0, loop: false, rungs: [{ visits: 1, options: [{ reward: `Test rung reward (${label})` }] }] },
    },
  ]);
  if (programsError) throw programsError;

  const staffPinId = crypto.randomUUID();
  const { error: pinError } = await admin.from("staff_pins").insert({
    id: staffPinId,
    restaurant_id: restaurantId,
    label: `${label} till`,
    pin_hash: hashStaffPin(SAME_PIN),
  });
  if (pinError) throw pinError;

  return { restaurantId, slug, staffPinId, welcomeProgramId, ladderProgramId };
}

let tenantA: Tenant;
let tenantB: Tenant;

beforeAll(async () => {
  [tenantA, tenantB] = await Promise.all([createTenant("alpha"), createTenant("beta")]);
});

afterAll(async () => {
  const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
  const admin = createSupabaseAdminClient();
  // Deleting the restaurant cascades through every composite FK in the
  // schema (members -> member_progress/reward_grants/events/consent_events,
  // reward_programs, staff_pins, campaigns -> campaign_recipients, messages)
  // — same cleanup idiom as custom-offer.test.ts.
  await admin.from("restaurants").delete().in("id", [tenantA?.restaurantId, tenantB?.restaurantId].filter(Boolean));
});

describe("multi-tenant isolation under interleaved concurrency", () => {
  let memberA1: string;
  let memberB1: string;

  it("joinMember, interleaved across two tenants, writes each member + consent event to its own tenant only", async () => {
    const { joinMember } = await import("./members");
    const { CONSENT_VERSION } = await import("./consent");
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();

    const [joinedA, joinedB] = await Promise.all([
      joinMember({ restaurantId: tenantA.restaurantId, phone: randPhone("1"), name: "Alpha One", consentVersion: CONSENT_VERSION, source: "self_scan" }),
      joinMember({ restaurantId: tenantB.restaurantId, phone: randPhone("2"), name: "Beta One", consentVersion: CONSENT_VERSION, source: "self_scan" }),
    ]);
    memberA1 = joinedA.member.id;
    memberB1 = joinedB.member.id;

    expect(joinedA.member.restaurant_id).toBe(tenantA.restaurantId);
    expect(joinedB.member.restaurant_id).toBe(tenantB.restaurantId);
    expect(joinedA.welcomeGrant?.rewardText).toContain("alpha");
    expect(joinedB.welcomeGrant?.rewardText).toContain("beta");

    const [{ data: consentA }, { data: consentB }] = await Promise.all([
      admin.from("consent_events").select("member_id, restaurant_id, action").eq("restaurant_id", tenantA.restaurantId),
      admin.from("consent_events").select("member_id, restaurant_id, action").eq("restaurant_id", tenantB.restaurantId),
    ]);
    expect(consentA).toHaveLength(1);
    expect(consentA![0]).toMatchObject({ member_id: memberA1, action: "join" });
    expect(consentB).toHaveLength(1);
    expect(consentB![0]).toMatchObject({ member_id: memberB1, action: "join" });
    // Cross-check: neither tenant's consent log mentions the other tenant's member.
    expect(consentA!.some((r) => r.member_id === memberB1)).toBe(false);
    expect(consentB!.some((r) => r.member_id === memberA1)).toBe(false);
  });

  it("fn_redeem_grant, interleaved across two tenants, only bumps its own tenant's progress/grants/messages", async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const { redeemReward } = await import("./scan");
    const admin = createSupabaseAdminClient();

    const [{ data: welcomeA }, { data: welcomeB }] = await Promise.all([
      admin.from("reward_grants").select("one_use_token").eq("member_id", memberA1).eq("grant_slot", "welcome").single(),
      admin.from("reward_grants").select("one_use_token").eq("member_id", memberB1).eq("grant_slot", "welcome").single(),
    ]);

    const [redeemedA, redeemedB] = await Promise.all([
      redeemReward(welcomeA!.one_use_token, "lookup", tenantA.staffPinId),
      redeemReward(welcomeB!.one_use_token, "lookup", tenantB.staffPinId),
    ]);
    expect(redeemedA.status).toBe("valid");
    expect(redeemedB.status).toBe("valid");
    if (redeemedA.status !== "valid" || redeemedB.status !== "valid") throw new Error("unreachable");
    // The auto-visit crosses the single rung (visits:1, endowed:0) for both.
    expect(redeemedA.visit_added).toBe(true);
    expect(redeemedB.visit_added).toBe(true);

    const [{ data: progressA }, { data: progressB }] = await Promise.all([
      admin.from("member_progress").select("*").eq("member_id", memberA1),
      admin.from("member_progress").select("*").eq("member_id", memberB1),
    ]);
    expect(progressA).toHaveLength(1);
    expect(progressA![0]).toMatchObject({ program_id: tenantA.ladderProgramId, restaurant_id: tenantA.restaurantId, earned_count: 1 });
    expect(progressB).toHaveLength(1);
    expect(progressB![0]).toMatchObject({ program_id: tenantB.ladderProgramId, restaurant_id: tenantB.restaurantId, earned_count: 1 });

    const [{ data: grantsA }, { data: grantsB }] = await Promise.all([
      admin.from("reward_grants").select("restaurant_id, member_id, program_id, grant_slot, state").eq("member_id", memberA1),
      admin.from("reward_grants").select("restaurant_id, member_id, program_id, grant_slot, state").eq("member_id", memberB1),
    ]);
    // welcome (now redeemed) + the newly materialized ladder:0:1 grant.
    expect(grantsA).toHaveLength(2);
    expect(grantsA!.every((g) => g.restaurant_id === tenantA.restaurantId)).toBe(true);
    expect(grantsB).toHaveLength(2);
    expect(grantsB!.every((g) => g.restaurant_id === tenantB.restaurantId)).toBe(true);

    // notifyNewGrants (fired inside redeemReward once the auto-visit
    // materialized a new grant) sends the marketing nudge through
    // sendMarketing -> messages. Restaurant-scoped, member-scoped.
    const [{ data: messagesA }, { data: messagesB }] = await Promise.all([
      admin.from("messages").select("restaurant_id, member_id, kind").eq("restaurant_id", tenantA.restaurantId),
      admin.from("messages").select("restaurant_id, member_id, kind").eq("restaurant_id", tenantB.restaurantId),
    ]);
    expect(messagesA).toHaveLength(1);
    expect(messagesA![0]).toMatchObject({ member_id: memberA1, kind: "marketing" });
    expect(messagesB).toHaveLength(1);
    expect(messagesB![0]).toMatchObject({ member_id: memberB1, kind: "marketing" });
    expect(messagesA!.some((m) => m.member_id === memberB1)).toBe(false);
    expect(messagesB!.some((m) => m.member_id === memberA1)).toBe(false);
  });

  it("fn_record_visit RPC, interleaved raw across two tenants on FRESH members, only advances its own member/tenant", async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const { joinMember } = await import("./members");
    const { CONSENT_VERSION } = await import("./consent");
    const admin = createSupabaseAdminClient();

    const [joinedA2, joinedB2] = await Promise.all([
      joinMember({ restaurantId: tenantA.restaurantId, phone: randPhone("3"), name: "Alpha Two", consentVersion: CONSENT_VERSION, source: "self_scan" }),
      joinMember({ restaurantId: tenantB.restaurantId, phone: randPhone("4"), name: "Beta Two", consentVersion: CONSENT_VERSION, source: "self_scan" }),
    ]);
    const memberA2 = joinedA2.member.id;
    const memberB2 = joinedB2.member.id;

    const [visitA, visitB] = await Promise.all([
      admin.rpc("fn_record_visit", { p_member_id: memberA2, p_source: "staff_scan", p_staff_pin_id: tenantA.staffPinId }),
      admin.rpc("fn_record_visit", { p_member_id: memberB2, p_source: "staff_scan", p_staff_pin_id: tenantB.staffPinId }),
    ]);
    expect(visitA.data.status).toBe("visit_added");
    expect(visitB.data.status).toBe("visit_added");

    const [{ data: progressA2 }, { data: progressB2 }, { data: progressA1After }] = await Promise.all([
      admin.from("member_progress").select("*").eq("member_id", memberA2).single(),
      admin.from("member_progress").select("*").eq("member_id", memberB2).single(),
      admin.from("member_progress").select("earned_count").eq("member_id", memberA1).single(),
    ]);
    expect(progressA2).toMatchObject({ restaurant_id: tenantA.restaurantId, program_id: tenantA.ladderProgramId, earned_count: 1 });
    expect(progressB2).toMatchObject({ restaurant_id: tenantB.restaurantId, program_id: tenantB.ladderProgramId, earned_count: 1 });
    // The earlier test's member (memberA1, a DIFFERENT member in the same
    // tenant) is untouched by this concurrent RPC pair.
    expect(progressA1After?.earned_count).toBe(1);

    const [{ data: eventsA2 }, { data: eventsB2 }] = await Promise.all([
      admin.from("events").select("restaurant_id, member_id, staff_pin_id").eq("member_id", memberA2),
      admin.from("events").select("restaurant_id, member_id, staff_pin_id").eq("member_id", memberB2),
    ]);
    expect(eventsA2).toHaveLength(1);
    expect(eventsA2![0]).toMatchObject({ restaurant_id: tenantA.restaurantId, staff_pin_id: tenantA.staffPinId });
    expect(eventsB2).toHaveLength(1);
    expect(eventsB2![0]).toMatchObject({ restaurant_id: tenantB.restaurantId, staff_pin_id: tenantB.staffPinId });
  });

  it("a staff PIN identical across two tenants never resolves to the other tenant's pin row", async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const { hashStaffPin } = await import("@/lib/booth/tokens");
    const { getStaffPins } = await import("@/app/dashboard/staff/data");
    const admin = createSupabaseAdminClient();

    const [pinsA, pinsB] = await Promise.all([getStaffPins(tenantA.restaurantId), getStaffPins(tenantB.restaurantId)]);
    expect(pinsA).toHaveLength(1);
    expect(pinsA[0].id).toBe(tenantA.staffPinId);
    expect(pinsB).toHaveLength(1);
    expect(pinsB[0].id).toBe(tenantB.staffPinId);
    // Same PIN digits -> same pin_hash -> the two tenants' pin rows are
    // distinguishable ONLY by id/restaurant_id. Neither tenant's scoped list
    // contains the other tenant's pin id.
    expect(pinsA[0].pin_hash).toBe(pinsB[0].pin_hash);
    expect(pinsA.some((p) => p.id === tenantB.staffPinId)).toBe(false);
    expect(pinsB.some((p) => p.id === tenantA.staffPinId)).toBe(false);

    // Same lookup src/app/s/[slug]/actions.ts's submitPin runs at staff
    // login: restaurant_id + pin_hash, scoped. Resolves to THIS tenant's own
    // pin id even though the hash is shared with the other tenant.
    const pinHash = hashStaffPin(SAME_PIN);
    const [{ data: loginA }, { data: loginB }] = await Promise.all([
      admin.from("staff_pins").select("id").eq("restaurant_id", tenantA.restaurantId).eq("pin_hash", pinHash).eq("active", true).maybeSingle(),
      admin.from("staff_pins").select("id").eq("restaurant_id", tenantB.restaurantId).eq("pin_hash", pinHash).eq("active", true).maybeSingle(),
    ]);
    expect(loginA?.id).toBe(tenantA.staffPinId);
    expect(loginB?.id).toBe(tenantB.staffPinId);
    expect(loginA?.id).not.toBe(loginB?.id);
  });

  it("campaign audience counts are tenant-scoped: segmentMembers and runCampaign never cross tenant lines", async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const { joinMember } = await import("./members");
    const { CONSENT_VERSION } = await import("./consent");
    const { segmentMembers, runCampaign } = await import("./engine");
    const admin = createSupabaseAdminClient();

    // A 3rd, opted-out member per tenant — proves the audience count is both
    // tenant-scoped AND still correctly excludes opted-out within that scope.
    const [joinedA3, joinedB3] = await Promise.all([
      joinMember({ restaurantId: tenantA.restaurantId, phone: randPhone("5"), name: "Alpha Out", consentVersion: CONSENT_VERSION, source: "self_scan" }),
      joinMember({ restaurantId: tenantB.restaurantId, phone: randPhone("6"), name: "Beta Out", consentVersion: CONSENT_VERSION, source: "self_scan" }),
    ]);
    await Promise.all([
      admin.from("members").update({ opted_out: true, opted_out_ts: new Date().toISOString() }).eq("id", joinedA3.member.id),
      admin.from("members").update({ opted_out: true, opted_out_ts: new Date().toISOString() }).eq("id", joinedB3.member.id),
    ]);

    const [segmentA, segmentB] = await Promise.all([
      segmentMembers(tenantA.restaurantId, "all"),
      segmentMembers(tenantB.restaurantId, "all"),
    ]);
    const segmentAIds = new Set(segmentA.map((m) => m.id));
    const segmentBIds = new Set(segmentB.map((m) => m.id));
    // The two opted-in members from earlier tests (memberA1+A2 / memberB1+B2), no more, no less.
    expect(segmentAIds.size).toBe(2);
    expect(segmentBIds.size).toBe(2);
    expect(segmentAIds.has(joinedA3.member.id)).toBe(false); // opted out — excluded
    expect(segmentBIds.has(joinedB3.member.id)).toBe(false);
    for (const id of segmentAIds) expect(segmentBIds.has(id)).toBe(false); // no cross-tenant overlap
    for (const id of segmentBIds) expect(segmentAIds.has(id)).toBe(false);

    const campaignA = crypto.randomUUID();
    const campaignB = crypto.randomUUID();
    const { error: campaignsError } = await admin.from("campaigns").insert([
      { id: campaignA, restaurant_id: tenantA.restaurantId, audience: "all", body: "Alpha test blast", status: "scheduled" },
      { id: campaignB, restaurant_id: tenantB.restaurantId, audience: "all", body: "Beta test blast", status: "scheduled" },
    ]);
    if (campaignsError) throw campaignsError;

    const [resultA, resultB] = await Promise.all([runCampaign(campaignA), runCampaign(campaignB)]);
    expect(resultA).toEqual({ claimed: true, sentCount: 2 });
    expect(resultB).toEqual({ claimed: true, sentCount: 2 });

    const [{ data: recipientsA }, { data: recipientsB }] = await Promise.all([
      admin.from("campaign_recipients").select("member_id").eq("campaign_id", campaignA),
      admin.from("campaign_recipients").select("member_id").eq("campaign_id", campaignB),
    ]);
    const recipientAIds = new Set((recipientsA ?? []).map((r) => r.member_id as string));
    const recipientBIds = new Set((recipientsB ?? []).map((r) => r.member_id as string));
    expect(recipientAIds).toEqual(segmentAIds);
    expect(recipientBIds).toEqual(segmentBIds);
    for (const id of recipientAIds) expect(recipientBIds.has(id)).toBe(false);
  });

  it("final sweep: no table has any cross-tenant row for the members created in this file", async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();

    const [{ data: membersB }, { data: progressB }, { data: grantsB }, { data: eventsB }, { data: messagesB }, { data: consentB }] = await Promise.all([
      admin.from("members").select("id").eq("restaurant_id", tenantB.restaurantId),
      admin.from("member_progress").select("member_id").eq("restaurant_id", tenantB.restaurantId),
      admin.from("reward_grants").select("member_id").eq("restaurant_id", tenantB.restaurantId),
      admin.from("events").select("member_id").eq("restaurant_id", tenantB.restaurantId),
      admin.from("messages").select("member_id").eq("restaurant_id", tenantB.restaurantId),
      admin.from("consent_events").select("member_id").eq("restaurant_id", tenantB.restaurantId),
    ]);
    const { data: membersA } = await admin.from("members").select("id").eq("restaurant_id", tenantA.restaurantId);
    const tenantAMemberIds = new Set((membersA ?? []).map((m) => m.id as string));

    for (const table of [membersB, progressB, grantsB, eventsB, messagesB, consentB]) {
      const key = table === membersB ? "id" : "member_id";
      for (const row of table ?? []) {
        expect(tenantAMemberIds.has((row as Record<string, string>)[key])).toBe(false);
      }
    }
  });
});
