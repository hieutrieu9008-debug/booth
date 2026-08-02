/**
 * Integration test against the LOCAL Supabase stack — same pattern as
 * src/lib/booth/integration.test.ts. Uses its own throwaway restaurant
 * (never the demo/seeded tenant — engine.test.ts races against it, see the
 * comment in src/app/api/sms/inbound/route.test.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??=
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3212";
process.env.SMS_PROVIDER ??= "simulated";

let restaurantId: string;
let memberId: string;
let anytimeProgramId: string;

describe("getOffersHomeData (WS-C offers home)", () => {
  beforeAll(async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();

    const { data: restaurant, error: restaurantError } = await admin
      .from("restaurants")
      .insert({ slug: `wsc-offers-test-${Date.now()}`, name: "WS-C Offers Test Kitchen" })
      .select("id")
      .single();
    if (restaurantError) throw restaurantError;
    restaurantId = restaurant!.id;

    const { data: program, error: programError } = await admin
      .from("reward_programs")
      .insert({
        restaurant_id: restaurantId,
        type: "anytime",
        name: "Free tea",
        active: true,
        config: { reward: "Free tea", per_member_limit: 1 },
      })
      .select("id")
      .single();
    if (programError) throw programError;
    anytimeProgramId = program!.id;

    const { data: member, error: memberError } = await admin
      .from("members")
      .insert({
        restaurant_id: restaurantId,
        phone: `+447700${String(Math.floor(Math.random() * 900000) + 100000)}`,
        name: "Offers Test Member",
        consent_ts: new Date().toISOString(),
        consent_version: "test-v1",
        qr_token: `mqr_offers_test_${Date.now()}`,
      })
      .select("id")
      .single();
    if (memberError) throw memberError;
    memberId = member!.id;

    // Grant 1: still outstanding (issued + active).
    const { error: grant1Error } = await admin.from("reward_grants").insert({
      restaurant_id: restaurantId,
      member_id: memberId,
      program_id: anytimeProgramId,
      reward_text: "Free tea",
      one_use_token: `rwd_offers_test_1_${Date.now()}`,
      grant_slot: "offers-test:1",
      state: "earned",
    });
    if (grant1Error) throw grant1Error;

    // Grant 2: redeemed, with a redemption event that caused an attributed visit.
    const { data: grant2, error: grant2Error } = await admin
      .from("reward_grants")
      .insert({
        restaurant_id: restaurantId,
        member_id: memberId,
        program_id: anytimeProgramId,
        reward_text: "Free tea",
        one_use_token: `rwd_offers_test_2_${Date.now()}`,
        grant_slot: "offers-test:2",
        state: "earned", // flipped to redeemed below, alongside redeemed_at/redeemed_event_id (grants_redeemed_coherent)
      })
      .select("id")
      .single();
    if (grant2Error) throw grant2Error;

    const { data: redemptionEvent, error: redemptionEventError } = await admin
      .from("events")
      .insert({
        restaurant_id: restaurantId,
        member_id: memberId,
        type: "redemption",
        source: "lookup",
        grant_id: grant2!.id,
      })
      .select("id")
      .single();
    if (redemptionEventError) throw redemptionEventError;

    const { error: visitEventError } = await admin.from("events").insert({
      restaurant_id: restaurantId,
      member_id: memberId,
      type: "visit",
      source: "lookup",
      visit_slot: "2026-07-18",
      related_event_id: redemptionEvent!.id,
    });
    if (visitEventError) throw visitEventError;

    const { error: updateGrant2Error } = await admin
      .from("reward_grants")
      .update({ state: "redeemed", redeemed_event_id: redemptionEvent!.id, redeemed_at: new Date().toISOString() })
      .eq("id", grant2!.id);
    if (updateGrant2Error) throw updateGrant2Error;
  });

  afterAll(async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    await createSupabaseAdminClient().from("restaurants").delete().eq("id", restaurantId);
  });

  it("computes issued/active/redeemed/redemption-rate/attributed-visits for an anytime offer", async () => {
    const { getOffersHomeData } = await import("./data");
    const stats = await getOffersHomeData(restaurantId);
    const stat = stats.find((s) => s.program.id === anytimeProgramId);
    expect(stat).toMatchObject({
      issued: 2,
      active: 1,
      redeemed: 1,
      redemptionRate: 50,
      attributedVisits: 1,
    });
  });

  it("returns null redemptionRate (never divide-by-zero) for an offer with no issued grants", async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    const { data: unissuedProgram, error } = await admin
      .from("reward_programs")
      .insert({
        restaurant_id: restaurantId,
        type: "timed",
        name: "Unissued Timed Offer",
        active: true,
        config: {
          reward: "Free dessert",
          starts_at: new Date().toISOString(),
          ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        },
      })
      .select("id")
      .single();
    if (error) throw error;

    const { getOffersHomeData } = await import("./data");
    const stats = await getOffersHomeData(restaurantId);
    const stat = stats.find((s) => s.program.id === unissuedProgram!.id);
    expect(stat).toMatchObject({ issued: 0, active: 0, redeemed: 0, redemptionRate: null, attributedVisits: 0 });
  });
});
