import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { primaryBrandColor } from "./branding";
import { consentCopyFor, consentVersionFor, recordConsentEvent } from "./consent";
import { birthdayGrantParams, localYMD } from "./engine";
import { progressDisplay, type ProgressDisplay } from "./ladder";
import { parseProgramConfig } from "./programs";
import type { NewGrant } from "./rewards";
import { newQrToken, newRewardToken } from "./tokens";
import type { EventSource, Member, MemberProgress, RewardGrant, RewardProgram } from "./types";

const JOIN_CAP_WINDOW_MS = 24 * 60 * 60 * 1000;
const JOIN_CAP_MAX = 3; // per-phone joins across the platform in the window above

export class JoinCapExceededError extends Error {
  constructor() {
    super(`Phone has joined ${JOIN_CAP_MAX} or more restaurants in the last 24h`);
    this.name = "JoinCapExceededError";
  }
}

// Task C: thrown when a phone is in suppressed_phones (erased while opted
// out — see src/lib/booth/privacy.ts eraseMember) and the join attempt isn't
// a diner self_scan (see the guard below). There's no existing member row to
// return in this case (erasure deletes it), unlike JoinCapExceededError's
// sibling optedOutBlocked path.
export class SuppressedPhoneError extends Error {
  constructor() {
    super("This phone opted out and was then erased at the diner's request; it stays suppressed until manually cleared at the diner's own verified request.");
    this.name = "SuppressedPhoneError";
  }
}

export type JoinMemberInput = {
  restaurantId: string;
  phone: string; // E.164, already normalized by the caller
  name: string;
  birthdayMonth?: number;
  birthdayDay?: number;
  consentVersion: string;
  // Not persisted (members has no source column in the v2 schema) — accepted
  // for symmetry with events.source / forward-compat with a future audit trail.
  source: EventSource;
  // True only for the public /j/[slug] web join form, where the phone is NOT
  // verified — gates the opted-out reactivation guard below. Default false
  // preserves prior behavior for every other (test/internal) caller.
  viaWebJoin?: boolean;
};

export type JoinMemberResult = {
  member: Member;
  alreadyMember: boolean;
  // True only for an existing, NOT-opted-out member re-joining (Codex #48) —
  // details were refreshed, not a fresh enrollment. False for a brand-new
  // member AND for the opted-out re-opt-in path (that one keeps its existing
  // "welcome back" UX, unchanged).
  repeatJoin: boolean;
  welcomeGrant: NewGrant | null;
  // True when a web-join attempt (viaWebJoin) matched an opted-out member and
  // was refused (Task B guard). `member` is the existing row UNCHANGED (still
  // opted_out) — nothing else in this function ran: no consent event, no
  // ladder/welcome-grant logic. The SMS START path is the reactivation route.
  optedOutBlocked: boolean;
};

/**
 * Joins a phone to a restaurant, enforcing the platform-wide per-phone join
 * cap, then enrolls the member in every active visit_ladder and issues a
 * welcome grant if the restaurant has an active welcome program.
 *
 * Idempotent for the ladder-enrollment and welcome-grant steps (ON CONFLICT
 * DO NOTHING / unique grant_slot), so re-running this for an existing member
 * — including the re-opt-in path below — never double-enrolls or double-grants.
 */
export async function joinMember(input: JoinMemberInput): Promise<JoinMemberResult> {
  const admin = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();

  const since = new Date(Date.now() - JOIN_CAP_WINDOW_MS).toISOString();
  const { count: recentJoinCount, error: capError } = await admin
    .from("members")
    .select("id", { count: "exact", head: true })
    .eq("phone", input.phone)
    .gte("joined_at", since);
  if (capError) throw capError;
  if ((recentJoinCount ?? 0) >= JOIN_CAP_MAX) {
    throw new JoinCapExceededError();
  }

  // Suppression guard (Task C, hardened after adversarial review): erasing
  // an opted-out member (privacy.ts eraseMember) leaves this row behind since
  // the members row itself is gone. NO join path clears it automatically —
  // the public /j form also sends source "self_scan", so clear-on-self_scan
  // would let anyone who knows the number silently re-subscribe an erased
  // opted-out diner (confirmed exploitable in review). At MVP the row is
  // removed only manually (white-glove, at the diner's own verified request).
  const { data: suppressedRow, error: suppressedError } = await admin
    .from("suppressed_phones")
    .select("phone")
    .eq("restaurant_id", input.restaurantId)
    .eq("phone", input.phone)
    .maybeSingle();
  if (suppressedError) throw suppressedError;
  if (suppressedRow) throw new SuppressedPhoneError();

  let member: Member;
  let alreadyMember = false;
  let repeatJoin = false;

  const { data: insertedMember, error: insertError } = await admin
    .from("members")
    .insert({
      restaurant_id: input.restaurantId,
      phone: input.phone,
      name: input.name,
      birthday_month: input.birthdayMonth ?? null,
      birthday_day: input.birthdayDay ?? null,
      consent_ts: nowIso,
      consent_version: input.consentVersion,
      qr_token: newQrToken(),
    })
    .select("*")
    .single();

  if (insertError) {
    if (insertError.code !== "23505") throw insertError; // not a (restaurant_id, phone) unique violation
    const existing = await findMemberByPhone(input.restaurantId, input.phone);
    if (!existing) throw insertError; // shouldn't happen — the violation implies the row exists
    alreadyMember = true;
    member = existing;
    if (existing.opted_out) {
      if (input.viaWebJoin) {
        // Web-join guard (Task B): the public form never phone-verifies the
        // number, so it must never silently re-subscribe a number that
        // opted out. Return as-is, write nothing, run nothing downstream —
        // SMS START (phone-verified by definition) is the only reactivation
        // route.
        return { member: existing, alreadyMember: true, repeatJoin: false, welcomeGrant: null, optedOutBlocked: true };
      }
      const { data: reopted, error: reoptError } = await admin
        .from("members")
        .update({
          opted_out: false,
          opted_out_ts: null,
          consent_ts: nowIso,
          consent_version: input.consentVersion,
        })
        .eq("id", existing.id)
        .select("*")
        .single();
      if (reoptError) throw reoptError;
      member = reopted as Member;
    } else {
      // Repeat join, not opted out (Codex #48): they filled the join form
      // again while already a member — refresh their details and re-consent
      // rather than silently no-opping, and flag it so the success screen
      // doesn't imply a fresh enrollment.
      const { data: refreshed, error: refreshError } = await admin
        .from("members")
        .update({
          name: input.name,
          birthday_month: input.birthdayMonth ?? existing.birthday_month,
          birthday_day: input.birthdayDay ?? existing.birthday_day,
          consent_ts: nowIso,
          consent_version: input.consentVersion,
        })
        .eq("id", existing.id)
        .select("*")
        .single();
      if (refreshError) throw refreshError;
      member = refreshed as Member;
      repeatJoin = true;
    }
  } else {
    member = insertedMember as Member;
  }

  // Consent event (Task B): append-only history, always derived fresh from
  // the restaurant's ACTUAL current country + consent.ts helpers — not from
  // input.consentVersion, which some callers may pass mismatched to that
  // (e.g. tests exercising the members-cache-trusts-the-caller behavior
  // below). This keeps consent_version/wording self-consistent within every
  // event row. members.consent_ts/consent_version (set above) remain the
  // unrelated current-state cache, driven by input.consentVersion as before.
  const { data: restaurantMeta, error: restaurantMetaError } = await admin
    .from("restaurants")
    .select("name, country")
    .eq("id", input.restaurantId)
    .single();
  if (restaurantMetaError) throw restaurantMetaError;
  await recordConsentEvent(admin, {
    restaurantId: input.restaurantId,
    memberId: member.id,
    action: alreadyMember ? "rejoin" : "join",
    consentVersion: consentVersionFor(restaurantMeta.country),
    wording: consentCopyFor(restaurantMeta.country, restaurantMeta.name),
    source: input.source,
  });

  const { data: activeLadders, error: laddersError } = await admin
    .from("reward_programs")
    .select("*")
    .eq("restaurant_id", input.restaurantId)
    .eq("type", "visit_ladder")
    .eq("active", true);
  if (laddersError) throw laddersError;

  for (const program of (activeLadders ?? []) as RewardProgram[]) {
    const parsed = parseProgramConfig(program.type, program.config);
    if (parsed.type !== "visit_ladder") continue;
    await admin.from("member_progress").upsert(
      {
        member_id: member.id,
        program_id: program.id,
        restaurant_id: input.restaurantId,
        endowed_count: parsed.config.endowed_start,
        earned_count: 0,
        cycle: 1,
      },
      { onConflict: "member_id,program_id", ignoreDuplicates: true }
    );
  }

  let welcomeGrant: NewGrant | null = null;
  const { data: welcomePrograms, error: welcomeError } = await admin
    .from("reward_programs")
    .select("*")
    .eq("restaurant_id", input.restaurantId)
    .eq("type", "welcome")
    .eq("active", true)
    .limit(1);
  if (welcomeError) throw welcomeError;

  const welcomeProgram = (welcomePrograms as RewardProgram[] | null)?.[0];
  if (welcomeProgram) {
    const parsed = parseProgramConfig(welcomeProgram.type, welcomeProgram.config);
    if (parsed.type === "welcome") {
      const expiresAt = new Date(Date.now() + parsed.config.valid_days * 24 * 60 * 60 * 1000).toISOString();
      const { data: insertedGrant, error: grantError } = await admin
        .from("reward_grants")
        .upsert(
          {
            restaurant_id: input.restaurantId,
            member_id: member.id,
            program_id: welcomeProgram.id,
            reward_text: parsed.config.reward,
            ring_up_note: parsed.config.ring_up_note ?? null,
            one_use_token: newRewardToken(),
            grant_slot: "welcome",
            expires_at: expiresAt,
            earned_at: nowIso,
          },
          { onConflict: "member_id,program_id,grant_slot", ignoreDuplicates: true }
        )
        .select("reward_text, ring_up_note, one_use_token, grant_slot")
        .maybeSingle();
      if (grantError) throw grantError;
      if (insertedGrant) {
        welcomeGrant = {
          rewardText: insertedGrant.reward_text,
          ringUpNote: insertedGrant.ring_up_note,
          oneUseToken: insertedGrant.one_use_token,
          slot: insertedGrant.grant_slot,
          hasChoice: false,
        };
      }
    }
  }

  // Month-mode birthday programs materialize at join if the joining member's
  // birthday_month is the current restaurant-local month — otherwise they'd
  // get nothing until the next daily cron (or miss it entirely if a run
  // fails) [Cx2-20]. Window mode stays cron-only. Same yearly slot as the
  // cron, so this can never double-grant.
  if (member.birthday_month != null) {
    const { data: birthdayPrograms, error: birthdayProgramsError } = await admin
      .from("reward_programs")
      .select("*")
      .eq("restaurant_id", input.restaurantId)
      .eq("type", "birthday")
      .eq("active", true)
      .limit(1);
    if (birthdayProgramsError) throw birthdayProgramsError;
    const birthdayProgram = (birthdayPrograms as RewardProgram[] | null)?.[0];
    if (birthdayProgram) {
      const parsed = parseProgramConfig(birthdayProgram.type, birthdayProgram.config);
      if (parsed.type === "birthday" && parsed.config.mode === "month") {
        const { data: restaurantRow, error: restaurantError } = await admin
          .from("restaurants")
          .select("timezone")
          .eq("id", input.restaurantId)
          .single();
        if (restaurantError) throw restaurantError;
        const today = localYMD(restaurantRow.timezone);
        if (member.birthday_month === today.month) {
          const { expiresAt } = birthdayGrantParams(parsed.config, restaurantRow.timezone);
          await admin.from("reward_grants").upsert(
            {
              restaurant_id: input.restaurantId,
              member_id: member.id,
              program_id: birthdayProgram.id,
              reward_text: parsed.config.reward,
              ring_up_note: null,
              one_use_token: newRewardToken(),
              grant_slot: `birthday:${today.year}`,
              expires_at: expiresAt,
              earned_at: nowIso,
            },
            { onConflict: "member_id,program_id,grant_slot", ignoreDuplicates: true }
          );
        }
      }
    }
  }

  return { member, alreadyMember, repeatJoin, welcomeGrant, optedOutBlocked: false };
}

export async function findMemberByPhone(restaurantId: string, phone: string): Promise<Member | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("members")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .eq("phone", phone)
    .maybeSingle();
  if (error) throw error;
  return (data as Member) ?? null;
}

export async function getMemberByQrToken(qrToken: string): Promise<Member | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("members").select("*").eq("qr_token", qrToken).maybeSingle();
  if (error) throw error;
  return (data as Member) ?? null;
}

export type MemberCardProgress = {
  program: RewardProgram;
  progress: MemberProgress;
  display: ProgressDisplay;
};

export type MemberCard = {
  member: Member;
  progress: MemberCardProgress[];
  activeGrants: RewardGrant[];
  restaurant: {
    id: string;
    slug: string;
    name: string;
    brandColor: string;
    logoUrl: string | null;

    currency: string;
  };
};

/** Everything the member-card page needs: ladder progress, redeemable grants, restaurant branding. */
export async function getMemberCard(memberId: string): Promise<MemberCard | null> {
  const admin = createSupabaseAdminClient();

  const { data: memberRow, error: memberError } = await admin
    .from("members")
    .select("*")
    .eq("id", memberId)
    .maybeSingle();
  if (memberError) throw memberError;
  if (!memberRow) return null;
  const member = memberRow as Member;

  const { data: restaurantRow, error: restaurantError } = await admin
    .from("restaurants")
    .select("id, slug, name, brand_color, brand_colors, logo_url, currency")
    .eq("id", member.restaurant_id)
    .single();
  if (restaurantError) throw restaurantError;

  const { data: progressRows, error: progressError } = await admin
    .from("member_progress")
    .select("*, reward_programs!inner(*)")
    .eq("member_id", memberId)
    .eq("reward_programs.type", "visit_ladder")
    .eq("reward_programs.active", true);
  if (progressError) throw progressError;

  const progress: MemberCardProgress[] = [];
  for (const row of (progressRows ?? []) as (MemberProgress & { reward_programs: RewardProgram })[]) {
    const { reward_programs: program, ...progressRow } = row;
    const parsed = parseProgramConfig(program.type, program.config);
    if (parsed.type !== "visit_ladder") continue;
    progress.push({ program, progress: progressRow, display: progressDisplay(parsed.config, progressRow) });
  }

  const { data: grantRows, error: grantsError } = await admin
    .from("reward_grants")
    .select("*")
    .eq("member_id", memberId)
    .eq("state", "earned")
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
  if (grantsError) throw grantsError;

  return {
    member,
    progress,
    activeGrants: (grantRows ?? []) as RewardGrant[],
    restaurant: {
      id: restaurantRow.id,
      slug: restaurantRow.slug,
      name: restaurantRow.name,
      brandColor: primaryBrandColor(restaurantRow),
      logoUrl: restaurantRow.logo_url,
      
      currency: restaurantRow.currency,
    },
  };
}
