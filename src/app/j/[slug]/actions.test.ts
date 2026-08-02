/**
 * Integration test against the LOCAL Supabase stack — same pattern as
 * src/lib/booth/integration.test.ts. Exercises the Task B web-join guard
 * end-to-end through the real server action (joinAction), including the
 * exact rendered blocked-message copy. Own throwaway restaurants, never the
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
    .insert({ name, slug: `join-guard-test-${Math.floor(Math.random() * 1e9)}`, country: "GB", ...overrides })
    .select("id, slug, name, sms_from, phone_prefix")
    .single();
  if (error || !data) throw new Error(`Local Supabase not reachable: ${error?.message}`);
  restaurantIds.push(data.id);
  return data;
}

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

afterAll(async () => {
  const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
  const admin = createSupabaseAdminClient();
  for (const id of memberIds) await admin.from("members").delete().eq("id", id);
  for (const id of restaurantIds) await admin.from("restaurants").delete().eq("id", id);
});

describe("joinAction: web-join guard on an opted-out number", () => {
  it("blocks with a START-to-number message when the restaurant has sms_from set, and does not flip opted_out", async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const { joinMember } = await import("@/lib/booth/members");
    const { CONSENT_VERSION } = await import("@/lib/booth/consent");
    const { joinAction } = await import("./actions");
    const admin = createSupabaseAdminClient();

    const restaurant = await makeRestaurant("Guard With Number", { sms_from: "+447700900999" });
    const phone = randPhone();
    const joined = await joinMember({
      restaurantId: restaurant.id,
      phone,
      name: "Guard Member",
      consentVersion: CONSENT_VERSION,
      source: "self_scan",
    });
    memberIds.push(joined.member.id);
    await admin.from("members").update({ opted_out: true, opted_out_ts: new Date().toISOString() }).eq("id", joined.member.id);

    const result = await joinAction(
      restaurant.slug,
      { status: "idle" },
      formData({ name: "Guard Member", phone, consent: "on" }),
    );

    expect(result.status).toBe("opted_out");
    expect(result.error).toBe("This number is opted out of texts from Guard With Number. Text START to 07700 900999 to rejoin.");
    expect(result.error).not.toContain("—"); // no em-dashes in user-facing copy

    const { data: memberRow } = await admin.from("members").select("opted_out").eq("id", joined.member.id).single();
    expect(memberRow!.opted_out).toBe(true);
  });

  it("falls back to the staff-help message when the restaurant has no sms_from yet", async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const { joinMember } = await import("@/lib/booth/members");
    const { CONSENT_VERSION } = await import("@/lib/booth/consent");
    const { joinAction } = await import("./actions");
    const admin = createSupabaseAdminClient();

    const restaurant = await makeRestaurant("Guard No Number");
    expect(restaurant.sms_from).toBeNull();
    const phone = randPhone();
    const joined = await joinMember({
      restaurantId: restaurant.id,
      phone,
      name: "Guard Member 2",
      consentVersion: CONSENT_VERSION,
      source: "self_scan",
    });
    memberIds.push(joined.member.id);
    await admin.from("members").update({ opted_out: true, opted_out_ts: new Date().toISOString() }).eq("id", joined.member.id);

    const result = await joinAction(
      restaurant.slug,
      { status: "idle" },
      formData({ name: "Guard Member 2", phone, consent: "on" }),
    );

    expect(result.status).toBe("opted_out");
    expect(result.error).toBe("This number is opted out of texts from Guard No Number. Ask a member of staff to help you rejoin.");
    expect(result.error).not.toContain("—");

    const { data: memberRow } = await admin.from("members").select("opted_out").eq("id", joined.member.id).single();
    expect(memberRow!.opted_out).toBe(true);
  });

  it("a normal (not opted-out) join still succeeds through the same action", async () => {
    const { joinAction } = await import("./actions");
    const restaurant = await makeRestaurant("Guard Control Kitchen", { sms_from: "+447700900998" });
    const phone = randPhone();

    const result = await joinAction(restaurant.slug, { status: "idle" }, formData({ name: "Fresh Member", phone, consent: "on" }));
    expect(result.status).toBe("success");

    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    const { data: memberRow } = await admin.from("members").select("id").eq("restaurant_id", restaurant.id).eq("phone", phone).single();
    if (memberRow) memberIds.push(memberRow.id);
  });
});
