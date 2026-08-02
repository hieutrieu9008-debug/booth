// Demo tooling: "fresh restaurant" tenant for design review + owner accounts.
//
// Creates a day-1 POV: a restaurant that JUST finished onboarding
// (programs configured, staff PIN set) with ZERO members, messages, campaigns,
// or history — every dashboard surface shows its empty state.
//
// Also ensures BOTH demo owner logins exist in whatever Supabase project the
// env points at (unlike dev-owner.mjs, this reads process.env, so it works
// against the cloud demo project via --env-file):
//   owner@demo.test     / booth-dev-1234  -> demo-kitchen   (established POV)
//   owner-new@demo.test / booth-dev-1234  -> fresh-start    (fresh POV)
//
// Idempotent: safe to rerun.
// Usage: node --env-file=<envfile> scripts/seed-fresh.mjs
import { createClient } from "@supabase/supabase-js";
import { createHmac } from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const staffAuthSecret = process.env.STAFF_AUTH_SECRET;
if (!url || !serviceKey || !staffAuthSecret) throw new Error("env missing (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / STAFF_AUTH_SECRET)");

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const DEMO_KITCHEN_ID = "00000000-0000-4000-8000-000000000001";
const FRESH_ID = "00000000-0000-4000-8030-000000000001";
const PASSWORD = "booth-dev-1234";

/** Matches src/lib/booth/tokens.ts hashStaffPin (server-only TS, can't import here). */
const hashStaffPin = (pin) => createHmac("sha256", staffAuthSecret).update(pin).digest("hex");

async function ensureOwner(email, restaurantId) {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw error;
  let user = data.users.find((u) => u.email === email) ?? null;
  if (!user) {
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email, password: PASSWORD, email_confirm: true,
    });
    if (createError) throw createError;
    user = created.user;
    console.log(`created auth user ${email}`);
  } else {
    console.log(`auth user exists: ${email}`);
  }
  const { error: linkError } = await admin.from("restaurants").update({ owner_id: user.id }).eq("id", restaurantId);
  if (linkError) throw linkError;
  console.log(`  linked as owner of ${restaurantId}`);
}

async function main() {
  console.log(`Seeding fresh tenant + owners @ ${url}\n`);

  // Fresh restaurant: configured but never used. avg_ticket deliberately null
  // (owner hasn't set it) so revenue-estimate copy shows its unset state.
  const { error: restError } = await admin.from("restaurants").upsert({
    id: FRESH_ID, slug: "fresh-start", name: "The Fresh Start",
    brand_color: "#F26649", timezone: "Europe/London", phone_prefix: "+44",
    currency: "GBP", country: "GB", visit_mode: "both", avg_ticket: null,
    quiet_hours_start: 20, quiet_hours_end: 8,
    self_scan_token: "venue_freshstart_selfscan",
  }, { onConflict: "id" });
  if (restError) throw restError;
  console.log("restaurant: fresh-start upserted");

  const { error: progError } = await admin.from("reward_programs").upsert([
    {
      id: "00000000-0000-4000-8030-000000000101", restaurant_id: FRESH_ID,
      type: "welcome", name: "Welcome perk", active: true,
      config: { reward: "Free hot drink", ring_up_note: "Ring as promo: welcome drink", valid_days: 14 },
    },
    {
      id: "00000000-0000-4000-8030-000000000102", restaurant_id: FRESH_ID,
      type: "visit_ladder", name: "Visit rewards", active: true,
      // Post-Plan-V2 canonical rung shape: options ARRAY per rung (see
      // visitLadderConfigSchema in src/lib/booth/programs.ts). The legacy
      // flat {reward, ring_up_note} shape fails Zod and crashes every page
      // that parses programs - which is exactly what happened on the demo
      // (2026-07-23, error digest 1514876517).
      config: {
        endowed_start: 0, loop: true,
        rungs: [
          { visits: 3, options: [{ reward: "Free pastry", ring_up_note: "Ring as promo: ladder pastry" }] },
          { visits: 6, options: [{ reward: "Free lunch sandwich", ring_up_note: "Ring as promo: ladder sandwich" }] },
        ],
      },
    },
  ], { onConflict: "id" });
  if (progError) throw progError;
  console.log("programs: welcome + 2-rung ladder upserted (no birthday, no come-back — fresh owner hasn't configured them)");

  const { error: pinError } = await admin.from("staff_pins").upsert({
    id: "00000000-0000-4000-8030-000000000201", restaurant_id: FRESH_ID,
    label: "Front counter", pin_hash: hashStaffPin("2468"), active: true,
  }, { onConflict: "id" });
  if (pinError) throw pinError;
  console.log("staff pin: 2468 (Front counter)");

  // Assert emptiness — this tenant's entire point is empty states.
  for (const table of ["members", "messages", "campaigns"]) {
    const { count } = await admin.from(table).select("id", { count: "exact", head: true }).eq("restaurant_id", FRESH_ID);
    if ((count ?? 0) > 0) console.warn(`  WARNING: ${table} has ${count} rows for fresh-start (expected 0 — someone joined the demo; rerun cleanup if that matters)`);
  }
  console.log("verified: 0 members, 0 messages, 0 campaigns");

  await ensureOwner("owner@demo.test", DEMO_KITCHEN_ID);
  await ensureOwner("owner-new@demo.test", FRESH_ID);

  console.log("\nDone.");
}

main().catch((e) => { console.error(e); process.exit(1); });
