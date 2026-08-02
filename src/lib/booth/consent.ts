// Only a type import — erased at compile time (isolatedModules), so this
// file stays free of any runtime Supabase/"server-only" import. It's pulled
// directly into the client-bundled join-form.tsx for consentCopyFor /
// consentVersionFor; a real "server-only" import here would break that
// client build.
import type { SupabaseClient } from "@supabase/supabase-js";

/** PECR consent wording version stamped on members.consent_version at join / re-opt-in time (GB market). */
export const CONSENT_VERSION = "pecr-v1 2026-07";

/** TCPA consent wording version stamped on members.consent_version at join / re-opt-in time (US market). */
export const TCPA_CONSENT_VERSION = "tcpa-v1 2026-07";

/** PECR consent version stamped on members.consent_version when a member re-opts-in via SMS START/UNSTOP (see src/app/api/sms/inbound/route.ts). GB market. */
export const SMS_CONSENT_VERSION = "pecr-sms-v1 2026-07";

/** TCPA consent version stamped on members.consent_version when a member re-opts-in via SMS START/UNSTOP (see src/app/api/sms/inbound/route.ts). US market. */
export const US_SMS_CONSENT_VERSION = "tcpa-sms-v1 2026-07";

/**
 * PECR-compliant join-checkbox copy (GB): plain English, explicit opt-in, no
 * soft-opt-in reliance, states STOP/HELP and that frequency varies (PRD
 * "Compliance floor" — hard-coded, never overridable).
 */
export function CONSENT_COPY(restaurantName: string): string {
  return `I agree to receive texts about rewards and offers from ${restaurantName}. Message frequency varies. Msg & data rates may apply. Reply STOP to opt out, HELP for help. Messages will be sent to the number I've provided.`;
}

/**
 * TCPA-compliant join-checkbox copy (US) — exact wording per SPEC-WSA A2 §5.
 */
export function TCPA_CONSENT_COPY(restaurantName: string): string {
  return `By joining, you agree to receive recurring loyalty and marketing texts from ${restaurantName} via Booth. Consent is not a condition of purchase. Msg & data rates may apply. Reply STOP to opt out, HELP for help.`;
}

/** Resolves the market-correct consent version to stamp at join time from the restaurant's country. Nothing hardcodes a market — GB is the fallback for any country not yet given its own copy. */
export function consentVersionFor(country: string): string {
  return country === "US" ? TCPA_CONSENT_VERSION : CONSENT_VERSION;
}

/** Resolves the market-correct join-checkbox copy from the restaurant's country. */
export function consentCopyFor(country: string, restaurantName: string): string {
  return country === "US" ? TCPA_CONSENT_COPY(restaurantName) : CONSENT_COPY(restaurantName);
}

/** Resolves the market-correct consent version to stamp on SMS START/UNSTOP re-opt-in from the restaurant's country. Nothing hardcodes a market — GB is the fallback for any country not yet given its own SMS re-opt-in copy. */
export function smsConsentVersionFor(country: string): string {
  return country === "US" ? US_SMS_CONSENT_VERSION : SMS_CONSENT_VERSION;
}

/**
 * Version + wording as one inseparable pair for SMS-channel consent_events
 * (START re-opt-in, STOP revocation). Exists so call sites can't glue a
 * version tag to wording it doesn't refer to (review finding #4): the
 * wording IS the legal language the version tag names.
 */
export function smsConsentPairFor(country: string, restaurantName: string): { version: string; wording: string } {
  return { version: smsConsentVersionFor(country), wording: consentCopyFor(country, restaurantName) };
}

/**
 * Actions written to consent_events (supabase/migrations/
 * 20260722000000_consent_events.sql) — an append-only history distinct from
 * members.consent_ts / members.consent_version, which stay a current-state
 * cache only (unchanged semantics).
 */
export type ConsentAction = "join" | "rejoin" | "optin_sms" | "optout_sms";

export type ConsentEventInput = {
  restaurantId: string;
  memberId: string;
  action: ConsentAction;
  consentVersion: string;
  /** The EXACT rendered consent string shown at this moment (consentCopyFor / TCPA_CONSENT_COPY output) — never paraphrased or summarized. */
  wording: string;
  source: string;
};

/**
 * Appends one immutable consent_events row. Takes an already-constructed
 * admin client (dependency-injected) instead of creating one itself — see
 * the note above on why this file must not import "server-only" / the
 * Supabase server module directly.
 *
 * Wired into src/app/api/sms/inbound/route.ts for STOP (direct and
 * shared-number fallback) and START, always via smsConsentPairFor so the
 * version tag and wording can never disagree.
 */
export async function recordConsentEvent(admin: SupabaseClient, input: ConsentEventInput): Promise<void> {
  const { error } = await admin.from("consent_events").insert({
    restaurant_id: input.restaurantId,
    member_id: input.memberId,
    action: input.action,
    consent_version: input.consentVersion,
    wording: input.wording,
    source: input.source,
  });
  if (error) throw error;
}
