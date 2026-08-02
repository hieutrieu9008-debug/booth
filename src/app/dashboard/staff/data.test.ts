/**
 * Integration test against the LOCAL Supabase stack — same pattern as
 * src/app/s/[slug]/actions.test.ts. Exercises getStaffPins's per-PIN
 * activity aggregation (SPEC-WSB-F.md WS-F item 2, "F1 — Per-PIN activity")
 * over hand-inserted events rows against its own throwaway restaurant, never
 * the shared demo tenant (see comment in src/app/api/sms/inbound/route.test.ts).
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
let member1Id: string;
let member2Id: string;
let pin1Id: string;
let pin2Id: string;
let grantId: string;

describe("getStaffPins — per-PIN activity aggregation", () => {
  beforeAll(async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const { joinMember } = await import("@/lib/booth/members");
    const { CONSENT_VERSION } = await import("@/lib/booth/consent");
    const { newRewardToken } = await import("@/lib/booth/tokens");
    const admin = createSupabaseAdminClient();

    const { data: restaurant, error: restaurantError } = await admin
      .from("restaurants")
      .insert({ name: "Staff Activity Test Kitchen", slug: `staff-activity-test-${Math.floor(Math.random() * 1e9)}`, country: "GB" })
      .select("id")
      .single();
    if (restaurantError || !restaurant) throw new Error(`Local Supabase not reachable: ${restaurantError?.message}`);
    restaurantId = restaurant.id;

    // Inactive: joinMember() enrolls into every ACTIVE visit_ladder program
    // for the restaurant and validates its config via parseProgramConfig —
    // this test only needs a program row to satisfy reward_grants' program_id
    // FK, not a real ladder, so keep it inactive to skip that path entirely.
    const { data: program, error: programError } = await admin
      .from("reward_programs")
      .insert({ restaurant_id: restaurantId, type: "visit_ladder", name: "Test Ladder", active: false })
      .select("id")
      .single();
    if (programError || !program) throw new Error(`program insert failed: ${programError?.message}`);
    programId = program.id;

    const [pin1, pin2] = await Promise.all([
      admin.from("staff_pins").insert({ restaurant_id: restaurantId, label: "Pin One", pin_hash: `pin1-${Date.now()}` }).select("id").single(),
      admin.from("staff_pins").insert({ restaurant_id: restaurantId, label: "Pin Two", pin_hash: `pin2-${Date.now()}` }).select("id").single(),
    ]);
    if (pin1.error || !pin1.data) throw new Error(`pin1 insert failed: ${pin1.error?.message}`);
    if (pin2.error || !pin2.data) throw new Error(`pin2 insert failed: ${pin2.error?.message}`);
    pin1Id = pin1.data.id;
    pin2Id = pin2.data.id;

    const joined1 = await joinMember({
      restaurantId,
      phone: randPhone(),
      name: "Activity Member One",
      consentVersion: CONSENT_VERSION,
      source: "self_scan",
    });
    member1Id = joined1.member.id;
    const joined2 = await joinMember({
      restaurantId,
      phone: randPhone(),
      name: "Activity Member Two",
      consentVersion: CONSENT_VERSION,
      source: "self_scan",
    });
    member2Id = joined2.member.id;

    const { data: grant, error: grantError } = await admin
      .from("reward_grants")
      .insert({
        restaurant_id: restaurantId,
        member_id: member1Id,
        program_id: programId,
        reward_text: "Free dessert",
        one_use_token: newRewardToken(),
        grant_slot: `staff-activity-test:${Date.now()}`,
        state: "earned",
      })
      .select("id")
      .single();
    if (grantError || !grant) throw new Error(`grant insert failed: ${grantError?.message}`);
    grantId = grant.id;

    // pin1: two visits (distinct days, the unique visit-slot guard is per
    // member+day) and one redemption it performed, all attributed via
    // staff_pin_id.
    const { error: eventsError } = await admin.from("events").insert([
      { restaurant_id: restaurantId, member_id: member1Id, type: "visit", source: "staff_scan", staff_pin_id: pin1Id, visit_slot: "2026-07-10", created_at: "2026-07-10T12:00:00Z" },
      { restaurant_id: restaurantId, member_id: member1Id, type: "visit", source: "staff_scan", staff_pin_id: pin1Id, visit_slot: "2026-07-11", created_at: "2026-07-11T12:00:00Z" },
      { restaurant_id: restaurantId, member_id: member1Id, type: "redemption", source: "staff_scan", staff_pin_id: pin1Id, grant_id: grantId, created_at: "2026-07-11T13:00:00Z" },
      // pin2: one visit for member2, later voided by pin1 (the undo is a
      // different PIN than the one who recorded the original visit).
      { restaurant_id: restaurantId, member_id: member2Id, type: "visit", source: "staff_scan", staff_pin_id: pin2Id, visit_slot: "2026-07-12", created_at: "2026-07-12T09:00:00Z" },
    ]);
    if (eventsError) throw eventsError;

    const { error: voidError } = await admin
      .from("events")
      .update({ voided: true, voided_at: "2026-07-12T09:05:00Z", voided_by_staff_pin_id: pin1Id })
      .eq("restaurant_id", restaurantId)
      .eq("member_id", member2Id)
      .eq("type", "visit");
    if (voidError) throw voidError;
  });

  afterAll(async () => {
    if (!restaurantId) return;
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    await admin.from("events").delete().eq("restaurant_id", restaurantId);
    await admin.from("reward_grants").delete().eq("restaurant_id", restaurantId);
    await admin.from("member_progress").delete().eq("restaurant_id", restaurantId);
    await admin.from("members").delete().eq("restaurant_id", restaurantId);
    await admin.from("staff_pins").delete().eq("restaurant_id", restaurantId);
    await admin.from("reward_programs").delete().eq("restaurant_id", restaurantId);
    await admin.from("restaurants").delete().eq("id", restaurantId);
  });

  it("attributes visits and redemptions to the PIN that recorded them, and undos to the PIN that voided them (Codex #15: voided events excluded from visit/redemption totals)", async () => {
    const { getStaffPins } = await import("./data");
    const pins = await getStaffPins(restaurantId);

    const pin1 = pins.find((p) => p.id === pin1Id);
    const pin2 = pins.find((p) => p.id === pin2Id);
    expect(pin1).toBeTruthy();
    expect(pin2).toBeTruthy();

    // pin1: recorded 2 visits + 1 redemption, and separately performed 1 undo
    // (of pin2's visit) — undos count independently of visits/redemptions.
    expect(pin1!.activity).toMatchObject({ visits: 2, redemptions: 1, undos: 1 });
    expect(new Date(pin1!.activity.lastActiveAt!).toISOString()).toBe("2026-07-12T09:05:00.000Z");

    // pin2: recorded 1 visit, but it was later voided — "effective activity"
    // excludes it from the visits total (Codex #15), even though pin2 still
    // shows up in the aggregation (lastActiveAt still reflects the event).
    expect(pin2!.activity).toMatchObject({ visits: 0, redemptions: 0, undos: 0 });
    expect(new Date(pin2!.activity.lastActiveAt!).toISOString()).toBe("2026-07-12T09:00:00.000Z");
  });
});
