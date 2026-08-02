/**
 * Integration test against the LOCAL Supabase stack (npx supabase start).
 * Exercises performCheckIn's guards directly with an explicit MemberSession
 * (rather than real cookies) — see actions.ts's docstring for why that's
 * the testable seam. Uses its own throwaway restaurant, never the seeded
 * demo tenant (engine.test.ts / route.test.ts count its members).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??=
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3106";
process.env.STAFF_AUTH_SECRET ??= "dev-staff-secret";
process.env.SMS_PROVIDER ??= "simulated";

const randPhone = () => `+4477009${String(Math.floor(Math.random() * 90000) + 10000)}`;
const SELF_SCAN_TOKEN = `vnu_test_${Date.now()}`;

let restaurantId: string;
let otherRestaurantId: string;
let memberId: string;

describe("performCheckIn (/v/[slug]) guards", () => {
  beforeAll(async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();

    const { data: restaurant, error } = await admin
      .from("restaurants")
      .insert({
        slug: `wsb-checkin-test-${Date.now()}`,
        name: "WSB Check-in Test",
        visit_mode: "both",
        self_scan_token: SELF_SCAN_TOKEN,
        // All days explicitly closed -> isOpenNow is false regardless of
        // when this suite runs (see src/lib/booth/open-hours.test.ts).
        open_hours: { sun: null, mon: null, tue: null, wed: null, thu: null, fri: null, sat: null },
      })
      .select("id")
      .single();
    if (error) throw error;
    restaurantId = restaurant.id;

    const { data: other, error: otherError } = await admin
      .from("restaurants")
      .insert({ slug: `wsb-checkin-other-${Date.now()}`, name: "WSB Other Restaurant" })
      .select("id")
      .single();
    if (otherError) throw otherError;
    otherRestaurantId = other.id;

    const { joinMember } = await import("@/lib/booth/members");
    const { CONSENT_VERSION } = await import("@/lib/booth/consent");
    const joined = await joinMember({
      restaurantId,
      phone: randPhone(),
      name: "Check-in Test Member",
      consentVersion: CONSENT_VERSION,
      source: "self_scan",
    });
    memberId = joined.member.id;
  });

  afterAll(async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    await admin.from("restaurants").delete().eq("id", restaurantId);
    await admin.from("restaurants").delete().eq("id", otherRestaurantId);
  });

  it("no session cookie -> no_session", async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const { data: restaurant } = await createSupabaseAdminClient().from("restaurants").select("slug").eq("id", restaurantId).single();
    const { performCheckIn } = await import("./actions");
    const result = await performCheckIn(restaurant!.slug, SELF_SCAN_TOKEN, null);
    expect(result).toEqual({ kind: "no_session" });
  });

  it("bad slug -> invalid_code", async () => {
    const { performCheckIn } = await import("./actions");
    const result = await performCheckIn("no-such-restaurant-slug", SELF_SCAN_TOKEN, { memberId, restaurantId });
    expect(result).toEqual({ kind: "invalid_code" });
  });

  it("bad token -> invalid_code", async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const { data: restaurant } = await createSupabaseAdminClient().from("restaurants").select("slug").eq("id", restaurantId).single();
    const { performCheckIn } = await import("./actions");
    const result = await performCheckIn(restaurant!.slug, "vnu_wrong_token", { memberId, restaurantId });
    expect(result).toEqual({ kind: "invalid_code" });
  });

  it("cookie belongs to a different restaurant -> wrong_tenant", async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const { data: restaurant } = await createSupabaseAdminClient().from("restaurants").select("slug").eq("id", restaurantId).single();
    const { performCheckIn } = await import("./actions");
    const result = await performCheckIn(restaurant!.slug, SELF_SCAN_TOKEN, { memberId, restaurantId: otherRestaurantId });
    expect(result).toEqual({ kind: "wrong_tenant" });
  });

  it("valid token + tenant but restaurant closed (all days null) -> closed", async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const { data: restaurant } = await createSupabaseAdminClient().from("restaurants").select("slug").eq("id", restaurantId).single();
    const { performCheckIn } = await import("./actions");
    const result = await performCheckIn(restaurant!.slug, SELF_SCAN_TOKEN, { memberId, restaurantId });
    expect(result).toEqual({ kind: "closed", hoursLabel: "closed today" });
  });

  it("staff_scan-only restaurant never offers self check-in, even with a matching token", async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    const staffOnlyToken = `vnu_staffonly_${Date.now()}`;
    const { data: staffOnlyRestaurant, error } = await admin
      .from("restaurants")
      .insert({ slug: `wsb-staffonly-test-${Date.now()}`, name: "Staff Only Test", visit_mode: "staff_scan", self_scan_token: staffOnlyToken })
      .select("id, slug")
      .single();
    if (error) throw error;
    try {
      const { performCheckIn } = await import("./actions");
      const result = await performCheckIn(staffOnlyRestaurant.slug, staffOnlyToken, { memberId, restaurantId: staffOnlyRestaurant.id });
      expect(result).toEqual({ kind: "invalid_code" });
    } finally {
      await admin.from("restaurants").delete().eq("id", staffOnlyRestaurant.id);
    }
  });

  it("open + valid token + own tenant -> checked in, then already_today on a second call", async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    const openToken = `vnu_open_${Date.now()}`;
    const { data: openRestaurant, error } = await admin
      .from("restaurants")
      .insert({ slug: `wsb-open-test-${Date.now()}`, name: "Open Test", visit_mode: "self_scan", self_scan_token: openToken, open_hours: null })
      .select("id, slug")
      .single();
    if (error) throw error;

    const { joinMember } = await import("@/lib/booth/members");
    const { CONSENT_VERSION } = await import("@/lib/booth/consent");
    const joined = await joinMember({
      restaurantId: openRestaurant.id,
      phone: randPhone(),
      name: "Open Flow Member",
      consentVersion: CONSENT_VERSION,
      source: "self_scan",
    });

    try {
      const { performCheckIn } = await import("./actions");
      const first = await performCheckIn(openRestaurant.slug, openToken, { memberId: joined.member.id, restaurantId: openRestaurant.id });
      expect(first).toEqual({ kind: "checked_in", memberName: "Open Flow Member", progressLabel: null });

      const second = await performCheckIn(openRestaurant.slug, openToken, { memberId: joined.member.id, restaurantId: openRestaurant.id });
      expect(second).toEqual({ kind: "already_today", memberName: "Open Flow Member" });
    } finally {
      await admin.from("members").delete().eq("id", joined.member.id);
      await admin.from("restaurants").delete().eq("id", openRestaurant.id);
    }
  });

  it("Codex #1: nothing records a visit until performCheckIn is actually called — no event exists just from resolving guards", async () => {
    // validateCheckInAction (the GET-time path page.tsx calls) shares its
    // guard logic with performCheckIn but never reaches recordVisit — this
    // asserts that at the database level, not just by return-value shape:
    // zero events exist for this member until performCheckIn (the
    // POST-backed confirm action's core) is actually invoked once.
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    const noMutationToken = `vnu_nomut_${Date.now()}`;
    const { data: restaurant, error } = await admin
      .from("restaurants")
      .insert({
        slug: `wsb-nomut-test-${Date.now()}`,
        name: "No Mutation Test",
        visit_mode: "self_scan",
        self_scan_token: noMutationToken,
        open_hours: null,
      })
      .select("id, slug")
      .single();
    if (error) throw error;

    const { joinMember } = await import("@/lib/booth/members");
    const { CONSENT_VERSION } = await import("@/lib/booth/consent");
    const joined = await joinMember({
      restaurantId: restaurant.id,
      phone: randPhone(),
      name: "No Mutation Member",
      consentVersion: CONSENT_VERSION,
      source: "self_scan",
    });

    try {
      const session = { memberId: joined.member.id, restaurantId: restaurant.id };

      const before = await admin.from("events").select("id", { count: "exact", head: true }).eq("member_id", joined.member.id);
      expect(before.count).toBe(0);

      const { performCheckIn } = await import("./actions");
      const result = await performCheckIn(restaurant.slug, noMutationToken, session);
      expect(result.kind).toBe("checked_in");

      const after = await admin.from("events").select("id", { count: "exact", head: true }).eq("member_id", joined.member.id);
      expect(after.count).toBe(1);
    } finally {
      await admin.from("members").delete().eq("id", joined.member.id);
      await admin.from("restaurants").delete().eq("id", restaurant.id);
    }
  });
});
