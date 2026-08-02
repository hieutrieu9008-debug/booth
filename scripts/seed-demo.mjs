// Idempotent rich demo-data seeder for demo-kitchen (restaurant
// 00000000-0000-4000-8000-000000000001), built for a manual
// click-through of the local dashboard. Safe to rerun any number of times:
// every row uses a FIXED uuid and is written with
// `.upsert(rows, { onConflict: "id", ignoreDuplicates: true })` (or the
// table's natural PK for member_progress/campaign_recipients), so a rerun
// inserts nothing new.
//
// Never touches supabase/seed.sql, never resets the DB. Layers on top of the
// two members (Priya/Tom, phones +447700900001/2) that seed.sql already
// creates for demo-kitchen.
//
// Usage: node --env-file=.env.local scripts/seed-demo.mjs
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
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

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const RESTAURANT_ID = "00000000-0000-4000-8000-000000000001";
const PROGRAM_WELCOME = "00000000-0000-4000-8000-000000000101";
const PROGRAM_LADDER = "00000000-0000-4000-8000-000000000102";
const PROGRAM_BIRTHDAY = "00000000-0000-4000-8000-000000000103";
const PROGRAM_COME_BACK = "00000000-0000-4000-8000-000000000104";
const STAFF_PIN_ID = "00000000-0000-4000-8000-000000000201";

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
function id(block, n) {
  // Fixed, deterministic uuid in the demo-kitchen namespace — block is a
  // 4-digit range tag (members=05xx, grants=07xx, events=1xxx,
  // campaigns=19xx, messages=2xxx), n is padded to fill the rest.
  return `00000000-0000-4000-8000-${String(block).padStart(4, "0")}${String(n).padStart(8, "0")}`;
}
function token(prefix) {
  return `${prefix}_${randomBytes(18).toString("base64url")}`;
}

// ---------------------------------------------------------------------------
// Member roster (22 members). Categories:
//   L  low engagement (1-2 visits)      -> M1-M4  (M4 opted out)
//   R  regular (4-8 visits)             -> M5-M14
//   Q  gone quiet (last visit 5-7wk ago)-> M15-M17
//   C  rescued (quiet then back this mo)-> M18-M19
//   F  filler                           -> M20-M22
// visitsAgo: day-offsets from NOW (each list must have distinct values).
// ---------------------------------------------------------------------------
const MEMBERS = [
  { n: 1, name: "Amelia Clarke", joinedAgo: 50, visitsAgo: [10] },
  { n: 2, name: "Oliver Bennett", joinedAgo: 45, visitsAgo: [30, 5] },
  { n: 3, name: "Isla Robinson", joinedAgo: 3, visitsAgo: [0], welcomeGrant: true }, // welcome grant still valid (joined <14d ago)
  { n: 4, name: "George Mitchell", joinedAgo: 40, visitsAgo: [20], optedOut: true, optedOutAgo: 5 },

  { n: 5, name: "Sophie Turner", joinedAgo: 55, visitsAgo: [40, 25, 10, 2] },
  { n: 6, name: "Jack Wilson", joinedAgo: 50, visitsAgo: [45, 35, 20, 8, 1], redeemAgo: 3 },
  { n: 7, name: "Freya Campbell", joinedAgo: 53, visitsAgo: [48, 38, 25, 15, 6, 0], redeemAgo: 0 },
  { n: 8, name: "Harry Davies", joinedAgo: 40, visitsAgo: [35, 28, 20, 12, 4, 0], redeemAgo: 0 },
  { n: 9, name: "Grace Edwards", joinedAgo: 56, visitsAgo: [50, 42, 33, 24, 16, 9, 3], redeemAgo: 10 },
  { n: 10, name: "Charlie Morgan", joinedAgo: 54, visitsAgo: [49, 42, 35, 28, 21, 14, 7, 2] },
  { n: 11, name: "Ella Hughes", joinedAgo: 30, visitsAgo: [25, 17, 9, 2] },
  { n: 12, name: "Leo Price", joinedAgo: 48, visitsAgo: [44, 33, 22, 11, 3] },
  { n: 13, name: "Mia Foster", joinedAgo: 52, visitsAgo: [47, 37, 27, 17, 9, 4] },
  { n: 14, name: "Noah Reid", joinedAgo: 44, visitsAgo: [39, 31, 23, 15, 8, 4, 1] },

  { n: 15, name: "Ruby Cooper", joinedAgo: 56, visitsAgo: [54, 50, 46, 40] },
  { n: 16, name: "Archie Ward", joinedAgo: 52, visitsAgo: [50, 45, 37] },
  { n: 17, name: "Lily Baker", joinedAgo: 56, visitsAgo: [55, 49, 44, 38, 35] },

  { n: 18, name: "Thomas Murphy", joinedAgo: 56, visitsAgo: [53, 47, 40, 10] },
  { n: 19, name: "Chloe Sanders", joinedAgo: 54, visitsAgo: [50, 44, 38, 0] },

  { n: 20, name: "Daniel Kelly", joinedAgo: 20, visitsAgo: [15, 5] },
  { n: 21, name: "Poppy Stevens", joinedAgo: 35, visitsAgo: [30, 18, 6] },
  { n: 22, name: "Finlay Ross", joinedAgo: 8, visitsAgo: [4], welcomeGrant: true }, // welcome grant still valid (joined <14d ago)
];

function memberId(n) {
  return id(500, n);
}
function memberPhone(n) {
  return `+44770091${String(n).padStart(4, "0")}`;
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

async function main() {
  console.log(`Seeding demo data for restaurant ${RESTAURANT_ID} @ ${iso(NOW)}\n`);

  // -- members ---------------------------------------------------------
  const memberRows = MEMBERS.map((m) => ({
    id: memberId(m.n),
    restaurant_id: RESTAURANT_ID,
    phone: memberPhone(m.n),
    name: m.name,
    birthday_month: (m.n % 12) + 1,
    birthday_day: ((m.n * 3) % 28) + 1,
    consent_ts: iso(daysAgo(m.joinedAgo)),
    consent_version: "pecr-v1 2026-07",
    opted_out: !!m.optedOut,
    opted_out_ts: m.optedOut ? iso(daysAgo(m.optedOutAgo)) : null,
    qr_token: `mqr_demo_${m.n}`,
    joined_at: iso(daysAgo(m.joinedAgo)),
  }));
  const membersResult = await upsert("members", memberRows, "id");
  console.log(`members: inserted ${membersResult.count} (of ${memberRows.length} attempted)`);

  // -- events (visits) ---------------------------------------------------
  let eventCounter = 0;
  const visitEventRows = [];
  for (const m of MEMBERS) {
    for (const offset of m.visitsAgo) {
      eventCounter += 1;
      visitEventRows.push({
        id: id(1000, eventCounter),
        restaurant_id: RESTAURANT_ID,
        member_id: memberId(m.n),
        type: "visit",
        source: "staff_scan",
        staff_pin_id: STAFF_PIN_ID,
        visit_slot: slot(daysAgo(offset)),
        created_at: iso(daysAgo(offset)),
      });
    }
  }
  const eventsResult = await upsert("events", visitEventRows, "id");
  console.log(`events (visits): inserted ${eventsResult.count} (of ${visitEventRows.length} attempted)`);

  // -- member_progress (ladder) ------------------------------------------
  const progressRows = MEMBERS.map((m) => ({
    member_id: memberId(m.n),
    program_id: PROGRAM_LADDER,
    restaurant_id: RESTAURANT_ID,
    endowed_count: 2,
    earned_count: m.visitsAgo.length,
    cycle: 1,
    updated_at: iso(daysAgo(Math.min(...m.visitsAgo))),
  }));
  const progressResult = await upsert("member_progress", progressRows, "member_id,program_id");
  console.log(`member_progress: inserted ${progressResult.count} (of ${progressRows.length} attempted)`);

  // -- reward_grants -------------------------------------------------------
  const LADDER_RUNG0 = { reward: "Free dessert of your choice", note: "1x dessert, no charge" };
  const LADDER_RUNG1 = { reward: "Free main course", note: "1x main, no charge" };
  const WELCOME = { reward: "Free garlic naan with your next order", note: "1x garlic naan, no charge" };

  const grantRows = [];
  let grantCounter = 0;
  const grantIdByMember = new Map(); // n -> { rung0Id, rung1Id, welcomeId }

  for (const m of MEMBERS) {
    const total = 2 + m.visitsAgo.length; // cycle 1: endowed(2) + earned
    const entry = {};
    if (total >= 6) {
      grantCounter += 1;
      const gid = id(700, grantCounter);
      entry.rung0Id = gid;
      grantRows.push({
        id: gid,
        restaurant_id: RESTAURANT_ID,
        member_id: memberId(m.n),
        program_id: PROGRAM_LADDER,
        reward_text: LADDER_RUNG0.reward,
        ring_up_note: LADDER_RUNG0.note,
        state: "earned",
        one_use_token: token("rwd"),
        grant_slot: "ladder:0:1",
        expires_at: null,
        earned_at: iso(daysAgo(m.visitsAgo[m.visitsAgo.length - 1] ?? 0)),
      });
    }
    if (total >= 10) {
      grantCounter += 1;
      const gid = id(700, grantCounter);
      entry.rung1Id = gid;
      grantRows.push({
        id: gid,
        restaurant_id: RESTAURANT_ID,
        member_id: memberId(m.n),
        program_id: PROGRAM_LADDER,
        reward_text: LADDER_RUNG1.reward,
        ring_up_note: LADDER_RUNG1.note,
        state: "earned",
        one_use_token: token("rwd"),
        grant_slot: "ladder:1:1",
        expires_at: null,
        earned_at: iso(daysAgo(m.visitsAgo[0])),
      });
    }
    if (m.welcomeGrant) {
      grantCounter += 1;
      const gid = id(700, grantCounter);
      entry.welcomeId = gid;
      grantRows.push({
        id: gid,
        restaurant_id: RESTAURANT_ID,
        member_id: memberId(m.n),
        program_id: PROGRAM_WELCOME,
        reward_text: WELCOME.reward,
        ring_up_note: WELCOME.note,
        state: "earned",
        one_use_token: token("rwd"),
        grant_slot: "welcome",
        expires_at: iso(daysAgo(m.joinedAgo - 14)), // valid_days:14 from join; daysAgo() handles negative (future) fine
        earned_at: iso(daysAgo(m.joinedAgo)),
      });
    }
    grantIdByMember.set(m.n, entry);
  }
  const grantsResult = await upsert("reward_grants", grantRows, "id");
  console.log(`reward_grants: inserted ${grantsResult.count} (of ${grantRows.length} attempted)`);

  // -- redemption events + grant state flips (two of them TODAY) ----------
  const redemptionEventRows = [];
  const grantRedemptionUpdates = [];
  for (const m of MEMBERS) {
    if (m.redeemAgo === undefined) continue;
    const entry = grantIdByMember.get(m.n);
    if (!entry?.rung0Id) continue;
    eventCounter += 1;
    const redEventId = id(1000, eventCounter);
    redemptionEventRows.push({
      id: redEventId,
      restaurant_id: RESTAURANT_ID,
      member_id: memberId(m.n),
      type: "redemption",
      source: "staff_scan",
      staff_pin_id: STAFF_PIN_ID,
      grant_id: entry.rung0Id,
      created_at: iso(daysAgo(m.redeemAgo)),
    });
    grantRedemptionUpdates.push({ grantId: entry.rung0Id, eventId: redEventId, at: iso(daysAgo(m.redeemAgo)) });
  }
  const redemptionEventsResult = await upsert("events", redemptionEventRows, "id");
  console.log(`events (redemptions): inserted ${redemptionEventsResult.count} (of ${redemptionEventRows.length} attempted)`);

  for (const u of grantRedemptionUpdates) {
    const { error } = await admin
      .from("reward_grants")
      .update({ state: "redeemed", redeemed_at: u.at, redeemed_event_id: u.eventId })
      .eq("id", u.grantId)
      .eq("state", "earned"); // idempotent: only flips once
    if (error) throw new Error(`reward_grants redeem update: ${error.message}`);
  }
  console.log(`reward_grants: redeemed ${grantRedemptionUpdates.length} (idempotent update, no-op on rerun)`);

  // -- campaigns -------------------------------------------------------
  const SENT_CAMPAIGN_ID = id(1900, 1);
  const SCHEDULED_CAMPAIGN_ID = id(1900, 2);
  const quietRecipients = [15, 16, 17, 18, 19]; // still-quiet-as-of-last-week members

  const campaignRows = [
    {
      id: SENT_CAMPAIGN_ID,
      restaurant_id: RESTAURANT_ID,
      audience: "gone_quiet",
      audience_filters: { min_visits: 2 },
      body: "We miss you at Demo Kitchen! Come back this week for something on us.",
      program_id: null,
      status: "sent",
      scheduled_for: null,
      sent_at: iso(daysAgo(7)),
      sent_count: quietRecipients.length,
    },
    {
      id: SCHEDULED_CAMPAIGN_ID,
      restaurant_id: RESTAURANT_ID,
      audience: "all",
      audience_filters: null,
      body: "New menu this weekend at Demo Kitchen. See you there!",
      program_id: null,
      status: "scheduled",
      scheduled_for: iso(daysAgo(-7)),
      sent_at: null,
      sent_count: null,
    },
  ];
  const campaignsResult = await upsert("campaigns", campaignRows, "id");
  console.log(`campaigns: inserted ${campaignsResult.count} (of ${campaignRows.length} attempted)`);

  // -- campaign_recipients + simulated outbound marketing messages ---------
  let messageCounter = 0;
  const messageRows = [];
  const recipientRows = [];
  for (const n of quietRecipients) {
    messageCounter += 1;
    const msgId = id(2000, messageCounter);
    messageRows.push({
      id: msgId,
      restaurant_id: RESTAURANT_ID,
      member_id: memberId(n),
      campaign_id: SENT_CAMPAIGN_ID,
      direction: "outbound",
      kind: "marketing",
      channel: "sms",
      body: "We miss you at Demo Kitchen! Come back this week for something on us. Reply STOP to opt out.",
      status: "simulated",
      created_at: iso(daysAgo(7)),
    });
    recipientRows.push({ campaign_id: SENT_CAMPAIGN_ID, member_id: memberId(n), message_id: msgId });
  }
  const campaignMsgResult = await upsert("messages", messageRows, "id");
  console.log(`messages (campaign): inserted ${campaignMsgResult.count} (of ${messageRows.length} attempted)`);
  const recipientsResult = await upsert("campaign_recipients", recipientRows, "campaign_id,member_id");
  console.log(`campaign_recipients: inserted ${recipientsResult.count} (of ${recipientRows.length} attempted)`);

  // -- ~10 additional standalone marketing messages this month -------------
  const extraMarketingMembers = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
  const extraMarketingRows = extraMarketingMembers.map((n, idx) => ({
    id: id(2100, idx + 1),
    restaurant_id: RESTAURANT_ID,
    member_id: memberId(n),
    campaign_id: null,
    direction: "outbound",
    kind: "marketing",
    channel: "sms",
    body: "You're close to your next reward at Demo Kitchen, one more visit to go! Reply STOP to opt out.",
    status: "simulated",
    created_at: iso(daysAgo(idx + 1)),
  }));
  const extraMarketingResult = await upsert("messages", extraMarketingRows, "id");
  console.log(`messages (extra marketing): inserted ${extraMarketingResult.count} (of ${extraMarketingRows.length} attempted)`);

  // -- a few transactional messages -----------------------------------
  const transactionalMembers = [3, 7, 8, 20, 22];
  const transactionalRows = transactionalMembers.map((n, idx) => ({
    id: id(2200, idx + 1),
    restaurant_id: RESTAURANT_ID,
    member_id: memberId(n),
    campaign_id: null,
    direction: "outbound",
    kind: "transactional",
    channel: "sms",
    body: "Thanks for visiting Demo Kitchen! Your card link: https://booth.demo/card/placeholder",
    status: "simulated",
    created_at: iso(daysAgo(idx)),
  }));
  const transactionalResult = await upsert("messages", transactionalRows, "id");
  console.log(`messages (transactional): inserted ${transactionalResult.count} (of ${transactionalRows.length} attempted)`);

  // -- Plan V2 demo dressing (idempotent overwrites — same values every run) --

  // Ladder rung 0 becomes a 2-option choice; rung 1 stays single-option.
  const { error: ladderConfigError } = await admin
    .from("reward_programs")
    .update({
      config: {
        endowed_start: 2,
        loop: true,
        rungs: [
          {
            visits: 6,
            options: [
              { reward: "Free naan", ring_up_note: "1x naan, no charge" },
              { reward: "Free dessert", ring_up_note: "1x dessert, no charge" },
            ],
          },
          { visits: 10, options: [{ reward: "Free main course", ring_up_note: "1x main, no charge" }] },
        ],
      },
    })
    .eq("id", PROGRAM_LADDER);
  if (ladderConfigError) throw new Error(`reward_programs (ladder options): ${ladderConfigError.message}`);
  console.log("reward_programs: ladder rung 0 upgraded to a 2-option choice");

  // Come-back gets 3 deepening blocks.
  const { error: comeBackConfigError } = await admin
    .from("reward_programs")
    .update({
      config: {
        blocks: [
          { id: "b1", days_quiet: 7, reward: "Free starter when you come back", valid_days: 14 },
          { id: "b2", days_quiet: 14, reward: "Free main when you come back", valid_days: 14 },
          { id: "b3", days_quiet: 60, reward: "Free meal for two when you come back", valid_days: 21 },
        ],
        min_days_between_contact: 10,
      },
    })
    .eq("id", PROGRAM_COME_BACK);
  if (comeBackConfigError) throw new Error(`reward_programs (come_back blocks): ${comeBackConfigError.message}`);
  console.log("reward_programs: come_back set to 3 blocks (b1:7d, b2:14d, b3:60d)");

  // Birthday switches to month mode.
  const { error: birthdayConfigError } = await admin
    .from("reward_programs")
    .update({ config: { reward: "Free birthday dessert", mode: "month" } })
    .eq("id", PROGRAM_BIRTHDAY);
  if (birthdayConfigError) throw new Error(`reward_programs (birthday month mode): ${birthdayConfigError.message}`);
  console.log("reward_programs: birthday set to month mode");

  // join_page, brand_colors, and a small labeled example menu on the restaurant.
  const { error: restaurantExtrasError } = await admin
    .from("restaurants")
    .update({
      join_page: { magnet: "ladder", program_id: PROGRAM_LADDER },
      brand_colors: ["#F26649", "#20231F"],
      menu_items: [
        { name: "Garlic naan", price: 4.5, category: "Sides" },
        { name: "Butter chicken", price: 13.5, category: "Mains" },
        { name: "Lamb rogan josh", price: 14.5, category: "Mains" },
        { name: "Vegetable samosa (2pc)", price: 5, category: "Starters" },
        { name: "Mango kulfi", price: 5.5, category: "Desserts" },
        { name: "House chai", price: 3, category: "Drinks" },
      ],
    })
    .eq("id", RESTAURANT_ID);
  if (restaurantExtrasError) throw new Error(`restaurants (join_page/brand_colors/menu_items): ${restaurantExtrasError.message}`);
  console.log("restaurants: join_page/brand_colors/menu_items set (labeled demo values)");

  // At least one earned, UNCHOSEN multi-option grant on the cheat-sheet
  // member (07700 910010 = member 10, Charlie Morgan) so the choice UX has
  // something to click through in the demo.
  const { error: choiceGrantError } = await admin
    .from("reward_grants")
    .upsert(
      [
        {
          id: id(700, 900),
          restaurant_id: RESTAURANT_ID,
          member_id: memberId(10),
          program_id: PROGRAM_LADDER,
          reward_text: "Free naan or Free dessert",
          ring_up_note: null,
          reward_options: [
            { reward: "Free naan", ring_up_note: "1x naan, no charge" },
            { reward: "Free dessert", ring_up_note: "1x dessert, no charge" },
          ],
          state: "earned",
          one_use_token: token("rwd"),
          grant_slot: "demo:choice:1",
          expires_at: null,
          earned_at: iso(daysAgo(1)),
        },
      ],
      { onConflict: "id", ignoreDuplicates: true }
    );
  if (choiceGrantError) throw new Error(`reward_grants (choice demo): ${choiceGrantError.message}`);
  console.log("reward_grants: unchosen multi-option demo grant seeded for member 10 (07700 910010)");

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
