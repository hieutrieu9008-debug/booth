import { createHash, createHmac, randomBytes } from "node:crypto";

/**
 * Token minting + hashing. node:crypto only — no external deps.
 *
 * Byte counts are chosen so base64url encoding needs no padding: N bytes ->
 * (N*4/3) chars when N is a multiple of 3, so 18 bytes -> 24 chars and
 * 24 bytes -> 32 chars exactly.
 */

function randomUrlSafe(chars: number): string {
  const bytes = (chars * 3) / 4;
  if (!Number.isInteger(bytes)) {
    throw new Error(`randomUrlSafe: chars must be a multiple of 4 (got ${chars})`);
  }
  return randomBytes(bytes).toString("base64url");
}

/** Member-card identity QR payload. */
export function newQrToken(): string {
  return `mqr_${randomUrlSafe(24)}`;
}

/** One-use reward redemption QR payload. */
export function newRewardToken(): string {
  return `rwd_${randomUrlSafe(24)}`;
}

/** Member-card magic-link token (raw value; only the sha256Hex of this is stored — see magic_tokens.token_hash). */
export function newMagicToken(): string {
  return `mlt_${randomUrlSafe(32)}`;
}

/** Venue-wide self-check-in QR payload (restaurants.self_scan_token) — static per restaurant, not rotating (see docs/ARCHITECTURE.md's known-deferred-seams). */
export function newVenueToken(): string {
  return `vnu_${randomUrlSafe(24)}`;
}

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/**
 * Resolves the HMAC secret at call time (not module load) — same idiom as
 * getSecret() in src/lib/staff-auth.ts, so a missing secret fails loudly
 * instead of silently falling back to a hardcoded string.
 */
function getStaffAuthSecret(): string {
  const secret = process.env.STAFF_AUTH_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    throw new Error("STAFF_AUTH_SECRET or SUPABASE_SERVICE_ROLE_KEY must be set");
  }
  return secret;
}

/** HMAC-SHA256(STAFF_AUTH_SECRET, pin) hex — matches staff_pins.pin_hash. */
export function hashStaffPin(pin: string): string {
  return createHmac("sha256", getStaffAuthSecret()).update(pin).digest("hex");
}
