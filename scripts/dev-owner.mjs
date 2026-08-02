// One-off (rerunnable) dev script: creates a test owner in the local Supabase
// auth stack and points demo-kitchen's owner_id at them, so the M7 dashboard
// can be signed into locally. Never run against the cloud project.
//
// Usage: node scripts/dev-owner.mjs
import { readFileSync } from "node:fs";
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

const env = loadEnvLocal();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env.local");

const EMAIL = "owner@demo.test";
const PASSWORD = "booth-dev-1234";
const DEMO_KITCHEN_ID = "00000000-0000-4000-8000-000000000001";

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function findUserByEmail(email) {
  // Local stack has few users — a single page is enough for dev.
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw error;
  return data.users.find((u) => u.email === email) ?? null;
}

async function main() {
  let user = await findUserByEmail(EMAIL);
  if (user) {
    console.log(`Owner already exists: ${user.id}`);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
    user = data.user;
    console.log(`Created owner: ${user.id}`);
  }

  const { data: restaurant, error: updateError } = await admin
    .from("restaurants")
    .update({ owner_id: user.id })
    .eq("id", DEMO_KITCHEN_ID)
    .select("id, slug, name, owner_id")
    .single();
  if (updateError) throw updateError;
  console.log(`demo-kitchen owner_id -> ${restaurant.owner_id} (${restaurant.slug})`);

  console.log("\nDev owner credentials:");
  console.log(`  email:    ${EMAIL}`);
  console.log(`  password: ${PASSWORD}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
