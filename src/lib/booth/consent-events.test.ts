/**
 * Integration test against the LOCAL Supabase stack — same pattern as
 * ./integration.test.ts. Exercises the Task B append-only consent event log
 * (consent_events, supabase/migrations/20260722000000_consent_events.sql)
 * and the web-join opted-out guard. Own throwaway restaurant, never the
 * shared demo tenant.
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
    .insert({ name, slug: `consent-events-test-${Math.floor(Math.random() * 1e9)}`, country: "GB", ...overrides })
    .select("id, name, country")
    .single();
  if (error || !data) throw new Error(`Local Supabase not reachable: ${error?.message}`);
  restaurantIds.push(data.id);
  return data;
}

afterAll(async () => {
  const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
  const admin = createSupabaseAdminClient();
  for (const id of memberIds) await admin.from("members").delete().eq("id", id);
  for (const id of restaurantIds) await admin.from("restaurants").delete().eq("id", id);
});

describe("consent_events: append-only log written on join + rejoin", () => {
  it("writes one row per join/rejoin, never overwrites an earlier row, wording matches consentCopyFor at that moment", async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const { joinMember } = await import("./members");
    const { CONSENT_VERSION, consentCopyFor } = await import("./consent");
    const admin = createSupabaseAdminClient();

    const restaurant = await makeRestaurant("Consent Wording Kitchen");
    const phone = randPhone();

    const first = await joinMember({
      restaurantId: restaurant.id,
      phone,
      name: "Consent Test Member",
      consentVersion: CONSENT_VERSION,
      source: "self_scan",
    });
    memberIds.push(first.member.id);

    const { data: afterJoin, error: afterJoinError } = await admin
      .from("consent_events")
      .select("*")
      .eq("member_id", first.member.id)
      .order("created_at", { ascending: true });
    if (afterJoinError) throw afterJoinError;
    expect(afterJoin).toHaveLength(1);
    expect(afterJoin![0]).toMatchObject({
      restaurant_id: restaurant.id,
      member_id: first.member.id,
      action: "join",
      consent_version: CONSENT_VERSION,
      wording: consentCopyFor("GB", "Consent Wording Kitchen"),
      source: "self_scan",
    });
    const firstRowId = afterJoin![0].id;
    const firstRowCreatedAt = afterJoin![0].created_at;

    // Repeat join (same phone, not opted out) — Codex #48 refresh path.
    const second = await joinMember({
      restaurantId: restaurant.id,
      phone,
      name: "Consent Test Member Updated",
      consentVersion: CONSENT_VERSION,
      source: "self_scan",
    });
    expect(second.repeatJoin).toBe(true);

    const { data: afterRejoin, error: afterRejoinError } = await admin
      .from("consent_events")
      .select("*")
      .eq("member_id", first.member.id)
      .order("created_at", { ascending: true });
    if (afterRejoinError) throw afterRejoinError;
    expect(afterRejoin).toHaveLength(2); // append, not overwrite
    expect(afterRejoin![0].id).toBe(firstRowId); // original row untouched
    expect(afterRejoin![0].created_at).toBe(firstRowCreatedAt);
    expect(afterRejoin![0].wording).toBe(consentCopyFor("GB", "Consent Wording Kitchen")); // still there, unchanged
    expect(afterRejoin![1]).toMatchObject({ action: "rejoin", consent_version: CONSENT_VERSION });

    // members.consent_ts IS the current-state cache and DOES advance — that's
    // unchanged, pre-existing semantics, distinct from the append-only log.
    expect(second.member.consent_ts).not.toBe(first.member.consent_ts);
  });

  it("renders TCPA wording for a US restaurant", async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const { joinMember } = await import("./members");
    const { TCPA_CONSENT_VERSION, consentCopyFor } = await import("./consent");
    const admin = createSupabaseAdminClient();

    const restaurant = await makeRestaurant("Consent Wording BBQ", { country: "US", phone_prefix: "+1", currency: "USD" });
    const joined = await joinMember({
      restaurantId: restaurant.id,
      phone: `+1334555${String(Math.floor(Math.random() * 9000) + 1000)}`,
      name: "US Consent Member",
      consentVersion: TCPA_CONSENT_VERSION,
      source: "self_scan",
    });
    memberIds.push(joined.member.id);

    const { data: row, error } = await admin
      .from("consent_events")
      .select("consent_version, wording")
      .eq("member_id", joined.member.id)
      .single();
    if (error) throw error;
    expect(row!.consent_version).toBe(TCPA_CONSENT_VERSION);
    expect(row!.wording).toBe(consentCopyFor("US", "Consent Wording BBQ"));
  });
});

describe("web-join opted-out guard (Task B)", () => {
  it("does not reactivate an opted-out member via the web-join flow, and writes no consent event for the blocked attempt", async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const { joinMember } = await import("./members");
    const { CONSENT_VERSION } = await import("./consent");
    const admin = createSupabaseAdminClient();

    const restaurant = await makeRestaurant("Opt Out Guard Kitchen");
    const phone = randPhone();

    const joined = await joinMember({
      restaurantId: restaurant.id,
      phone,
      name: "Opt Out Guard Member",
      consentVersion: CONSENT_VERSION,
      source: "self_scan",
    });
    memberIds.push(joined.member.id);

    await admin
      .from("members")
      .update({ opted_out: true, opted_out_ts: new Date().toISOString() })
      .eq("id", joined.member.id);

    const { count: countBefore } = await admin
      .from("consent_events")
      .select("id", { count: "exact", head: true })
      .eq("member_id", joined.member.id);
    expect(countBefore).toBe(1); // just the original join

    const blocked = await joinMember({
      restaurantId: restaurant.id,
      phone,
      name: "Opt Out Guard Member",
      consentVersion: CONSENT_VERSION,
      source: "self_scan",
      viaWebJoin: true,
    });

    expect(blocked.optedOutBlocked).toBe(true);
    expect(blocked.alreadyMember).toBe(true);
    expect(blocked.welcomeGrant).toBeNull();
    expect(blocked.member.opted_out).toBe(true); // returned row still opted out

    const { data: memberRow, error: memberRowError } = await admin
      .from("members")
      .select("opted_out, opted_out_ts")
      .eq("id", joined.member.id)
      .single();
    if (memberRowError) throw memberRowError;
    expect(memberRow!.opted_out).toBe(true); // not flipped in the DB either
    expect(memberRow!.opted_out_ts).not.toBeNull();

    const { count: countAfter } = await admin
      .from("consent_events")
      .select("id", { count: "exact", head: true })
      .eq("member_id", joined.member.id);
    expect(countAfter).toBe(1); // blocked attempt wrote nothing

    // The non-web path is unchanged: it's still the legacy reactivation
    // route for any caller that doesn't set viaWebJoin, and it DOES append a
    // "rejoin" consent event.
    const reactivated = await joinMember({
      restaurantId: restaurant.id,
      phone,
      name: "Opt Out Guard Member",
      consentVersion: CONSENT_VERSION,
      source: "self_scan",
    });
    expect(reactivated.optedOutBlocked).toBe(false);
    expect(reactivated.member.opted_out).toBe(false);

    const { data: afterReactivate } = await admin
      .from("consent_events")
      .select("action")
      .eq("member_id", joined.member.id)
      .order("created_at", { ascending: true });
    expect(afterReactivate).toHaveLength(2);
    expect(afterReactivate![1].action).toBe("rejoin");
  });
});

describe("consent_events is append-only at the database level", () => {
  it("rejects UPDATE and DELETE even from the service-role admin client", async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const { joinMember } = await import("./members");
    const { CONSENT_VERSION } = await import("./consent");
    const admin = createSupabaseAdminClient();

    const restaurant = await makeRestaurant("Append Only Kitchen");
    const joined = await joinMember({
      restaurantId: restaurant.id,
      phone: randPhone(),
      name: "Append Only Member",
      consentVersion: CONSENT_VERSION,
      source: "self_scan",
    });
    memberIds.push(joined.member.id);

    const { data: row } = await admin.from("consent_events").select("id").eq("member_id", joined.member.id).single();

    const updateResult = await admin.from("consent_events").update({ wording: "tampered" }).eq("id", row!.id);
    expect(updateResult.error).toBeTruthy();

    const deleteResult = await admin.from("consent_events").delete().eq("id", row!.id);
    expect(deleteResult.error).toBeTruthy();

    const { data: unchanged } = await admin.from("consent_events").select("wording").eq("id", row!.id).single();
    expect(unchanged!.wording).not.toBe("tampered");
  });
});
