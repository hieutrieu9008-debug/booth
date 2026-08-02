import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

const COOKIE_MAX_AGE_SECONDS = 8 * 60 * 60; // 8h, same window as src/lib/staff-auth.ts

/**
 * Signed, HttpOnly cookie proving this device unlocked the /s/[slug] staff
 * loop with a specific staff PIN. Adapted from src/lib/staff-auth.ts's
 * restaurant-only unlock cookie (same HMAC-sign / timing-safe-compare
 * idiom), but kept as its own module + cookie name rather than an edit to
 * that file: /staff/* (staff-auth.ts's route) dies in the M4 prune, /s/[slug]
 * is the new one, and this cookie's payload carries staff_pin_id (not a
 * free-text staffer name) so every scan/lookup/redeem attributes to the
 * right pin per M4-STAFF-SPEC.md.
 *
 * Cookie format: `{restaurantId}.{staffPinId}.{issuedAtMs}.{signature}` —
 * both ids are uuids (no ".", so splitting on "." is unambiguous), and the
 * signature always covers everything before it.
 */

function getSecret(): string {
  const secret = process.env.STAFF_AUTH_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    throw new Error("STAFF_AUTH_SECRET or SUPABASE_SERVICE_ROLE_KEY must be set");
  }
  return secret;
}

function cookieName(restaurantSlug: string): string {
  return `staff_session_${restaurantSlug}`;
}

function sign(value: string): string {
  return createHmac("sha256", getSecret()).update(value).digest("hex");
}

export async function setStaffSessionCookie(
  restaurantSlug: string,
  restaurantId: string,
  staffPinId: string
): Promise<void> {
  const cookieStore = await cookies();
  const payload = `${restaurantId}.${staffPinId}.${Date.now()}`;
  const signature = sign(payload);
  cookieStore.set(cookieName(restaurantSlug), `${payload}.${signature}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
}

export type StaffSessionCheck =
  | { unlocked: false }
  | { unlocked: true; staffPinId: string; expiresAt: string };

/** Verifies the current request's staff-session cookie for this restaurant. */
export async function checkStaffSession(restaurantSlug: string, restaurantId: string): Promise<StaffSessionCheck> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(cookieName(restaurantSlug))?.value;
  if (!raw) return { unlocked: false };

  const parts = raw.split(".");
  if (parts.length !== 4) return { unlocked: false };
  const [id, staffPinId, ts, signature] = parts;
  const payload = `${id}.${staffPinId}.${ts}`;

  const expected = sign(payload);
  const expectedBuf = Buffer.from(expected);
  const gotBuf = Buffer.from(signature);
  if (expectedBuf.length !== gotBuf.length || !timingSafeEqual(expectedBuf, gotBuf)) return { unlocked: false };
  if (id !== restaurantId) return { unlocked: false };

  const issuedAt = Number(ts);
  if (!Number.isFinite(issuedAt)) return { unlocked: false };
  if (Date.now() - issuedAt > COOKIE_MAX_AGE_SECONDS * 1000) return { unlocked: false };

  const expiresAt = new Date(issuedAt + COOKIE_MAX_AGE_SECONDS * 1000).toISOString();
  return { unlocked: true, staffPinId, expiresAt };
}

export async function hasStaffSession(restaurantSlug: string, restaurantId: string): Promise<boolean> {
  return (await checkStaffSession(restaurantSlug, restaurantId)).unlocked;
}

export async function clearStaffSessionCookie(restaurantSlug: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(cookieName(restaurantSlug));
}
