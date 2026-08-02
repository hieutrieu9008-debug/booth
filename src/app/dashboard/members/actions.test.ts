/**
 * Integration test against the LOCAL Supabase stack — same pattern as
 * src/app/dashboard/messages/actions.test.ts. `@/lib/owner` is mocked to a
 * fixed demo owner so the cross-tenant guard inside sendMemberMessageAction
 * is exercised without needing a real Supabase Auth session.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??=
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3214";
process.env.SMS_PROVIDER ??= "simulated";

const DEMO_RESTAURANT = { id: "00000000-0000-4000-8000-000000000001", slug: "demo-kitchen", name: "Demo Kitchen" };

vi.mock("@/lib/owner", () => ({
  requireOwnerRestaurant: vi.fn(async () => DEMO_RESTAURANT),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let foreignRestaurantId: string;
let foreignMemberId: string;

describe("sendMemberMessageAction — cross-tenant guard (WS-C)", () => {
  beforeAll(async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();

    const { data: restaurant, error: restaurantError } = await admin
      .from("restaurants")
      .insert({ slug: `wsc-member-actions-test-${Date.now()}`, name: "Foreign Test Kitchen" })
      .select("id")
      .single();
    if (restaurantError) throw restaurantError;
    foreignRestaurantId = restaurant!.id;

    const { data: member, error: memberError } = await admin
      .from("members")
      .insert({
        restaurant_id: foreignRestaurantId,
        phone: `+447701${String(Math.floor(Math.random() * 900000) + 100000)}`,
        name: "Foreign Member",
        consent_ts: new Date().toISOString(),
        consent_version: "test-v1",
        qr_token: `mqr_member_actions_test_${Date.now()}`,
      })
      .select("id")
      .single();
    if (memberError) throw memberError;
    foreignMemberId = member!.id;
  });

  afterAll(async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    await createSupabaseAdminClient().from("restaurants").delete().eq("id", foreignRestaurantId);
  });

  it("rejects a memberId belonging to another restaurant", async () => {
    const { sendMemberMessageAction } = await import("./actions");
    const result = await sendMemberMessageAction(foreignMemberId, "Hello there!");
    expect(result).toEqual({ ok: false, error: "Member not found." });
  });

  it("rejects an empty/whitespace-only body before even looking up the member", async () => {
    const { sendMemberMessageAction } = await import("./actions");
    const result = await sendMemberMessageAction(foreignMemberId, "   ");
    expect(result).toEqual({ ok: false, error: "Write a message first." });
  });
});
