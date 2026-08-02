/**
 * Integration test against the LOCAL Supabase stack — same pattern as
 * src/app/c/[token]/actions.test.ts and src/app/s/[slug]/actions.test.ts.
 * createMessageAction accepted an arbitrary programId with no ownership
 * check (FIX C): a malicious/buggy client could attach ANY restaurant's
 * offer to a blast. `@/lib/owner` is mocked to a fixed demo owner so the
 * test exercises the ownership/active/type guard inside createMessageAction
 * itself, without needing a real Supabase Auth session.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??=
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3107";
process.env.SMS_PROVIDER ??= "simulated";

const DEMO_RESTAURANT = { id: "00000000-0000-4000-8000-000000000001", slug: "demo-kitchen", name: "Demo Kitchen" };

vi.mock("@/lib/owner", () => ({
  requireOwnerRestaurant: vi.fn(async () => DEMO_RESTAURANT),
}));
// createMessageAction only reaches revalidatePath on the success path (after
// the ownership guard) — outside a real Next.js request scope it throws
// ("static generation store missing"), so it's mocked for the accept case.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let foreignRestaurantId: string;
let foreignProgramId: string;
let ownActiveAnytimeProgramId: string;
let ownInactiveProgramId: string;
let ownWrongTypeProgramId: string; // welcome — not attachable per FIX C

// A future wall-clock date/time expressed as the date/time parts
// createMessageAction now expects (Codex #15 — wall time, never a
// client-computed ISO instant). +2 days keeps it unambiguously in the
// future once the server reinterprets these parts against the restaurant's
// timezone (DEMO_RESTAURANT defaults to Europe/London), regardless of the
// UTC/local offset at test-run time.
const future = new Date(Date.now() + 2 * 24 * 3600_000);
const futureDate = future.toISOString().slice(0, 10);
const futureTime = `${String(future.getUTCHours()).padStart(2, "0")}:${String(future.getUTCMinutes()).padStart(2, "0")}`;

describe("createMessageAction — cross-tenant offer attachment guard (FIX C)", () => {
  beforeAll(async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();

    const { data: restaurant, error: restaurantError } = await admin
      .from("restaurants")
      .insert({ slug: `foreign-actions-test-${Date.now()}`, name: "Foreign Test Kitchen" })
      .select("id")
      .single();
    if (restaurantError) throw restaurantError;
    foreignRestaurantId = restaurant!.id;

    const { data: foreignProgram, error: foreignProgramError } = await admin
      .from("reward_programs")
      .insert({
        restaurant_id: foreignRestaurantId,
        type: "anytime",
        name: "Foreign Anytime Offer",
        active: true,
        config: { reward: "Free something", per_member_limit: 1 },
      })
      .select("id")
      .single();
    if (foreignProgramError) throw foreignProgramError;
    foreignProgramId = foreignProgram!.id;

    const [{ data: ownActive, error: ownActiveError }, { data: ownInactive, error: ownInactiveError }, { data: ownWrongType, error: ownWrongTypeError }] =
      await Promise.all([
        admin
          .from("reward_programs")
          .insert({
            restaurant_id: DEMO_RESTAURANT.id,
            type: "anytime",
            name: "Demo Anytime Offer (actions test)",
            active: true,
            config: { reward: "Free something", per_member_limit: 1 },
          })
          .select("id")
          .single(),
        admin
          .from("reward_programs")
          .insert({
            restaurant_id: DEMO_RESTAURANT.id,
            type: "timed",
            name: "Demo Inactive Timed Offer (actions test)",
            active: false,
            config: { reward: "Free something", starts_at: new Date().toISOString(), ends_at: new Date().toISOString() },
          })
          .select("id")
          .single(),
        admin
          .from("reward_programs")
          .insert({
            restaurant_id: DEMO_RESTAURANT.id,
            type: "welcome",
            name: "Demo Welcome Perk (actions test)",
            active: true,
            config: { reward: "Free something", ring_up_note: null, valid_days: 14 },
          })
          .select("id")
          .single(),
      ]);
    if (ownActiveError) throw ownActiveError;
    if (ownInactiveError) throw ownInactiveError;
    if (ownWrongTypeError) throw ownWrongTypeError;
    ownActiveAnytimeProgramId = ownActive!.id;
    ownInactiveProgramId = ownInactive!.id;
    ownWrongTypeProgramId = ownWrongType!.id;
  });

  afterAll(async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    await admin.from("campaigns").delete().eq("program_id", ownActiveAnytimeProgramId);
    for (const id of [ownActiveAnytimeProgramId, ownInactiveProgramId, ownWrongTypeProgramId]) {
      if (id) await admin.from("reward_programs").delete().eq("id", id);
    }
    if (foreignRestaurantId) {
      await admin.from("reward_programs").delete().eq("restaurant_id", foreignRestaurantId);
      await admin.from("restaurants").delete().eq("id", foreignRestaurantId);
    }
  });

  it("rejects a foreign restaurant's programId rather than attaching it", async () => {
    const { createMessageAction } = await import("./actions");
    const result = await createMessageAction({
      audience: "all",
      audienceFilters: null,
      body: "Test message body",
      programId: foreignProgramId,
      sendNow: false,
      scheduledDate: futureDate,
      scheduledTime: futureTime,
    });
    expect(result).toEqual({ ok: false, error: "That offer can't be attached to this message." });
  });

  it("rejects an inactive program even when it belongs to the same restaurant", async () => {
    const { createMessageAction } = await import("./actions");
    const result = await createMessageAction({
      audience: "all",
      audienceFilters: null,
      body: "Test message body",
      programId: ownInactiveProgramId,
      sendNow: false,
      scheduledDate: futureDate,
      scheduledTime: futureTime,
    });
    expect(result).toEqual({ ok: false, error: "That offer can't be attached to this message." });
  });

  it("rejects a non-attachable program type (welcome) even when active and same-restaurant", async () => {
    const { createMessageAction } = await import("./actions");
    const result = await createMessageAction({
      audience: "all",
      audienceFilters: null,
      body: "Test message body",
      programId: ownWrongTypeProgramId,
      sendNow: false,
      scheduledDate: futureDate,
      scheduledTime: futureTime,
    });
    expect(result).toEqual({ ok: false, error: "That offer can't be attached to this message." });
  });

  it("accepts an active, attachable-type program belonging to the authenticated owner's restaurant", async () => {
    const { createMessageAction } = await import("./actions");
    const result = await createMessageAction({
      audience: "all",
      audienceFilters: null,
      body: "Test message body",
      programId: ownActiveAnytimeProgramId,
      sendNow: false,
      scheduledDate: futureDate,
      scheduledTime: futureTime,
    });
    expect(result).toEqual({ ok: true, sentCount: null });
  });
});
