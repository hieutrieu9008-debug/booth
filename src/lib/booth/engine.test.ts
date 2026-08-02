/**
 * Integration test against the LOCAL Supabase stack (npx supabase start).
 * Same env-setup pattern as ./integration.test.ts. Exercises engine.ts plus
 * the come-back and expire-grants cron route handlers directly (they're
 * plain GET(req) functions with no dynamic route params).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??=
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3005";
process.env.STAFF_AUTH_SECRET ??= "dev-staff-secret";
process.env.SMS_PROVIDER ??= "simulated";
process.env.CRON_SECRET ??= "test-cron-secret";

const DEMO_RESTAURANT = "00000000-0000-4000-8000-000000000001";
const COME_BACK_PROGRAM = "00000000-0000-4000-8000-000000000104";
const randPhone = () => `+4477009${String(Math.floor(Math.random() * 90000) + 10000)}`;
const cronRequest = (path: string) =>
  new Request(`http://localhost${path}`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });

let campaignMemberId: string;
let goneQuietMemberId: string;
let comeBackMemberId: string;
let campaignId: string;

describe("engine: segments, campaign fan-out, crons", () => {
  beforeAll(async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("restaurants").select("id").eq("id", DEMO_RESTAURANT).single();
    if (error) throw new Error(`Local Supabase not reachable/seeded: ${error.message}`);
  });

  afterAll(async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    if (campaignId) {
      await admin.from("campaign_recipients").delete().eq("campaign_id", campaignId);
      await admin.from("campaigns").delete().eq("id", campaignId);
    }
    for (const id of [campaignMemberId, goneQuietMemberId, comeBackMemberId]) {
      if (id) await admin.from("members").delete().eq("id", id);
    }
  });

  // 20s budget: two full fan-outs over the whole demo restaurant, against the
  // local DB while the rest of the suite runs in parallel — 5s default flakes.
  it("campaign fan-out is idempotent: recipients unique, one message per member on rerun", { timeout: 20000 }, async () => {
    const { joinMember } = await import("./members");
    const { CONSENT_VERSION } = await import("./consent");
    const { runCampaign } = await import("./engine");
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();

    const joined = await joinMember({
      restaurantId: DEMO_RESTAURANT,
      phone: randPhone(),
      name: "Campaign Test Member",
      consentVersion: CONSENT_VERSION,
      source: "self_scan",
    });
    campaignMemberId = joined.member.id;

    const { data: campaign, error } = await admin
      .from("campaigns")
      .insert({
        restaurant_id: DEMO_RESTAURANT,
        audience: "all",
        body: "Engine test campaign blast",
        status: "scheduled",
        scheduled_for: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) throw error;
    campaignId = campaign!.id;

    const first = await runCampaign(campaignId);
    expect(first.claimed).toBe(true);
    expect(first.sentCount).toBeGreaterThanOrEqual(1);

    // Simulate a resumed run (crash mid-fan-out, or the cron re-picking the
    // same due campaign up): reopen it and rerun.
    await admin.from("campaigns").update({ status: "scheduled" }).eq("id", campaignId);
    const second = await runCampaign(campaignId);
    expect(second.claimed).toBe(true);
    // NOT second.sentCount === first.sentCount: the "all" audience spans the
    // whole demo restaurant, and other suite files join members into it in
    // parallel, so the rerun may legitimately fan out to a newly joined
    // member. The race-proof idempotency property is: nobody is ever
    // messaged twice for one campaign.
    expect(second.sentCount).toBeGreaterThanOrEqual(first.sentCount);
    const { data: allMessages } = await admin
      .from("messages")
      .select("member_id")
      .eq("campaign_id", campaignId);
    const memberIds = (allMessages ?? []).map((m) => m.member_id);
    expect(new Set(memberIds).size).toBe(memberIds.length);

    const { data: recipients } = await admin
      .from("campaign_recipients")
      .select("member_id")
      .eq("campaign_id", campaignId)
      .eq("member_id", campaignMemberId);
    expect(recipients).toHaveLength(1);

    const { data: messages } = await admin
      .from("messages")
      .select("id")
      .eq("campaign_id", campaignId)
      .eq("member_id", campaignMemberId);
    expect(messages).toHaveLength(1);
  });

  it("gone_quiet segment includes a member whose only visit is 6 weeks old", async () => {
    const { joinMember } = await import("./members");
    const { CONSENT_VERSION } = await import("./consent");
    const { segmentMembers } = await import("./engine");
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();

    const joined = await joinMember({
      restaurantId: DEMO_RESTAURANT,
      phone: randPhone(),
      name: "Gone Quiet Test Member",
      consentVersion: CONSENT_VERSION,
      source: "self_scan",
    });
    goneQuietMemberId = joined.member.id;

    const sixWeeksAgo = new Date(Date.now() - 6 * 7 * 24 * 60 * 60 * 1000);
    const visitSlot = sixWeeksAgo.toISOString().slice(0, 10);
    const { error } = await admin.from("events").insert({
      restaurant_id: DEMO_RESTAURANT,
      member_id: goneQuietMemberId,
      type: "visit",
      source: "system",
      visit_slot: visitSlot,
      created_at: sixWeeksAgo.toISOString(),
    });
    if (error) throw error;

    const goneQuiet = await segmentMembers(DEMO_RESTAURANT, "gone_quiet");
    const ids = goneQuiet.map((m) => m.id);
    expect(ids).toContain(goneQuietMemberId);
    expect(ids).not.toContain(campaignMemberId); // joined seconds ago — not gone quiet
  });

  it("come-back cron respects the 10-day re-nudge guard", async () => {
    const { joinMember } = await import("./members");
    const { CONSENT_VERSION } = await import("./consent");
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();

    const joined = await joinMember({
      restaurantId: DEMO_RESTAURANT,
      phone: randPhone(),
      name: "Come Back Test Member",
      consentVersion: CONSENT_VERSION,
      source: "self_scan",
    });
    comeBackMemberId = joined.member.id;

    const sixWeeksAgo = new Date(Date.now() - 6 * 7 * 24 * 60 * 60 * 1000);
    const visitSlot = sixWeeksAgo.toISOString().slice(0, 10);
    const { error: eventError } = await admin.from("events").insert({
      restaurant_id: DEMO_RESTAURANT,
      member_id: comeBackMemberId,
      type: "visit",
      source: "system",
      visit_slot: visitSlot,
      created_at: sixWeeksAgo.toISOString(),
    });
    if (eventError) throw eventError;

    // Contacted 5 days ago — inside the 10-day guard window, so the cron
    // must skip this member even though they're gone-quiet.
    await admin.from("messages").insert({
      restaurant_id: DEMO_RESTAURANT,
      member_id: comeBackMemberId,
      kind: "marketing",
      body: "recent nudge",
      status: "sent",
      created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    });

    const { GET } = await import("@/app/api/cron/come-back/route");
    await GET(cronRequest("/api/cron/come-back"));

    const { data: blockedGrant } = await admin
      .from("reward_grants")
      .select("id")
      .eq("member_id", comeBackMemberId)
      .eq("program_id", COME_BACK_PROGRAM)
      .maybeSingle();
    expect(blockedGrant).toBeNull();

    // Clear the guard and rerun: now it should grant + send.
    await admin.from("messages").delete().eq("member_id", comeBackMemberId).eq("kind", "marketing");
    await GET(cronRequest("/api/cron/come-back"));

    const { data: grantAfter } = await admin
      .from("reward_grants")
      .select("id, state")
      .eq("member_id", comeBackMemberId)
      .eq("program_id", COME_BACK_PROGRAM)
      .maybeSingle();
    expect(grantAfter).not.toBeNull();
    expect(grantAfter?.state).toBe("earned");
  });

  it("audience filters narrow the base segment (min_visits, joined_within_days, redeemed_within_days)", async () => {
    const { joinMember } = await import("./members");
    const { CONSENT_VERSION } = await import("./consent");
    const { segmentMembers } = await import("./engine");
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();

    const freshMember = await joinMember({
      restaurantId: DEMO_RESTAURANT,
      phone: randPhone(),
      name: "Filters Fresh Member",
      consentVersion: CONSENT_VERSION,
      source: "self_scan",
    });
    const visitedMember = await joinMember({
      restaurantId: DEMO_RESTAURANT,
      phone: randPhone(),
      name: "Filters Visited Member",
      consentVersion: CONSENT_VERSION,
      source: "self_scan",
    });
    const redeemedMember = await joinMember({
      restaurantId: DEMO_RESTAURANT,
      phone: randPhone(),
      name: "Filters Redeemed Member",
      consentVersion: CONSENT_VERSION,
      source: "self_scan",
    });
    const idsToClean = [freshMember.member.id, visitedMember.member.id, redeemedMember.member.id];

    try {
      // visitedMember: 3 non-voided visits (on distinct days via distinct visit_slot).
      for (let i = 0; i < 3; i++) {
        const day = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
        const { error } = await admin.from("events").insert({
          restaurant_id: DEMO_RESTAURANT,
          member_id: visitedMember.member.id,
          type: "visit",
          source: "system",
          visit_slot: day.toISOString().slice(0, 10),
          created_at: day.toISOString(),
        });
        if (error) throw error;
      }

      // redeemedMember: one redeemed grant 3 days ago.
      const { error: grantError } = await admin.from("reward_grants").insert({
        restaurant_id: DEMO_RESTAURANT,
        member_id: redeemedMember.member.id,
        program_id: COME_BACK_PROGRAM,
        reward_text: "Filters test reward",
        one_use_token: `rwd_test_filters_${Date.now()}`,
        grant_slot: `filters-test:${Date.now()}`,
        state: "redeemed",
        redeemed_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      });
      if (grantError) throw grantError;

      const minVisits = await segmentMembers(DEMO_RESTAURANT, "all", { min_visits: 3 });
      const minVisitsIds = minVisits.map((m) => m.id);
      expect(minVisitsIds).toContain(visitedMember.member.id);
      expect(minVisitsIds).not.toContain(freshMember.member.id);
      expect(minVisitsIds).not.toContain(redeemedMember.member.id);

      const joinedWithin = await segmentMembers(DEMO_RESTAURANT, "all", { joined_within_days: 1 });
      const joinedWithinIds = joinedWithin.map((m) => m.id);
      expect(joinedWithinIds).toContain(freshMember.member.id);

      const redeemedWithin = await segmentMembers(DEMO_RESTAURANT, "all", { redeemed_within_days: 7 });
      const redeemedWithinIds = redeemedWithin.map((m) => m.id);
      expect(redeemedWithinIds).toContain(redeemedMember.member.id);
      expect(redeemedWithinIds).not.toContain(visitedMember.member.id);

      // Filters AND together: a member matching only one of two filters is excluded.
      const combined = await segmentMembers(DEMO_RESTAURANT, "all", { min_visits: 3, redeemed_within_days: 7 });
      expect(combined.map((m) => m.id)).not.toContain(visitedMember.member.id);
      expect(combined.map((m) => m.id)).not.toContain(redeemedMember.member.id);
    } finally {
      await admin.from("reward_grants").delete().eq("member_id", redeemedMember.member.id);
      await admin.from("events").delete().in("member_id", [visitedMember.member.id]);
      for (const id of idsToClean) await admin.from("members").delete().eq("id", id);
    }
  });

  it("near_reward filter matches members within 2 visits of their next unearned ladder rung", async () => {
    const { joinMember } = await import("./members");
    const { CONSENT_VERSION } = await import("./consent");
    const { segmentMembers } = await import("./engine");
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    const LADDER_PROGRAM = "00000000-0000-4000-8000-000000000102"; // demo seed: rungs at 6 and 10, endowed_start 2

    const nearMember = await joinMember({
      restaurantId: DEMO_RESTAURANT,
      phone: randPhone(),
      name: "Near Reward Member",
      consentVersion: CONSENT_VERSION,
      source: "self_scan",
    });
    const farMember = await joinMember({
      restaurantId: DEMO_RESTAURANT,
      phone: randPhone(),
      name: "Far From Reward Member",
      consentVersion: CONSENT_VERSION,
      source: "self_scan",
    });

    try {
      // nearMember: endowed 2 + earned 3 = 5 total, next rung at 6 -> 1 visit away.
      await admin
        .from("member_progress")
        .update({ earned_count: 3 })
        .eq("member_id", nearMember.member.id)
        .eq("program_id", LADDER_PROGRAM);
      // farMember: endowed 2 + earned 0 = 2 total, next rung at 6 -> 4 visits away.
      // (member_progress row is auto-created at join with earned_count 0 — no update needed.)

      const near = await segmentMembers(DEMO_RESTAURANT, "all", { near_reward: true });
      const nearIds = near.map((m) => m.id);
      expect(nearIds).toContain(nearMember.member.id);
      expect(nearIds).not.toContain(farMember.member.id);
    } finally {
      for (const id of [nearMember.member.id, farMember.member.id]) {
        await admin.from("members").delete().eq("id", id);
      }
    }
  });

  it("come-back cron honors the program's configured min_days_between_contact, including 0 = off", async () => {
    const { joinMember } = await import("./members");
    const { CONSENT_VERSION } = await import("./consent");
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();

    const joined = await joinMember({
      restaurantId: DEMO_RESTAURANT,
      phone: randPhone(),
      name: "Custom Window Test Member",
      consentVersion: CONSENT_VERSION,
      source: "self_scan",
    });
    const memberId = joined.member.id;
    // Hoisted so the finally-block restore can see it even if an assertion throws.
    let originalConfig: unknown = null;

    try {
      const sixWeeksAgo = new Date(Date.now() - 6 * 7 * 24 * 60 * 60 * 1000);
      const { error: eventError } = await admin.from("events").insert({
        restaurant_id: DEMO_RESTAURANT,
        member_id: memberId,
        type: "visit",
        source: "system",
        visit_slot: sixWeeksAgo.toISOString().slice(0, 10),
        created_at: sixWeeksAgo.toISOString(),
      });
      if (eventError) throw eventError;

      // Contacted 25 days ago — inside a widened 30-day window, so the cron
      // must skip this member once the program's window is raised to 30.
      await admin.from("messages").insert({
        restaurant_id: DEMO_RESTAURANT,
        member_id: memberId,
        kind: "marketing",
        body: "recent nudge",
        status: "sent",
        created_at: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString(),
      });

      const { data: originalProgram } = await admin
        .from("reward_programs")
        .select("config")
        .eq("id", COME_BACK_PROGRAM)
        .single();
      originalConfig = originalProgram!.config;

      await admin
        .from("reward_programs")
        .update({ config: { ...originalProgram!.config, min_days_between_contact: 30 } })
        .eq("id", COME_BACK_PROGRAM);

      const { GET } = await import("@/app/api/cron/come-back/route");
      await GET(cronRequest("/api/cron/come-back"));

      const { data: blockedGrant } = await admin
        .from("reward_grants")
        .select("id")
        .eq("member_id", memberId)
        .eq("program_id", COME_BACK_PROGRAM)
        .maybeSingle();
      expect(blockedGrant).toBeNull();

      // Set the window to 0 (off) — the guard never blocks, so the cron grants + sends
      // even though the member was contacted 25 days ago.
      await admin
        .from("reward_programs")
        .update({ config: { ...originalProgram!.config, min_days_between_contact: 0 } })
        .eq("id", COME_BACK_PROGRAM);

      await GET(cronRequest("/api/cron/come-back"));

      const { data: grantAfter } = await admin
        .from("reward_grants")
        .select("id, state")
        .eq("member_id", memberId)
        .eq("program_id", COME_BACK_PROGRAM)
        .maybeSingle();
      expect(grantAfter).not.toBeNull();
      expect(grantAfter?.state).toBe("earned");

    } finally {
      // Config restore lives in finally: when it sat inside the try, one
      // failed assertion left min_days_between_contact poisoned in the shared
      // demo tenant and every later suite run failed deterministically.
      if (originalConfig) await admin.from("reward_programs").update({ config: originalConfig }).eq("id", COME_BACK_PROGRAM);
      await admin.from("reward_grants").delete().eq("member_id", memberId).eq("program_id", COME_BACK_PROGRAM);
      await admin.from("messages").delete().eq("member_id", memberId);
      await admin.from("events").delete().eq("member_id", memberId);
      await admin.from("members").delete().eq("id", memberId);
    }
  });

  it("expire-grants sweep flips earned+past-expiry grants to expired", async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();

    const { data: grant, error } = await admin
      .from("reward_grants")
      .insert({
        restaurant_id: DEMO_RESTAURANT,
        member_id: comeBackMemberId,
        program_id: COME_BACK_PROGRAM,
        reward_text: "Expiry sweep test reward",
        one_use_token: `rwd_test_expiry_${Date.now()}`,
        grant_slot: `expiry-test:${Date.now()}`,
        expires_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      })
      .select("id")
      .single();
    if (error) throw error;

    const { GET } = await import("@/app/api/cron/expire-grants/route");
    await GET(cronRequest("/api/cron/expire-grants"));

    const { data: after } = await admin.from("reward_grants").select("state").eq("id", grant!.id).single();
    expect(after?.state).toBe("expired");
  });

  it("come-back cron fires only the deepest matured block (b1:7d, b2:14d, b3:60d demo blocks)", async () => {
    const { joinMember } = await import("./members");
    const { CONSENT_VERSION } = await import("./consent");
    const { localYMD } = await import("./engine");
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();

    const joined = await joinMember({
      restaurantId: DEMO_RESTAURANT,
      phone: randPhone(),
      name: "Deepest Block Member",
      consentVersion: CONSENT_VERSION,
      source: "self_scan",
    });
    const memberId = joined.member.id;

    try {
      // 20 days quiet: matures b1 (7d) and b2 (14d), not b3 (60d) -> deepest = b2.
      const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
      await admin.from("events").insert({
        restaurant_id: DEMO_RESTAURANT,
        member_id: memberId,
        type: "visit",
        source: "system",
        visit_slot: twentyDaysAgo.toISOString().slice(0, 10),
        created_at: twentyDaysAgo.toISOString(),
      });

      const { GET } = await import("@/app/api/cron/come-back/route");
      await GET(cronRequest("/api/cron/come-back"));

      const { data: grants } = await admin
        .from("reward_grants")
        .select("grant_slot, reward_text")
        .eq("member_id", memberId)
        .eq("program_id", COME_BACK_PROGRAM);
      expect(grants).toHaveLength(1);
      const { year, month } = localYMD("Europe/London");
      const localMonth = `${year}-${String(month).padStart(2, "0")}`;
      expect(grants![0].grant_slot).toBe(`come_back:b2:${localMonth}`);
      expect(grants![0].reward_text).toBe("Free main when you come back");

      // Month cap: re-running the cron the same restaurant-local month must not add another grant.
      await GET(cronRequest("/api/cron/come-back"));
      const { data: grantsAfterRerun } = await admin
        .from("reward_grants")
        .select("id")
        .eq("member_id", memberId)
        .eq("program_id", COME_BACK_PROGRAM);
      expect(grantsAfterRerun).toHaveLength(1);
    } finally {
      await admin.from("reward_grants").delete().eq("member_id", memberId);
      await admin.from("events").delete().eq("member_id", memberId);
      await admin.from("members").delete().eq("id", memberId);
    }
  });

  it("come-back guard counts queued/sent/delivered/simulated as contact but not failed/suppressed", async () => {
    const { joinMember } = await import("./members");
    const { CONSENT_VERSION } = await import("./consent");
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();

    const joined = await joinMember({
      restaurantId: DEMO_RESTAURANT,
      phone: randPhone(),
      name: "Guard Status Member",
      consentVersion: CONSENT_VERSION,
      source: "self_scan",
    });
    const memberId = joined.member.id;

    try {
      const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
      await admin.from("events").insert({
        restaurant_id: DEMO_RESTAURANT,
        member_id: memberId,
        type: "visit",
        source: "system",
        visit_slot: twentyDaysAgo.toISOString().slice(0, 10),
        created_at: twentyDaysAgo.toISOString(),
      });

      // failed + suppressed 2 days ago must NOT count as contact.
      await admin.from("messages").insert([
        {
          restaurant_id: DEMO_RESTAURANT, member_id: memberId, kind: "marketing", body: "failed nudge",
          status: "failed", created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        },
        {
          restaurant_id: DEMO_RESTAURANT, member_id: memberId, kind: "marketing", body: "suppressed nudge",
          status: "suppressed", created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        },
      ]);

      const { GET } = await import("@/app/api/cron/come-back/route");
      await GET(cronRequest("/api/cron/come-back"));

      const { data: grantAfterFailed } = await admin
        .from("reward_grants")
        .select("id")
        .eq("member_id", memberId)
        .eq("program_id", COME_BACK_PROGRAM)
        .maybeSingle();
      expect(grantAfterFailed).not.toBeNull(); // failed/suppressed didn't block

      await admin.from("reward_grants").delete().eq("member_id", memberId);

      // A queued message 2 days ago DOES count as contact -> the cron must skip.
      await admin.from("messages").insert({
        restaurant_id: DEMO_RESTAURANT, member_id: memberId, kind: "marketing", body: "queued nudge",
        status: "queued", created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      });
      await GET(cronRequest("/api/cron/come-back"));
      const { data: grantAfterQueued } = await admin
        .from("reward_grants")
        .select("id")
        .eq("member_id", memberId)
        .eq("program_id", COME_BACK_PROGRAM)
        .maybeSingle();
      expect(grantAfterQueued).toBeNull();
    } finally {
      await admin.from("reward_grants").delete().eq("member_id", memberId);
      await admin.from("messages").delete().eq("member_id", memberId);
      await admin.from("events").delete().eq("member_id", memberId);
      await admin.from("members").delete().eq("id", memberId);
    }
  });
});

describe("runCampaign: retry recovers a recipient whose earlier send never completed (Codex #9)", () => {
  let restaurantId: string;
  let memberId: string;
  let retryCampaignId: string;

  beforeAll(async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const { joinMember } = await import("./members");
    const { CONSENT_VERSION } = await import("./consent");
    const admin = createSupabaseAdminClient();

    const { data: restaurant, error: restaurantError } = await admin
      .from("restaurants")
      .insert({ slug: `engine-retry-test-${Date.now()}`, name: "Engine Retry Test Kitchen", country: "GB" })
      .select("id")
      .single();
    if (restaurantError || !restaurant) throw new Error(`Local Supabase not reachable: ${restaurantError?.message}`);
    restaurantId = restaurant.id;

    const joined = await joinMember({
      restaurantId,
      phone: randPhone(),
      name: "Retry Test Member",
      consentVersion: CONSENT_VERSION,
      source: "self_scan",
    });
    memberId = joined.member.id;

    const { data: campaign, error: campaignError } = await admin
      .from("campaigns")
      .insert({
        restaurant_id: restaurantId,
        audience: "all",
        body: "Retry test campaign",
        status: "scheduled",
        scheduled_for: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (campaignError || !campaign) throw campaignError;
    retryCampaignId = campaign.id;

    // Simulate a prior run that inserted this member's recipient row (the
    // claim) and then crashed/threw before the message_id write landed — the
    // row exists, but message_id is still null. This is exactly the state
    // the old code mistook for "already fanned out" and permanently skipped.
    const { error: recipientError } = await admin
      .from("campaign_recipients")
      .insert({ campaign_id: retryCampaignId, member_id: memberId });
    if (recipientError) throw recipientError;
  });

  afterAll(async () => {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    if (retryCampaignId) {
      await admin.from("campaign_recipients").delete().eq("campaign_id", retryCampaignId);
      await admin.from("campaigns").delete().eq("id", retryCampaignId);
    }
    if (memberId) await admin.from("members").delete().eq("id", memberId);
    if (restaurantId) await admin.from("restaurants").delete().eq("id", restaurantId);
  });

  it("retries and delivers to the recipient whose row exists but has no message_id", async () => {
    const { runCampaign } = await import("./engine");
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();

    const result = await runCampaign(retryCampaignId);
    expect(result.claimed).toBe(true);
    expect(result.sentCount).toBe(1);

    const { data: recipient } = await admin
      .from("campaign_recipients")
      .select("message_id")
      .eq("campaign_id", retryCampaignId)
      .eq("member_id", memberId)
      .single();
    expect(recipient?.message_id).not.toBeNull();

    const { data: messages } = await admin
      .from("messages")
      .select("id")
      .eq("campaign_id", retryCampaignId)
      .eq("member_id", memberId);
    expect(messages).toHaveLength(1);
  });

  it("a second run does not re-send to the same recipient now that message_id is set", async () => {
    const { runCampaign } = await import("./engine");
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();

    await admin.from("campaigns").update({ status: "scheduled" }).eq("id", retryCampaignId);
    await runCampaign(retryCampaignId);

    const { data: messages } = await admin
      .from("messages")
      .select("id")
      .eq("campaign_id", retryCampaignId)
      .eq("member_id", memberId);
    expect(messages).toHaveLength(1); // still exactly one — not re-sent
  });
});

describe("birthday: mode-aware expiry + month-mode join grant", () => {
  it("birthdayGrantParams: window mode is a rolling now+window_days expiry", async () => {
    const { birthdayGrantParams } = await import("./engine");
    const now = new Date("2026-07-17T12:00:00.000Z");
    const { expiresAt } = birthdayGrantParams({ reward: "A", mode: "window", window_days: 14 }, "Europe/London", now);
    expect(expiresAt).toBe(new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString());
  });

  it("birthdayGrantParams: month mode expires at the first instant of the following local month", async () => {
    const { birthdayGrantParams } = await import("./engine");
    const now = new Date("2026-07-17T12:00:00.000Z");
    const { expiresAt } = birthdayGrantParams({ reward: "A", mode: "month" }, "Europe/London", now);
    expect(expiresAt).toBe(new Date(Date.UTC(2026, 7, 1)).toISOString()); // Aug 1

    const decemberNow = new Date("2026-12-17T12:00:00.000Z");
    const decemberResult = birthdayGrantParams({ reward: "A", mode: "month" }, "Europe/London", decemberNow);
    expect(decemberResult.expiresAt).toBe(new Date(Date.UTC(2027, 0, 1)).toISOString()); // rolls into next year
  });

  it("joinMember materializes a month-mode birthday grant immediately when the joiner's birthday_month matches today", async () => {
    const { joinMember } = await import("./members");
    const { CONSENT_VERSION } = await import("./consent");
    const { localYMD } = await import("./engine");
    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    const BIRTHDAY_PROGRAM = "00000000-0000-4000-8000-000000000103"; // demo seed: mode "month" after seed-demo.mjs

    const today = localYMD("Europe/London");
    const joined = await joinMember({
      restaurantId: DEMO_RESTAURANT,
      phone: randPhone(),
      name: "Birthday Join Member",
      birthdayMonth: today.month,
      birthdayDay: 1,
      consentVersion: CONSENT_VERSION,
      source: "self_scan",
    });

    try {
      const { data: grant } = await admin
        .from("reward_grants")
        .select("grant_slot, expires_at")
        .eq("member_id", joined.member.id)
        .eq("program_id", BIRTHDAY_PROGRAM)
        .maybeSingle();
      expect(grant).not.toBeNull();
      expect(grant?.grant_slot).toBe(`birthday:${today.year}`);
    } finally {
      await admin.from("reward_grants").delete().eq("member_id", joined.member.id);
      await admin.from("members").delete().eq("id", joined.member.id);
    }
  });
});
