import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

const COOKIE_MAX_AGE_SECONDS = 8 * 60 * 60; // 8h, same window as src/lib/booth/staff-session.ts
const COOKIE_NAME = "internal_session";

/**
 * Signed, HttpOnly cookie proving this device unlocked /internal with the
 * INTERNAL_ACCESS_CODE. Adapted from src/lib/booth/staff-session.ts's HMAC
 * sign / timing-safe-compare idiom, but standalone: this gate is single
 * (operator-only), not per-restaurant, so the payload carries only a timestamp.
 *
 * Cookie format: `{issuedAtMs}.{signature}`.
 */

function getSecret(): string {
  const secret = process.env.STAFF_AUTH_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    throw new Error("STAFF_AUTH_SECRET or SUPABASE_SERVICE_ROLE_KEY must be set");
  }
  return secret;
}

function sign(value: string): string {
  return createHmac("sha256", getSecret()).update(value).digest("hex");
}

export async function setInternalSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  const payload = `${Date.now()}`;
  const signature = sign(payload);
  cookieStore.set(COOKIE_NAME, `${payload}.${signature}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
}

export async function hasInternalSession(): Promise<boolean> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(COOKIE_NAME)?.value;
  if (!raw) return false;

  const parts = raw.split(".");
  if (parts.length !== 2) return false;
  const [ts, signature] = parts;

  const expected = sign(ts);
  const expectedBuf = Buffer.from(expected);
  const gotBuf = Buffer.from(signature);
  if (expectedBuf.length !== gotBuf.length || !timingSafeEqual(expectedBuf, gotBuf)) return false;

  const issuedAt = Number(ts);
  if (!Number.isFinite(issuedAt)) return false;
  if (Date.now() - issuedAt > COOKIE_MAX_AGE_SECONDS * 1000) return false;

  return true;
}

export async function clearInternalSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}
