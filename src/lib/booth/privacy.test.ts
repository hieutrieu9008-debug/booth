/**
 * Integration test against the LOCAL Supabase stack — same pattern as
 * ./consent-events.test.ts. Exercises Task C (UK GDPR diner data rights):
 * src/lib/booth/privacy.ts (exportMemberData, eraseMember) and the
 * suppressed_phones guard wired into joinMember (supabase/migrations/
 * 20260722000001_suppressed_phones.sql). Own throwaway restaurants, never
 * the shared demo tenant.
 */
import { afterAll, describe, expect, it } from "vitest";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??=
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3005";
process.env.STAFF_AUTH_SECRET ??= "dev-staff-secret";
process.env.SMS_PROVIDER ??= "simulated";

const randPhone = () => `+4477009${String(Math.floor(Math.random() * 90000) + 10000)}`;
const restaurantIds: string[] = [];
const memberIds: string[] = [];

async function makeRestaurant(name: string, overrides: Record<string, unknown> = {}) {
  const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("restaurants")
    .insert({ name, slug: `privacy-test-${Math.floor(Math.random() * 1e9)}`, country: "GB", ...overrides })
    .select("id, name, country")
    .single();
  if (error || !data) throw new Error(`Local Supabase not reachable: ${error?.message}`);
  restaurantIds.push(data.id);
  return data;
}

/** Joins one member into `restaurantId` and seeds a row in every table exportMemberData/eraseMember touch besides members + consent_events (join already writes one consent_events row). */
async function seedFullMember(restaurantId: string, name: string, phone = randPhone()) {
  const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
  const { joinMember } = await import("./members");
  const { CONSENT_VERSION } = await import("./consent");
  const { newRewardToken } = await import("./tokens");
  const admin = createSupabaseAdminClient();

  const joined = await joinMember({ restaurantId, phone, name, consentVersion: CONSENT_VERSION, source: "self_scan" });
  const memberId = joined.member.id;
  memberIds.push(memberId);

  const { data: program, error: programError } = await admin
    .from("reward_programs")
    .insert({ restaurant_id: restaurantId, type: "visit_ladder", name: `${name} Ladder`, active: true, config: {} })
    .select("id")
    .single();
  if (programError) throw programError;

  const { error: progressError } = await admin
    .from("member_progress")
    .insert({ member_id: memberId, program_id: program!.id, restaurant_id: restaurantId, endowed_count: 0, earned_count: 1, cycle: 1 });
  if (progressError) throw progressError;

  const { error: grantError } = await admin.from("reward_grants").insert({
    restaurant_id: restaurantId,
    member_id: memberId,
    program_id: program!.id,
    reward_text: "Free coffee",
    state: "earned",
    one_use_token: newRewardToken(),
    grant_slot: "anytime:1",
  });
  if (grantError) throw grantError;

  const { error: eventError } = await admin.from("events").insert({
    restaurant_id: restaurantId,
    member_id: memberId,
    type: "visit",
    source: "self_scan",
    visit_slot: new Date().toISOString().slice(0, 10),
  });
  if (eventError) throw eventError;

  const { error: messageError } = await admin
    .from("messages")
    .insert({ restaurant_id: restaurantId, member_id: memberId, body: "Welcome!", status: "simulated" });
  if (messageError) throw messageError;

  return { memberId, phone };
}

afterAll(async () => {
  const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
  const admin = createSupabaseAdminClient();
  for (const id of memberIds) await admin.from("members").delete().eq("id", id); // no-op for already-erased members
  for (const id of restaurantIds) await admin.from("restaurants").delete().eq("id", id);
});

describe("exportMemberData: assembles all six datasets, tenant-isolated", () => {
  it("returns member + member_progress + reward_grants + events + messages + consent_events, and nothing across tenants", async () => {
    const { exportMemberData } = await import("./privacy");

    const restaurantA = await makeRestaurant("Export Kitchen A");
    const restaurantB = await makeRestaurant("Export Kitchen B");
    const { memberId: memberA } = await seedFullMember(restaurantA.id, "Export Member A");
    const { memberId: memberB } = await seedFullMember(restaurantB.id, "Export Member B");

    const exportA = await exportMemberData(restaurantA.id, memberA);
    expect(exportA).not.toBeNull();
    expect(exportA!.member.id).toBe(memberA);
    expect(exportA!.memberProgress.length).toBeGreaterThanOrEqual(1);
    expect(exportA!.rewardGrants.length).toBeGreaterThanOrEqual(1);
    expect(exportA!.events.length).toBeGreaterThanOrEqual(1);
    expect(exportA!.messages.length).toBeGreaterThanOrEqual(1);
    expect(exportA!.consentEvents.length).toBeGreaterThanOrEqual(1);

    // Every row genuinely belongs to A's member — no B rows mixed in.
    for (const row of exportA!.memberProgress) expect(row.restaurant_id).toBe(restaurantA.id);
    for (const row of exportA!.rewardGrants) expect(row.restaurant_id).toBe(restaurantA.id);
    for (const row of exportA!.events) expect(row.restaurant_id).toBe(restaurantA.id);
    for (const row of exportA!.messages) expect(row.restaurant_id).toBe(restaurantA.id);
    for (const row of exportA!.consentEvents) expect(row.restaurant_id).toBe(restaurantA.id);

    // Cross-tenant guesses are refused, both directions.
    expect(await exportMemberData(restaurantB.id, memberA)).toBeNull();
    expect(await exportMemberData(restaurantA.id, memberB)).toBeNull();

    // B's own export still works and is B's data only.
    const exportB = await exportMemberData(restaurantB.id, memberB);
    expect(exportB!.member.id).toBe(memberB);
  });
});

describe("eraseMember: deletes the member and every row tied to them", () => {
  it("removes member, member_progress, reward_grants, events, messages, consent_events, and refuses a cross-tenant id", async () => {
    const { exportMemberData, eraseMember } = await import("./privacy");
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();

    const restaurantA = await makeRestaurant("Erase Kitchen A");
    const restaurantB = await makeRestaurant("Erase Kitchen B");
    const { memberId } = await seedFullMember(restaurantA.id, "Erase Member");

    // Sanity: fully seeded before erasure.
    const before = await exportMemberData(restaurantA.id, memberId);
    expect(before!.memberProgress.length).toBeGreaterThanOrEqual(1);
    expect(before!.rewardGrants.length).toBeGreaterThanOrEqual(1);
    expect(before!.events.length).toBeGreaterThanOrEqual(1);
    expect(before!.messages.length).toBeGreaterThanOrEqual(1);
    expect(before!.consentEvents.length).toBeGreaterThanOrEqual(1);

    // Wrong tenant can't erase someone else's member.
    const wrongTenant = await eraseMember(restaurantB.id, memberId);
    expect(wrongTenant.status).toBe("not_found");
    const { data: stillThere } = await admin.from("members").select("id").eq("id", memberId).maybeSingle();
    expect(stillThere).not.toBeNull();

    const result = await eraseMember(restaurantA.id, memberId);
    expect(result).toEqual({ status: "erased", suppressedPhone: false });

    const { data: memberRow } = await admin.from("members").select("id").eq("id", memberId).maybeSingle();
    expect(memberRow).toBeNull();
    const { count: progressCount } = await admin.from("member_progress").select("member_id", { count: "exact", head: true }).eq("member_id", memberId);
    expect(progressCount).toBe(0);
    const { count: grantsCount } = await admin.from("reward_grants").select("id", { count: "exact", head: true }).eq("member_id", memberId);
    expect(grantsCount).toBe(0);
    const { count: eventsCount } = await admin.from("events").select("id", { count: "exact", head: true }).eq("member_id", memberId);
    expect(eventsCount).toBe(0);
    const { count: messagesCount } = await admin.from("messages").select("id", { count: "exact", head: true }).eq("member_id", memberId);
    expect(messagesCount).toBe(0);
    const { count: consentCount } = await admin.from("consent_events").select("id", { count: "exact", head: true }).eq("member_id", memberId);
    expect(consentCount).toBe(0);

    // Erasing again is a clean not_found, not an error.
    expect(await eraseMember(restaurantA.id, memberId)).toEqual({ status: "not_found" });
  });
});

describe("suppressed_phones: erased-while-opted-out phones are blocked from EVERY join path (review hardening: the public /j form also sends self_scan, so no source may auto-clear)", () => {
  it("suppresses on erase, refuses staff-source AND self_scan rejoins, row survives", async () => {
    const { eraseMember } = await import("./privacy");
    const { joinMember, SuppressedPhoneError } = await import("./members");
    const { CONSENT_VERSION } = await import("./consent");
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();

    const restaurant = await makeRestaurant("Suppression Kitchen");
    const phone = randPhone();
    const joined = await joinMember({ restaurantId: restaurant.id, phone, name: "Suppressed Member", consentVersion: CONSENT_VERSION, source: "self_scan" });
    memberIds.push(joined.member.id);

    await admin.from("members").update({ opted_out: true, opted_out_ts: new Date().toISOString() }).eq("id", joined.member.id);

    const erased = await eraseMember(restaurant.id, joined.member.id);
    expect(erased).toEqual({ status: "erased", suppressedPhone: true });

    const { data: suppressedRow } = await admin
      .from("suppressed_phones")
      .select("reason")
      .eq("restaurant_id", restaurant.id)
      .eq("phone", phone)
      .single();
    expect(suppressedRow!.reason).toBe("erased_while_opted_out");

    // Staff-source re-add (e.g. a POS lookup, or staff manually re-entering the number) is refused outright.
    await expect(
      joinMember({ restaurantId: restaurant.id, phone, name: "Suppressed Member", consentVersion: CONSENT_VERSION, source: "staff_scan" })
    ).rejects.toBeInstanceOf(SuppressedPhoneError);
    const { data: noStaffMember } = await admin.from("members").select("id").eq("restaurant_id", restaurant.id).eq("phone", phone).maybeSingle();
    expect(noStaffMember).toBeNull(); // refused before any insert

    // self_scan is ALSO refused: the unauthenticated /j form sends this exact
    // source, so clearing on it would let anyone who knows the number
    // re-subscribe an erased opted-out diner (confirmed exploitable in
    // review). Suppression is cleared manually only (white-glove, at the
    // diner's own verified request).
    await expect(
      joinMember({ restaurantId: restaurant.id, phone, name: "Suppressed Member", consentVersion: CONSENT_VERSION, source: "self_scan", viaWebJoin: true })
    ).rejects.toBeInstanceOf(SuppressedPhoneError);
    await expect(
      joinMember({ restaurantId: restaurant.id, phone, name: "Suppressed Member", consentVersion: CONSENT_VERSION, source: "self_scan" })
    ).rejects.toBeInstanceOf(SuppressedPhoneError);

    const { data: survivingRow } = await admin
      .from("suppressed_phones")
      .select("phone")
      .eq("restaurant_id", restaurant.id)
      .eq("phone", phone)
      .maybeSingle();
    expect(survivingRow).not.toBeNull(); // still suppressed — no join path cleared it
  });
});
