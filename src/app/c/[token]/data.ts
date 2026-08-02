import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { sha256Hex } from "@/lib/booth/tokens";
export async function resolveMagicMember(token: string, touch = true): Promise<string | null> {
  const admin = createSupabaseAdminClient(); const now = new Date().toISOString();
  const { data, error } = await admin.from("magic_tokens").select("member_id, expires_at, revoked_at").eq("token_hash", sha256Hex(token)).maybeSingle();
  if (error) throw error;
  if (!data || data.revoked_at || new Date(data.expires_at).getTime() <= Date.now()) return null;
  if (touch) { const { error: updateError } = await admin.from("magic_tokens").update({ last_used_at: now }).eq("token_hash", sha256Hex(token)); if (updateError) throw updateError; }
  return data.member_id;
}

// ---------------------------------------------------------------------------
// Member session cookie (WS-B item 1) — signed httpOnly cookie proving this
// device resolved a valid /c/[token] card for a given member+restaurant, so
// /v/[slug] (self check-in) can trust "this phone belongs to this member"
// without asking for a phone number again. Same HMAC-sign / timing-safe-
// compare idiom as src/lib/booth/staff-session.ts, duplicated rather than
// imported (that file is scoped to the staff cookie/name; this is a
// different cookie for a different audience) — same rationale as that
// file's own docstring for why it didn't reuse the older staff-auth.ts.
// Cookie format: `{memberId}.{restaurantId}.{issuedAtMs}.{signature}` — both
// ids are uuids (no ".", so splitting on "." is unambiguous).
// ---------------------------------------------------------------------------

const MEMBER_COOKIE_NAME = "bl_member";
const MEMBER_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days
// Grace window for "reject future-issued cookies" (Codex #2) — guards
// against clock skew between server instances, not a real allowance for a
// cookie whose signed timestamp is actually ahead of now.
const MEMBER_COOKIE_FUTURE_SKEW_MS = 5 * 60 * 1000;

function getMemberSessionSecret(): string {
  const secret = process.env.STAFF_AUTH_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("STAFF_AUTH_SECRET or SUPABASE_SERVICE_ROLE_KEY must be set");
  return secret;
}

function signMemberSession(value: string): string {
  return createHmac("sha256", getMemberSessionSecret()).update(value).digest("hex");
}

/**
 * Sets the signed httpOnly member-session cookie. Per Next's cookies() docs,
 * `.set()` only works inside a Server Function (Server Action) or Route
 * Handler — never during Server Component rendering — so this must be
 * invoked as (or from) a "use server" action, not called directly from
 * page.tsx's render.
 */
export async function setMemberSessionCookie(memberId: string, restaurantId: string): Promise<void> {
  const cookieStore = await cookies();
  const payload = `${memberId}.${restaurantId}.${Date.now()}`;
  const signature = signMemberSession(payload);
  cookieStore.set(MEMBER_COOKIE_NAME, `${payload}.${signature}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MEMBER_COOKIE_MAX_AGE_SECONDS,
  });
}

export type MemberSession = { memberId: string; restaurantId: string };

/** Reads + verifies the member-session cookie above. Read-only — safe to call from a Server Component. */
export async function getMemberSession(): Promise<MemberSession | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(MEMBER_COOKIE_NAME)?.value;
  if (!raw) return null;

  const parts = raw.split(".");
  if (parts.length !== 4) return null;
  const [memberId, restaurantId, ts, signature] = parts;
  const payload = `${memberId}.${restaurantId}.${ts}`;

  const expected = signMemberSession(payload);
  const expectedBuf = Buffer.from(expected);
  const gotBuf = Buffer.from(signature);
  if (expectedBuf.length !== gotBuf.length || !timingSafeEqual(expectedBuf, gotBuf)) return null;

  const issuedAt = Number(ts);
  if (!Number.isFinite(issuedAt)) return null;
  const age = Date.now() - issuedAt;
  if (age > MEMBER_COOKIE_MAX_AGE_SECONDS * 1000) return null;
  // A validly-signed cookie whose timestamp is materially in the future
  // (issuedAt > now, beyond ordinary clock skew) previously stayed accepted
  // until 30 days past that future instant — reject it outright instead.
  if (age < -MEMBER_COOKIE_FUTURE_SKEW_MS) return null;

  return { memberId, restaurantId };
}
