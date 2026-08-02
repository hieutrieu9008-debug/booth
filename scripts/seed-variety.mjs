// Idempotent seeder for TWO extra, deliberately-different-shaped tenants,
// layered alongside demo-kitchen (never touches it, never touches seed.sql,
// never resets the DB). Built as evidence that Phase B's multi-tenant
// platform needs ZERO per-client code: both tenants below are just rows —
// different reward_programs.config shapes, different restaurants columns —
// read by the exact same app code that serves demo-kitchen.
//
// Mirrors scripts/seed-demo.mjs's idioms: fixed deterministic uuids per
// tenant segment, `.upsert(rows, { onConflict, ignoreDuplicates: true })` (or
// the table's natural PK) so every insert-shaped write is a no-op on rerun,
// and a plain conditional UPDATE for the one state flip (a redeemed grant)
// that needs idempotent-update rather than idempotent-insert semantics.
//
//   "The Golden Fry" (golden-fry)  — chippy: short 3-rung ladder, single
//     fixed reward per rung (no choice), NO birthday program, aggressive
//     come-back blocks, GBP avg ticket set, its own brand color.
//   "Casa Verde" (casa-verde)      — tapas: long 8-rung ladder with choices
//     on several rungs, birthday MONTH mode, a custom welcome template,
//     menu_items populated, its own (wider) quiet hours.
//
// Usage: node --env-file=.env.local scripts/seed-variety.mjs
import { readFileSync } from "node:fs";
import { randomBytes, createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

function loadEnvLocal() {
  const text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  const env = {};
  for (const line of text.split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].trim();
  }
  return env;
}

const fileEnv = loadEnvLocal();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? fileEnv.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? fileEnv.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env.local");
const staffAuthSecret = process.env.STAFF_AUTH_SECRET ?? fileEnv.STAFF_AUTH_SECRET ?? serviceKey;

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const CONSENT_VERSION = "pecr-v1 2026-07"; // src/lib/booth/consent.ts's CONSENT_VERSION (GB market)
const NOW = new Date();

function daysAgo(n) {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
}
function iso(d) {
  return d.toISOString();
}
function slot(d) {
  return d.toISOString().slice(0, 10);
}
function token(prefix) {
  return `${prefix}_${randomBytes(18).toString("base64url")}`;
}
/** HMAC-SHA256(STAFF_AUTH_SECRET, pin) hex — matches src/lib/booth/tokens.ts's hashStaffPin exactly (can't import a "server-only" TS module from a plain node script). */
function hashStaffPin(pin) {
  return createHmac("sha256", staffAuthSecret).update(pin).digest("hex");
}

async function upsert(table, rows, onConflict) {
  if (rows.length === 0) return { count: 0 };
  const { error, data } = await admin
    .from(table)
    .upsert(rows, { onConflict, ignoreDuplicates: true })
    .select("*");
  if (error) throw new Error(`${table}: ${error.message}`);
  return { count: data?.length ?? 0 };
}

/** Fixed, deterministic uuids in `segment`'s namespace — block is a type tag (see each tenant config below), n fills the rest. Same block/id() idiom as seed-demo.mjs, parameterized per tenant so the two new tenants can never collide with each other or with demo-kitchen's 8000 segment. */
function idFactory(segment) {
  return (block, n = 1) => `00000000-0000-4000-${segment}-${String(block).padStart(4, "0")}${String(n).padStart(8, "0")}`;
}

// ---------------------------------------------------------------------------
// Tenant configs — pure data. seedTenant() below is the one shared code path
// that reads them; nothing here is per-client application code.
// ---------------------------------------------------------------------------

const goldenFryIds = idFactory("8010");
const GOLDEN_FRY = {
  restaurantId: goldenFryIds(0, 1),
  slug: "golden-fry",
  name: "The Golden Fry",
  brandColors: ["#C77D22", "#2B2118"],
  timezone: "Europe/London",
  phonePrefix: "+44",
  currency: "GBP",
  country: "GB",
  quietHoursStart: 20,
  quietHoursEnd: 8,
  visitMode: "staff_scan",
  avgTicket: 9, // labeled worked example — a chippy's average ticket, GBP
  goneQuietWeeks: 3, // aggressive — shorter than the platform default (4)
  selfScanToken: "vnu_golden_fry_dev_selfscan",
  memberQrToken: (n) => `mqr_goldenfry_${n}`,
  memberPhone: (n) => `+44770092${String(n).padStart(4, "0")}`,
  staffPin: { id: goldenFryIds(201, 1), label: "Front counter", pin: "4471" },
  programs: {
    welcome: {
      id: goldenFryIds(101, 1),
      config: { reward: "Free regular chips with your first order", ring_up_note: "1x regular chips, no charge", valid_days: 7 },
    },
    ladder: {
      id: goldenFryIds(102, 1),
      config: {
        endowed_start: 1,
        loop: true,
        rungs: [
          { visits: 5, options: [{ reward: "Free regular chips", ring_up_note: "1x regular chips, no charge" }] },
          { visits: 10, options: [{ reward: "Free fish supper", ring_up_note: "1x fish supper, no charge" }] },
          { visits: 15, options: [{ reward: "Free fish supper for two", ring_up_note: "2x fish supper, no charge" }] },
        ],
      },
    },
    // No birthday program for this tenant, on purpose.
    comeBack: {
      id: goldenFryIds(104, 1),
      config: {
        blocks: [
          { id: "b1", days_quiet: 3, reward: "Free regular chips when you come back", valid_days: 7 },
          { id: "b2", days_quiet: 7, reward: "Free fish supper when you come back", valid_days: 10 },
          { id: "b3", days_quiet: 14, reward: "Free fish supper for two when you come back", valid_days: 14 },
        ],
        min_days_between_contact: 5, // aggressive — shorter than demo-kitchen's 10
      },
    },
  },
  ids: goldenFryIds,
  members: [
    { n: 1, name: "Ben Carter", joinedAgo: 10, visitsAgo: [3] },
    { n: 2, name: "Chloe Hughes", joinedAgo: 20, visitsAgo: [15, 8, 2] },
    { n: 3, name: "Dean Walsh", joinedAgo: 30, visitsAgo: [25, 18, 12, 6, 1], grantRungIndexes: [0] }, // unredeemed rung0 grant
    { n: 4, name: "Ellie Shaw", joinedAgo: 25, visitsAgo: [20, 10], optedOut: true, optedOutAgo: 3 },
    {
      n: 5,
      name: "Fraser Boyd",
      joinedAgo: 45,
      visitsAgo: [40, 34, 28, 22, 17, 12, 8, 5, 2],
      grantRungIndexes: [0, 1],
      redeemRungIndex: 0, // rung0 redeemed; rung1 left unredeemed
      redeemAgo: 4,
    },
    { n: 6, name: "Grace Iqbal", joinedAgo: 15, visitsAgo: [12, 7, 3] },
    { n: 7, name: "Harris Nolan", joinedAgo: 2, visitsAgo: [0], welcomeGrant: true }, // unredeemed welcome grant, still valid (joined <7d ago)
  ],
};

const casaVerdeIds = idFactory("8020");
const CASA_VERDE = {
  restaurantId: casaVerdeIds(0, 1),
  slug: "casa-verde",
  name: "Casa Verde",
  brandColors: ["#8C1C13", "#F2E8CF"],
  timezone: "Europe/London",
  phonePrefix: "+44",
  currency: "GBP",
  country: "GB",
  quietHoursStart: 22, // wider than the platform floor and different from Golden Fry's default
  quietHoursEnd: 10,
  visitMode: "both",
  avgTicket: 24, // labeled worked example — a tapas plate-sharing average ticket, GBP
  goneQuietWeeks: 4,
  selfScanToken: "vnu_casa_verde_dev_selfscan",
  memberQrToken: (n) => `mqr_casaverde_${n}`,
  memberPhone: (n) => `+44770093${String(n).padStart(4, "0")}`,
  staffPin: { id: casaVerdeIds(201, 1), label: "Bar & floor", pin: "7823" },
  messageTemplates: {
    version: 1,
    welcome: "¡Hola from Casa Verde! Your rewards card is ready → {link}",
  },
  menuItems: [
    { name: "Patatas bravas", price: 6.5, category: "Tapas" },
    { name: "Gambas al ajillo", price: 8.5, category: "Tapas" },
    { name: "Croquetas de jamón (4pc)", price: 7, category: "Tapas" },
    { name: "Pan con tomate", price: 4.5, category: "Tapas" },
    { name: "Paella de marisco (to share)", price: 28, category: "Mains" },
    { name: "Crema catalana", price: 6, category: "Desserts" },
    { name: "House red (glass)", price: 6.5, category: "Drinks" },
  ],
  programs: {
    welcome: {
      id: casaVerdeIds(101, 1),
      config: { reward: "Free house olives with your first order", ring_up_note: "1x house olives, no charge", valid_days: 21 },
    },
    ladder: {
      id: casaVerdeIds(102, 1),
      config: {
        endowed_start: 2,
        loop: true,
        rungs: [
          { visits: 3, options: [{ reward: "Free house olives" }] },
          { visits: 6, options: [{ reward: "Free patatas bravas" }, { reward: "Free pan con tomate" }] },
          { visits: 9, options: [{ reward: "Free glass of house red" }] },
          { visits: 12, options: [{ reward: "Free croquetas (4pc)" }, { reward: "Free gambas al ajillo" }] },
          { visits: 15, options: [{ reward: "Free tapas board for two" }] },
          { visits: 18, options: [{ reward: "Free bottle of house wine" }, { reward: "Free dessert flight" }] },
          { visits: 21, options: [{ reward: "Free paella for two" }] },
          { visits: 24, options: [{ reward: "Free three-course meal for two" }, { reward: "Free chef's tasting menu for two" }] },
        ],
      },
    },
    birthday: {
      id: casaVerdeIds(103, 1),
      config: { reward: "Free birthday dessert flight", mode: "month" },
    },
    // No come_back program for this tenant, on purpose — not every tenant
    // needs every program type; the platform never assumes one does.
  },
  ids: casaVerdeIds,
  members: [
    { n: 1, name: "Isabela Ruiz", joinedAgo: 8, visitsAgo: [3], grantRungIndexes: [0] }, // unredeemed rung0 (fixed reward)
    { n: 2, name: "Marco Delgado", joinedAgo: 40, visitsAgo: [35, 25, 15, 5], grantRungIndexes: [0, 1] }, // unredeemed rung1 (a CHOICE grant)
    {
      n: 3,
      name: "Nadia Petrov",
      joinedAgo: 60,
      visitsAgo: [55, 45, 35, 25, 15, 10, 4],
      grantRungIndexes: [0, 1, 2],
      redeemRungIndex: 2,
      redeemAgo: 6,
    },
    { n: 4, name: "Omar Haddad", joinedAgo: 70, visitsAgo: [65, 55, 45, 35, 25, 15, 10, 5, 2, 1], grantRungIndexes: [0, 1, 2, 3] },
    { n: 5, name: "Priya Nair", joinedAgo: 3, visitsAgo: [], welcomeGrant: true }, // brand new, hasn't earned anything yet
    { n: 6, name: "Rosa Fernandez", joinedAgo: 45, visitsAgo: [40, 30, 20], optedOut: true, optedOutAgo: 10 },
    { n: 7, name: "Theo Marchetti", joinedAgo: 90, visitsAgo: [85, 75, 65, 55, 45, 35, 25, 15, 10, 5, 3, 1] }, // deep mid-ladder, nothing unclaimed
  ],
};

// ---------------------------------------------------------------------------
// One shared seeding path for both tenants above — zero per-client branches.
// ---------------------------------------------------------------------------

async function seedTenant(cfg) {
  console.log(`\n=== ${cfg.name} (${cfg.slug}) — restaurant ${cfg.restaurantId} ===`);
  const eventId = (n, k) => cfg.ids(1000 + n, k);
  const grantId = (n, k) => cfg.ids(700 + n, k);

  await upsert(
    "restaurants",
    [
      {
        id: cfg.restaurantId,
        slug: cfg.slug,
        name: cfg.name,
        brand_color: cfg.brandColors[0],
        brand_colors: cfg.brandColors,
        timezone: cfg.timezone,
        phone_prefix: cfg.phonePrefix,
        currency: cfg.currency,
        country: cfg.country,
        quiet_hours_start: cfg.quietHoursStart,
        quiet_hours_end: cfg.quietHoursEnd,
        visit_mode: cfg.visitMode,
        avg_ticket: cfg.avgTicket,
        gone_quiet_weeks: cfg.goneQuietWeeks,
        self_scan_token: cfg.selfScanToken,
        join_page: { magnet: "ladder", program_id: cfg.programs.ladder.id },
        menu_items: cfg.menuItems ?? null,
        message_templates: cfg.messageTemplates ?? {},
      },
    ],
    "id",
  );
  console.log(`restaurants: upserted (avg_ticket ${cfg.currency} ${cfg.avgTicket}, quiet hours ${cfg.quietHoursStart}-${cfg.quietHoursEnd})`);

  const programRows = [
    { id: cfg.programs.welcome.id, restaurant_id: cfg.restaurantId, type: "welcome", name: "Welcome perk", active: true, config: cfg.programs.welcome.config },
    { id: cfg.programs.ladder.id, restaurant_id: cfg.restaurantId, type: "visit_ladder", name: "Visit rewards", active: true, config: cfg.programs.ladder.config },
  ];
  if (cfg.programs.birthday) {
    programRows.push({ id: cfg.programs.birthday.id, restaurant_id: cfg.restaurantId, type: "birthday", name: "Birthday treat", active: true, config: cfg.programs.birthday.config });
  }
  if (cfg.programs.comeBack) {
    programRows.push({ id: cfg.programs.comeBack.id, restaurant_id: cfg.restaurantId, type: "come_back", name: "We miss you", active: true, config: cfg.programs.comeBack.config });
  }
  const programsResult = await upsert("reward_programs", programRows, "id");
  console.log(`reward_programs: inserted ${programsResult.count} (of ${programRows.length} attempted) — types: ${programRows.map((p) => p.type).join(", ")}`);

  await upsert(
    "staff_pins",
    [{ id: cfg.staffPin.id, restaurant_id: cfg.restaurantId, label: cfg.staffPin.label, pin_hash: hashStaffPin(cfg.staffPin.pin) }],
    "id",
  );
  console.log(`staff_pins: upserted (PIN ${cfg.staffPin.pin}, label "${cfg.staffPin.label}")`);

  const memberRows = cfg.members.map((m) => ({
    id: cfg.ids(500, m.n),
    restaurant_id: cfg.restaurantId,
    phone: cfg.memberPhone(m.n),
    name: m.name,
    birthday_month: (m.n % 12) + 1,
    birthday_day: ((m.n * 5) % 28) + 1,
    consent_ts: iso(daysAgo(m.joinedAgo)),
    consent_version: CONSENT_VERSION,
    opted_out: !!m.optedOut,
    opted_out_ts: m.optedOut ? iso(daysAgo(m.optedOutAgo)) : null,
    qr_token: cfg.memberQrToken(m.n),
    joined_at: iso(daysAgo(m.joinedAgo)),
  }));
  const membersResult = await upsert("members", memberRows, "id");
  console.log(`members: inserted ${membersResult.count} (of ${memberRows.length} attempted)`);

  const visitEventRows = [];
  for (const m of cfg.members) {
    let i = 0;
    for (const offset of m.visitsAgo) {
      i += 1;
      visitEventRows.push({
        id: eventId(m.n, i),
        restaurant_id: cfg.restaurantId,
        member_id: cfg.ids(500, m.n),
        type: "visit",
        source: "staff_scan",
        staff_pin_id: cfg.staffPin.id,
        visit_slot: slot(daysAgo(offset)),
        created_at: iso(daysAgo(offset)),
      });
    }
  }
  const eventsResult = await upsert("events", visitEventRows, "id");
  console.log(`events (visits): inserted ${eventsResult.count} (of ${visitEventRows.length} attempted)`);

  const progressRows = cfg.members.map((m) => ({
    member_id: cfg.ids(500, m.n),
    program_id: cfg.programs.ladder.id,
    restaurant_id: cfg.restaurantId,
    endowed_count: cfg.programs.ladder.config.endowed_start,
    earned_count: m.visitsAgo.length,
    cycle: 1,
    updated_at: iso(daysAgo(m.visitsAgo.length ? Math.min(...m.visitsAgo) : m.joinedAgo)),
  }));
  const progressResult = await upsert("member_progress", progressRows, "member_id,program_id");
  console.log(`member_progress: inserted ${progressResult.count} (of ${progressRows.length} attempted)`);

  const grantRows = [];
  const grantRefByMember = new Map();
  for (const m of cfg.members) {
    const refs = {};
    if (m.welcomeGrant) {
      const gid = grantId(m.n, 0);
      refs.welcomeId = gid;
      grantRows.push({
        id: gid,
        restaurant_id: cfg.restaurantId,
        member_id: cfg.ids(500, m.n),
        program_id: cfg.programs.welcome.id,
        reward_text: cfg.programs.welcome.config.reward,
        ring_up_note: cfg.programs.welcome.config.ring_up_note ?? null,
        state: "earned",
        one_use_token: token("rwd"),
        grant_slot: "welcome",
        expires_at: iso(daysAgo(m.joinedAgo - cfg.programs.welcome.config.valid_days)),
        earned_at: iso(daysAgo(m.joinedAgo)),
      });
    }
    for (const rungIndex of m.grantRungIndexes ?? []) {
      const rung = cfg.programs.ladder.config.rungs[rungIndex];
      const hasChoice = rung.options.length > 1;
      const gid = grantId(m.n, rungIndex + 1);
      refs[`rung${rungIndex}Id`] = gid;
      grantRows.push({
        id: gid,
        restaurant_id: cfg.restaurantId,
        member_id: cfg.ids(500, m.n),
        program_id: cfg.programs.ladder.id,
        reward_text: hasChoice ? rung.options.map((o) => o.reward).join(" or ") : rung.options[0].reward,
        ring_up_note: hasChoice ? null : (rung.options[0].ring_up_note ?? null),
        reward_options: hasChoice ? rung.options : null,
        state: "earned",
        one_use_token: token("rwd"),
        grant_slot: `ladder:${rungIndex}:1`,
        expires_at: null,
        earned_at: iso(daysAgo(m.visitsAgo[m.visitsAgo.length - 1] ?? m.joinedAgo)),
      });
    }
    grantRefByMember.set(m.n, refs);
  }
  const grantsResult = await upsert("reward_grants", grantRows, "id");
  console.log(`reward_grants: inserted ${grantsResult.count} (of ${grantRows.length} attempted)`);

  for (const m of cfg.members) {
    if (m.redeemRungIndex === undefined) continue;
    const gid = grantRefByMember.get(m.n)[`rung${m.redeemRungIndex}Id`];
    if (!gid) continue;
    const redEventId = eventId(m.n, 900); // reserved slot, distinct from any real visitsAgo index
    const at = iso(daysAgo(m.redeemAgo ?? 1));
    await upsert(
      "events",
      [
        {
          id: redEventId,
          restaurant_id: cfg.restaurantId,
          member_id: cfg.ids(500, m.n),
          type: "redemption",
          source: "staff_scan",
          staff_pin_id: cfg.staffPin.id,
          grant_id: gid,
          created_at: at,
        },
      ],
      "id",
    );
    const { error } = await admin
      .from("reward_grants")
      .update({ state: "redeemed", redeemed_at: at, redeemed_event_id: redEventId })
      .eq("id", gid)
      .eq("state", "earned"); // idempotent: only flips once
    if (error) throw new Error(`reward_grants redeem update (${cfg.slug}): ${error.message}`);
    console.log(`reward_grants: redeemed rung ${m.redeemRungIndex} for ${m.name} (idempotent update, no-op on rerun)`);
  }

  console.log(`${cfg.name}: done — ${cfg.members.length} members seeded, /j/${cfg.slug} ready`);
}

async function main() {
  console.log(`Seeding variety tenants (Golden Fry + Casa Verde) @ ${iso(NOW)}`);
  await seedTenant(GOLDEN_FRY);
  await seedTenant(CASA_VERDE);
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
