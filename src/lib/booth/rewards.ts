import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { choicePrefFor, parseChoicePref } from "./choice";
import { consumedOnLapReset, dueLadderGrants, lapComplete } from "./ladder";
import { parseProgramConfig } from "./programs";
import { newRewardToken } from "./tokens";
import type { MemberProgress, RewardProgram } from "./types";

export type NewGrant = {
  rewardText: string;
  ringUpNote: string | null;
  oneUseToken: string;
  slot: string;
  // True only when the diner still has an unchosen pick waiting (multi-option
  // grant with no chosen_at yet) — false for a fixed reward AND for a
  // multi-option grant the diner already pre-chose (choice.ts's
  // member_progress.choice_pref, copied on at earn time below). Callers
  // (engine.ts's notify copy) use this to decide "choose your reward" vs
  // "you've earned X" messaging.
  hasChoice: boolean;
};

type ProgressRow = MemberProgress & { reward_programs: RewardProgram };

// Loop until no lap rolls over, with a defensive high ceiling + error signal
// rather than a fixed small cap — a huge visit backlog (backfilled events,
// long absences) can span many laps and must not strand grants [Cx2-11].
const DEFENSIVE_ITERATION_CEILING = 50;

/**
 * Materializes every ladder reward a member has earned but not yet been
 * granted, rolling over completed laps as it goes. Idempotent — grant_slot's
 * unique index guarantees a second call creates nothing extra.
 *
 * `triggeringEventId`, when given, stamps earned_event_id on every ladder
 * grant inserted this call — the fn_undo_event dependency fn_undo_event
 * relies on to void grants when the causing visit is undone [Cx2-5].
 *
 * Only visit_ladder programs feed grants here: welcome/birthday/come_back/
 * anytime/timed grants are created at their own trigger points (join,
 * birthday cron, gone-quiet cron, etc.) — see members.ts for welcome.
 */
export async function materializeGrants(
  memberId: string,
  triggeringEventId?: string
): Promise<{ newGrants: NewGrant[] }> {
  const admin = createSupabaseAdminClient();
  const newGrants: NewGrant[] = [];

  let iteration = 0;
  for (; iteration < DEFENSIVE_ITERATION_CEILING; iteration++) {
    const { data: progressRows, error: progressError } = await admin
      .from("member_progress")
      .select("*, reward_programs!inner(*)")
      .eq("member_id", memberId)
      .eq("reward_programs.type", "visit_ladder")
      .eq("reward_programs.active", true);
    if (progressError) throw progressError;
    if (!progressRows || progressRows.length === 0) break;

    let anyLapCompleted = false;

    for (const row of progressRows as ProgressRow[]) {
      const { reward_programs: program, ...progress } = row;
      const parsed = parseProgramConfig(program.type, program.config);
      if (parsed.type !== "visit_ladder") continue;
      const config = parsed.config;

      const { data: existingGrantRows, error: existingGrantsError } = await admin
        .from("reward_grants")
        .select("grant_slot")
        .eq("member_id", memberId)
        .eq("program_id", program.id);
      if (existingGrantsError) throw existingGrantsError;
      const existingSlots = new Set((existingGrantRows ?? []).map((g) => g.grant_slot as string));

      const due = dueLadderGrants(config, progress, existingSlots);
      if (due.length > 0) {
        // WS-E item 3: copy the diner's pre-earn advance pick (if any) onto
        // the grant at the moment it's created, chosen_at stamped immediately
        // — so a diner who already told us their pick never sees an unchosen
        // "reward or reward" grant. Existing post-earn re-choice (choice.ts)
        // is unaffected: chosen_at just gets overwritten again if they change
        // their mind before redeeming.
        const pref = parseChoicePref(progress.choice_pref);
        const nowIso = new Date().toISOString();
        const rowsToInsert = due.map((grant) => {
          const hasChoice = grant.options.length > 1;
          const rungVisits = config.rungs[grant.rungIndex].visits;
          const preChosenReward = hasChoice ? choicePrefFor(pref, rungVisits, grant.cycle) : null;
          const preChosen = preChosenReward ? grant.options.find((o) => o.reward === preChosenReward) : undefined;
          return {
            restaurant_id: progress.restaurant_id,
            member_id: memberId,
            program_id: program.id,
            // Choice-aware grant text [Cx2-6/10]: a single option is the
            // reward outright; a pre-chosen multi-option pick is the chosen
            // option outright; an unchosen multi-option rung is staff-readable
            // pre-choice text, with the immutable snapshot kept for the
            // diner's later pick (choice.ts).
            reward_text: preChosen ? preChosen.reward : hasChoice ? grant.options.map((o) => o.reward).join(" or ") : grant.options[0].reward,
            ring_up_note: preChosen ? preChosen.ring_up_note ?? null : hasChoice ? null : grant.options[0].ring_up_note ?? null,
            reward_options: hasChoice ? grant.options : null,
            chosen_at: preChosen ? nowIso : null,
            one_use_token: newRewardToken(),
            grant_slot: grant.slot,
            // visit_ladder's documented config shape has no valid_days field
            // (only welcome/come_back do) — ladder grants never expire.
            expires_at: null,
            earned_at: nowIso,
            earned_event_id: triggeringEventId ?? null,
          };
        });

        const { data: inserted, error: insertError } = await admin
          .from("reward_grants")
          .upsert(rowsToInsert, { onConflict: "member_id,program_id,grant_slot", ignoreDuplicates: true })
          .select("reward_text, ring_up_note, reward_options, chosen_at, one_use_token, grant_slot");
        if (insertError) throw insertError;

        for (const g of inserted ?? []) {
          newGrants.push({
            rewardText: g.reward_text,
            ringUpNote: g.ring_up_note,
            oneUseToken: g.one_use_token,
            slot: g.grant_slot,
            hasChoice: g.reward_options != null && g.chosen_at == null,
          });
        }
      }

      if (lapComplete(config, progress)) {
        anyLapCompleted = true;
        const consumed = consumedOnLapReset(config, progress.cycle);
        // Optimistic conditional update: only applies if nothing else has
        // already rolled this member/program past `progress.cycle`. If 0
        // rows match, another writer won the race — the next iteration
        // re-reads the fresh row and recomputes from there.
        await admin
          .from("member_progress")
          .update({
            earned_count: progress.earned_count - consumed,
            cycle: progress.cycle + 1,
            updated_at: new Date().toISOString(),
          })
          .eq("member_id", memberId)
          .eq("program_id", program.id)
          .eq("cycle", progress.cycle)
          .gte("earned_count", consumed);
      }
    }

    // Re-run grant computation once after a lap reset so a huge visit
    // backlog (e.g. a backfilled event) can't strand rewards past the rung
    // that triggered the rollover.
    if (!anyLapCompleted) break;
  }

  if (iteration >= DEFENSIVE_ITERATION_CEILING) {
    console.error(
      `materializeGrants: hit the defensive iteration ceiling (${DEFENSIVE_ITERATION_CEILING}) for member ${memberId} — possible runaway lap rollover`
    );
  }

  return { newGrants };
}

// ---------------------------------------------------------------------------
// Custom per-member offers (Plan V3 — WS-C deferral)
// ---------------------------------------------------------------------------

const CUSTOM_BUCKET_NAME = "Custom offers";

/**
 * Lazily fetches (or creates) this restaurant's single hidden `type: 'custom'`
 * bucket program — the grant-parentage for one-off, owner-authored per-member
 * offers. Always inserted `active: false` so it can never surface as a live
 * offer or campaign-attach target (both of those paths only ever query
 * anytime/timed + active=true). The partial unique index from migration
 * 20260721000000 guarantees at most one bucket per restaurant even under a
 * concurrent race — a 23505 on insert means another call just created it, so
 * this re-fetches rather than erroring.
 */
export async function getOrCreateCustomBucket(restaurantId: string): Promise<string> {
  const admin = createSupabaseAdminClient();
  const { data: existing, error: existingError } = await admin
    .from("reward_programs")
    .select("id")
    .eq("restaurant_id", restaurantId)
    .eq("type", "custom")
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return existing.id;

  const { data: inserted, error: insertError } = await admin
    .from("reward_programs")
    .insert({ restaurant_id: restaurantId, type: "custom", name: CUSTOM_BUCKET_NAME, active: false, config: {} })
    .select("id")
    .single();
  if (insertError) {
    if (insertError.code !== "23505") throw insertError;
    const { data: raced, error: racedError } = await admin
      .from("reward_programs")
      .select("id")
      .eq("restaurant_id", restaurantId)
      .eq("type", "custom")
      .single();
    if (racedError) throw racedError;
    return raced.id;
  }
  return inserted.id;
}
