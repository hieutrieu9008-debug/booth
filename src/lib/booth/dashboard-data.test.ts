/**
 * Integration test against the LOCAL Supabase stack — same pattern as
 * integration.test.ts. Uses its own throwaway restaurant (never the demo
 * tenant, see src/app/api/sms/inbound/route.test.ts's comment on why).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??=
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3213";
process.env.SMS_PROVIDER ??= "simulated";

const randPhone = () => `+447701${String(Math.floor(Math.random() * 900000) + 100000)}`;

let restaurantId: string;
let ladderProgramId: string;
let memberCloseId: string;
let memberQuietId: string;
let memberBirthdayId: string;

describe("dashboard-data — Members (WS-C)", () => {
  beforeAll(async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();

    const { data: restaurant, error: restaurantError } = await admin
      .from("restaurants")
      .insert({ slug: `wsc-members-test-${Date.now()}`, name: "WS-C Test Kitchen", gone_quiet_weeks: 1 })
      .select("id")
      .single();
    if (restaurantError) throw restaurantError;
    restaurantId = restaurant!.id;

    const { data: program, error: programError } = await admin
      .from("reward_programs")
      .insert({
        restaurant_id: restaurantId,
        type: "visit_ladder",
        name: "Loyalty ladder",
        active: true,
        config: { endowed_start: 0, loop: false, rungs: [{ visits: 5, options: [{ reward: "Free coffee" }] }] },
      })
      .select("id")
      .single();
    if (programError) throw programError;
    ladderProgramId = program!.id;

    const { joinMember } = await import("./members");
    const { CONSENT_VERSION } = await import("./consent");

    const close = await joinMember({
      restaurantId,
      phone: randPhone(),
      name: "Close Casey",
      consentVersion: CONSENT_VERSION,
      source: "self_scan",
    });
    memberCloseId = close.member.id;
    await admin
      .from("member_progress")
      .update({ earned_count: 4 }) // visitsToGo = 5 - 4 = 1
      .eq("member_id", memberCloseId)
      .eq("program_id", ladderProgramId);

    const quiet = await joinMember({
      restaurantId,
      phone: randPhone(),
      name: "Quiet Quinn",
      consentVersion: CONSENT_VERSION,
      source: "self_scan",
    });
    memberQuietId = quiet.member.id;
    await admin
      .from("members")
      .update({ joined_at: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString() })
      .eq("id", memberQuietId);

    const currentMonth = new Date().getUTCMonth() + 1;
    const birthday = await joinMember({
      restaurantId,
      phone: randPhone(),
      name: "Birthday Bea",
      birthdayMonth: currentMonth,
      birthdayDay: 5,
      consentVersion: CONSENT_VERSION,
      source: "self_scan",
    });
    memberBirthdayId = birthday.member.id;
  });

  afterAll(async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    await createSupabaseAdminClient().from("restaurants").delete().eq("id", restaurantId);
  });

  it("close_to_reward view returns only members within 2 visits, with an exact reward-named label", async () => {
    const { searchMembers, getOwnerRestaurantFull } = await import("./dashboard-data");
    const restaurant = await getOwnerRestaurantFull(restaurantId);
    const rows = await searchMembers(restaurant, { view: "close_to_reward" });
    const ids = rows.map((r) => r.memberId);
    expect(ids).toContain(memberCloseId);
    expect(ids).not.toContain(memberQuietId);
    expect(rows.find((r) => r.memberId === memberCloseId)?.closeLabel).toBe("1 visit from Free coffee");
  });

  it("gone_quiet view returns members whose last activity predates gone_quiet_weeks", async () => {
    const { searchMembers, getOwnerRestaurantFull } = await import("./dashboard-data");
    const restaurant = await getOwnerRestaurantFull(restaurantId);
    const rows = await searchMembers(restaurant, { view: "gone_quiet" });
    const ids = rows.map((r) => r.memberId);
    expect(ids).toContain(memberQuietId);
    expect(ids).not.toContain(memberCloseId);
  });

  it("birthday_month view matches the restaurant-local current month", async () => {
    const { searchMembers, getOwnerRestaurantFull } = await import("./dashboard-data");
    const restaurant = await getOwnerRestaurantFull(restaurantId);
    const rows = await searchMembers(restaurant, { view: "birthday_month" });
    expect(rows.map((r) => r.memberId)).toContain(memberBirthdayId);
  });

  it("query does a server-side ilike name search, scoped to the restaurant", async () => {
    const { searchMembers, getOwnerRestaurantFull } = await import("./dashboard-data");
    const restaurant = await getOwnerRestaurantFull(restaurantId);
    const rows = await searchMembers(restaurant, { query: "Casey" });
    expect(rows.map((r) => r.memberId)).toEqual([memberCloseId]);
  });

  it("getMemberProfile returns null for a member belonging to a different restaurant (cross-tenant guard)", async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    const { data: otherRestaurant, error } = await admin
      .from("restaurants")
      .insert({ slug: `wsc-other-test-${Date.now()}`, name: "Other Kitchen" })
      .select("id")
      .single();
    if (error) throw error;
    try {
      const { getMemberProfile } = await import("./dashboard-data");
      const profile = await getMemberProfile(otherRestaurant!.id, memberCloseId);
      expect(profile).toBeNull();
    } finally {
      await admin.from("restaurants").delete().eq("id", otherRestaurant!.id);
    }
  });

  it("getMemberProfile returns ladder progress + profile fields for an owned member", async () => {
    const { getMemberProfile } = await import("./dashboard-data");
    const profile = await getMemberProfile(restaurantId, memberCloseId);
    expect(profile?.member.name).toBe("Close Casey");
    expect(profile?.member.consent).toBe("opted_in");
    expect(profile?.ladders[0]).toMatchObject({ programName: "Loyalty ladder", label: "4 of 5" });
  });
});
