/**
 * Codex #6 — timed-offer create/edit dates must resolve against the
 * restaurant's OWN timezone, not the owner's device timezone. Integration
 * test against the LOCAL Supabase stack, own throwaway restaurant (never the
 * demo tenant). Uses a timezone far from UTC (America/Los_Angeles) so a bug
 * that fell back to UTC or a browser-local interpretation would visibly
 * shift the resolved instant.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { wallTimeToUtc } from "@/lib/booth/schedule";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??=
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3216";
process.env.SMS_PROVIDER ??= "simulated";

const TIMEZONE = "America/Los_Angeles";
const restaurantId = crypto.randomUUID();

vi.mock("@/lib/owner", () => ({
  requireOwnerRestaurant: vi.fn(async () => ({ id: restaurantId, slug: `timed-tz-test-${Date.now()}`, name: "Timed TZ Test Kitchen" })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("timed offer create/edit — restaurant-timezone date resolution", () => {
  beforeAll(async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("restaurants")
      .insert({ id: restaurantId, slug: `timed-tz-test-${Date.now()}`, name: "Timed TZ Test Kitchen", timezone: TIMEZONE });
    if (error) throw error;
  });

  afterAll(async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    await createSupabaseAdminClient().from("restaurants").delete().eq("id", restaurantId);
  });

  it("createOfferAction resolves starts/ends against the restaurant timezone, with end at 23:59 restaurant-local", async () => {
    const { createOfferAction } = await import("./actions");
    const result = await createOfferAction({
      type: "timed",
      name: "Happy hour",
      config: { reward: "Half-price starters", starts_date: "2026-08-01", ends_date: "2026-08-07" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    const { data: program, error } = await admin.from("reward_programs").select("config").eq("id", result.id).single();
    if (error) throw error;
    const config = program.config as { starts_at: string; ends_at: string };

    expect(config.starts_at).toBe(wallTimeToUtc("2026-08-01", "00:00", TIMEZONE));
    expect(config.ends_at).toBe(wallTimeToUtc("2026-08-07", "23:59", TIMEZONE));
    // Sanity: America/Los_Angeles is UTC-7 in August (PDT) — restaurant-local
    // midnight is 07:00 UTC, not midnight UTC, proving this isn't secretly
    // just parsing the date string as UTC.
    expect(config.starts_at).toBe("2026-08-01T07:00:00.000Z");
  });

  it("updateProgramConfig (edit path) resolves the same way", async () => {
    const { createOfferAction, updateProgramConfig } = await import("./actions");
    const created = await createOfferAction({
      type: "timed",
      name: "Late summer deal",
      config: { reward: "Free ice cream", starts_date: "2026-09-01", ends_date: "2026-09-10" },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const updateResult = await updateProgramConfig(created.id, {
      reward: "Free ice cream (updated)",
      starts_date: "2026-09-02",
      ends_date: "2026-09-11",
    });
    expect(updateResult).toEqual({ ok: true });

    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    const { data: program, error } = await admin.from("reward_programs").select("config").eq("id", created.id).single();
    if (error) throw error;
    const config = program.config as { starts_at: string; ends_at: string };

    expect(config.starts_at).toBe(wallTimeToUtc("2026-09-02", "00:00", TIMEZONE));
    expect(config.ends_at).toBe(wallTimeToUtc("2026-09-11", "23:59", TIMEZONE));
  });
});
