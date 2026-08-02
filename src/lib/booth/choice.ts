import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { parseProgramConfig } from "./programs";

/**
 * Stamps a diner's (or staff-captured) pick on a multi-option ladder grant.
 * Two callers: the member-card action (card token -> member; diner picks
 * themself) and the staff phone-lookup action (staff stamps the diner's
 * spoken choice — never silently defaults to the first option [Cx2-7]).
 */
export type ChooseGrantOptionInput = { grantId: string; memberId: string; optionIndex: number };

export type ChooseGrantOptionResult =
  | { ok: true; rewardText: string; ringUpNote: string | null }
  | { ok: false; error: string };

/**
 * Re-choosing while the grant is still 'earned' is allowed — it just
 * overwrites reward_text/ring_up_note/chosen_at with the new pick. Only the
 * (member_id, state='earned', options present, index in range) checks gate
 * it; there is no "already chosen" block.
 */
export async function chooseGrantOption(input: ChooseGrantOptionInput): Promise<ChooseGrantOptionResult> {
  const admin = createSupabaseAdminClient();
  const { data: grant, error } = await admin
    .from("reward_grants")
    .select("state, reward_options")
    .eq("id", input.grantId)
    .eq("member_id", input.memberId)
    .maybeSingle();
  if (error) throw error;
  if (!grant) return { ok: false, error: "Grant not found." };
  if (grant.state !== "earned") return { ok: false, error: "This reward isn't available to choose right now." };

  const options = grant.reward_options as { reward: string; ring_up_note?: string | null }[] | null;
  if (!options) return { ok: false, error: "This reward has no choice to make." };
  if (input.optionIndex < 0 || input.optionIndex >= options.length) return { ok: false, error: "Invalid choice." };

  const chosen = options[input.optionIndex];
  const { error: updateError } = await admin
    .from("reward_grants")
    .update({
      reward_text: chosen.reward,
      ring_up_note: chosen.ring_up_note ?? null,
      chosen_at: new Date().toISOString(),
    })
    .eq("id", input.grantId);
  if (updateError) throw updateError;

  return { ok: true, rewardText: chosen.reward, ringUpNote: chosen.ring_up_note ?? null };
}

// ---------------------------------------------------------------------------
// Pre-choice (WS-E item 3) — member_progress.choice_pref: a diner's advance
// pick for an upcoming (not-yet-earned) multi-option rung, settable from day
// one and changeable right up until the rung is reached. rewards.ts reads
// this at grant-materialization time and copies the pick onto the new grant
// (reward_text/ring_up_note/chosen_at) so the diner never sees an unchosen
// "reward or reward" grant they already told the app they wanted.
// Shape (migration comment, 20260720000000_plan_v3.sql):
//   {"version":1, "picks": {"<rung visits>:<cycle>": "<option reward text>"}}
// ---------------------------------------------------------------------------

export type ChoicePref = { version: 1; picks: Record<string, string> };

function prefKey(rungVisits: number, cycle: number): string {
  return `${rungVisits}:${cycle}`;
}

/** Parses member_progress.choice_pref jsonb, defaulting a missing/malformed value to an empty pref rather than throwing in a read path. */
export function parseChoicePref(json: unknown): ChoicePref {
  if (json && typeof json === "object" && "picks" in (json as Record<string, unknown>)) {
    const obj = json as { picks?: unknown };
    const picks = obj.picks && typeof obj.picks === "object" ? (obj.picks as Record<string, unknown>) : {};
    const clean: Record<string, string> = {};
    for (const [key, value] of Object.entries(picks)) {
      if (typeof value === "string") clean[key] = value;
    }
    return { version: 1, picks: clean };
  }
  return { version: 1, picks: {} };
}

/** The diner's stored advance pick for a given rung+lap, or null if none set. */
export function choicePrefFor(pref: ChoicePref | null | undefined, rungVisits: number, cycle: number): string | null {
  if (!pref) return null;
  return pref.picks[prefKey(rungVisits, cycle)] ?? null;
}

export type SetChoicePrefInput = { memberId: string; programId: string; rungVisits: number; cycle: number; optionReward: string };
export type SetChoicePrefResult = { ok: true } | { ok: false; error: string };

const SET_CHOICE_PREF_MAX_ATTEMPTS = 3;

/**
 * Stores a diner's advance pick for an upcoming rung. Validates the
 * rung/option pair against the program's real config (never trusts a
 * client-supplied option string blind) — same belt-and-braces posture as
 * chooseGrantOption's index-range check above.
 *
 * Lost-update guard (Codex #13): this reads the whole choice_pref document,
 * patches one key in memory, and writes the whole document back — a classic
 * read-modify-write. Two concurrent picks (e.g. two tabs, or a doubled
 * request) could otherwise read the same pre-image, each patch a different
 * key, and the second write silently clobber the first's key. We guard with
 * compare-and-swap: the UPDATE is conditioned on choice_pref still equalling
 * the exact pre-image we read (jsonb `=` is real deep equality, not text
 * comparison, so key order never causes a false mismatch). If another write
 * landed first, zero rows match, we re-read the fresh document and retry —
 * bounded to a few attempts, since a diner tapping "change my pick" has no
 * realistic sustained contention.
 */
export async function setChoicePref(input: SetChoicePrefInput): Promise<SetChoicePrefResult> {
  const admin = createSupabaseAdminClient();

  for (let attempt = 0; attempt < SET_CHOICE_PREF_MAX_ATTEMPTS; attempt++) {
    const { data: row, error } = await admin
      .from("member_progress")
      .select("choice_pref, reward_programs!inner(type, config)")
      .eq("member_id", input.memberId)
      .eq("program_id", input.programId)
      .maybeSingle();
    if (error) throw error;
    if (!row) return { ok: false, error: "You're not enrolled in this reward." };

    const program = row.reward_programs as unknown as { type: Parameters<typeof parseProgramConfig>[0]; config: unknown };
    const parsed = parseProgramConfig(program.type, program.config);
    if (parsed.type !== "visit_ladder") return { ok: false, error: "This reward has no choice to make." };

    const rung = parsed.config.rungs.find((r) => r.visits === input.rungVisits);
    if (!rung) return { ok: false, error: "That reward step doesn't exist." };
    if (!rung.options.some((o) => o.reward === input.optionReward)) return { ok: false, error: "Invalid choice." };

    const preImage = row.choice_pref;
    const pref = parseChoicePref(preImage);
    pref.picks[prefKey(input.rungVisits, input.cycle)] = input.optionReward;

    const base = admin
      .from("member_progress")
      .update({ choice_pref: pref, updated_at: new Date().toISOString() })
      .eq("member_id", input.memberId)
      .eq("program_id", input.programId);
    // jsonb equality needs the pre-image serialized: postgrest-js's .eq()
    // template-stringifies its value argument, which would otherwise send
    // the literal text "[object Object]" instead of the JSON document.
    const { data: updated, error: updateError } =
      preImage === null
        ? await base.is("choice_pref", null).select("member_id")
        : await base.eq("choice_pref", JSON.stringify(preImage)).select("member_id");
    if (updateError) throw updateError;
    if (updated && updated.length > 0) return { ok: true };
    // Lost the race — someone else wrote choice_pref between our read and
    // this update. Loop and retry against the fresh value.
  }

  return { ok: false, error: "Couldn't save your pick — please try again." };
}
