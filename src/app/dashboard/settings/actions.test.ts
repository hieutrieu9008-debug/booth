/**
 * Action-level test for the Settings page's write action — same
 * mocked-owner pattern as src/app/dashboard/messages/actions.test.ts.
 * Exercises the zod validation guard, not a real Supabase Auth session.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??=
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const restaurantId = crypto.randomUUID();

vi.mock("@/lib/owner", () => ({
  requireOwnerRestaurant: vi.fn(async () => ({ id: restaurantId, slug: `settings-actions-test-${Date.now()}`, name: "Settings Actions Test" })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("updateSettingsAction", () => {
  beforeAll(async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("restaurants").insert({ id: restaurantId, slug: `settings-actions-test-${Date.now()}`, name: "Settings Actions Test" });
    if (error) throw error;
  });

  afterAll(async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    await admin.from("restaurants").delete().eq("id", restaurantId);
  });

  it("rejects a non-positive expiry_reminder_days", async () => {
    const { updateSettingsAction } = await import("./actions");
    const result = await updateSettingsAction({ extendNotifyDefault: true, expiryReminderDays: 0 });
    expect(result.ok).toBe(false);
  });

  it("accepts and persists valid settings, {version:1,...} shape", async () => {
    const { updateSettingsAction } = await import("./actions");
    const result = await updateSettingsAction({ extendNotifyDefault: false, expiryReminderDays: 5 });
    expect(result).toEqual({ ok: true });

    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    const { data } = await admin.from("restaurants").select("settings").eq("id", restaurantId).single();
    expect(data?.settings).toEqual({ version: 1, extend_notify_default: false, expiry_reminder_days: 5 });
  });
});
