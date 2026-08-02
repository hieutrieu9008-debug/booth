/**
 * Integration test against the LOCAL Supabase stack — join → custom offer →
 * redeem, on this test's own throwaway restaurant (never the seeded demo
 * tenant, per the orchestrator's fence for this test). Exercises the full
 * seam: createCustomOfferAction's lazy bucket creation (getOrCreateCustomBucket),
 * the grant landing correctly in getMemberCard's wallet, and redemption
 * through fn_redeem_grant exactly like any other grant.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??=
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3215";
process.env.STAFF_AUTH_SECRET ??= "dev-staff-secret";
process.env.SMS_PROVIDER ??= "simulated";

const restaurantId = crypto.randomUUID();

vi.mock("@/lib/owner", () => ({
  requireOwnerRestaurant: vi.fn(async () => ({ id: restaurantId, slug: `custom-offer-test-${Date.now()}`, name: "Custom Offer Test Kitchen" })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let memberId: string;

describe("createCustomOfferAction — join → custom offer → redeem (own throwaway restaurant)", () => {
  beforeAll(async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    const { error: restaurantError } = await admin
      .from("restaurants")
      .insert({ id: restaurantId, slug: `custom-offer-test-${Date.now()}`, name: "Custom Offer Test Kitchen" });
    if (restaurantError) throw restaurantError;

    const { joinMember } = await import("@/lib/booth/members");
    const { CONSENT_VERSION } = await import("@/lib/booth/consent");
    const joined = await joinMember({
      restaurantId,
      phone: `+4477009${String(Math.floor(Math.random() * 90000) + 10000)}`,
      name: "Custom Offer Member",
      consentVersion: CONSENT_VERSION,
      source: "self_scan",
    });
    memberId = joined.member.id;
  });

  afterAll(async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    await createSupabaseAdminClient().from("restaurants").delete().eq("id", restaurantId);
  });

  it("creates the hidden custom bucket lazily, inactive, and grants + texts the offer", async () => {
    const { createCustomOfferAction } = await import("./actions");
    const result = await createCustomOfferAction(memberId, "Free birthday cake slice");
    expect(result).toEqual({ ok: true });

    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();

    const { data: bucket, error: bucketError } = await admin
      .from("reward_programs")
      .select("id, name, active, type")
      .eq("restaurant_id", restaurantId)
      .eq("type", "custom")
      .single();
    if (bucketError) throw bucketError;
    expect(bucket.active).toBe(false);
    expect(bucket.name).toBe("Custom offers");

    const { data: grant, error: grantError } = await admin
      .from("reward_grants")
      .select("id, reward_text, state, one_use_token, grant_slot, program_id")
      .eq("member_id", memberId)
      .eq("program_id", bucket.id)
      .single();
    if (grantError) throw grantError;
    expect(grant.reward_text).toBe("Free birthday cake slice");
    expect(grant.state).toBe("earned");
    expect(grant.grant_slot.startsWith("custom:")).toBe(true);
  });

  it("a second custom offer reuses the same bucket program (one bucket per restaurant)", async () => {
    const { createCustomOfferAction } = await import("./actions");
    const result = await createCustomOfferAction(memberId, "Free garlic bread");
    expect(result).toEqual({ ok: true });

    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    const { data: buckets, error } = await admin
      .from("reward_programs")
      .select("id")
      .eq("restaurant_id", restaurantId)
      .eq("type", "custom");
    if (error) throw error;
    expect(buckets).toHaveLength(1);
  });

  it("the custom grant shows up in the diner's wallet (getMemberCard) and redeems exactly once via fn_redeem_grant", async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    const { data: grant, error: grantError } = await admin
      .from("reward_grants")
      .select("one_use_token")
      .eq("member_id", memberId)
      .eq("reward_text", "Free garlic bread")
      .single();
    if (grantError) throw grantError;

    const { getMemberCard } = await import("@/lib/booth/members");
    const card = await getMemberCard(memberId);
    expect(card?.activeGrants.some((g) => g.reward_text === "Free garlic bread")).toBe(true);

    const valid = await admin.rpc("fn_redeem_grant", { p_token: grant.one_use_token, p_source: "lookup" });
    expect(valid.data.status).toBe("valid");
    expect(valid.data.reward_text).toBe("Free garlic bread");

    const again = await admin.rpc("fn_redeem_grant", { p_token: grant.one_use_token, p_source: "lookup" });
    expect(again.data.status).toBe("already_used");
  });

  it("rejects a memberId belonging to another restaurant (cross-tenant guard)", async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    const { data: foreignRestaurant, error: foreignError } = await admin
      .from("restaurants")
      .insert({ slug: `custom-offer-foreign-${Date.now()}`, name: "Foreign Kitchen" })
      .select("id")
      .single();
    if (foreignError) throw foreignError;
    const { data: foreignMember, error: foreignMemberError } = await admin
      .from("members")
      .insert({
        restaurant_id: foreignRestaurant!.id,
        phone: `+4477009${String(Math.floor(Math.random() * 90000) + 10000)}`,
        name: "Foreign Member",
        consent_ts: new Date().toISOString(),
        consent_version: "test-v1",
        qr_token: `mqr_custom_offer_test_${Date.now()}`,
      })
      .select("id")
      .single();
    if (foreignMemberError) throw foreignMemberError;

    const { createCustomOfferAction } = await import("./actions");
    const result = await createCustomOfferAction(foreignMember!.id, "Free dessert");
    expect(result).toEqual({ ok: false, error: "Member not found." });

    await admin.from("restaurants").delete().eq("id", foreignRestaurant!.id);
  });
});
