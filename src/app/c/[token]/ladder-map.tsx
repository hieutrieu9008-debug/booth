import { Card } from "@/components/kit";
import { choicePrefFor, parseChoicePref } from "@/lib/booth/choice";
import { ladderTotals, type ProgressDisplay } from "@/lib/booth/ladder";
import type { VisitLadderConfig } from "@/lib/booth/programs";
import type { MemberProgress } from "@/lib/booth/types";
import { PreChoicePicker } from "./pre-choice-picker";

function rungCopy(options: { reward: string }[]): string {
  return options.length > 1 ? `your pick: ${options.map((o) => o.reward).join(" or ")}` : options[0].reward;
}

/**
 * The whole ladder, not just the next reward (SPEC-WS2 §Member card 3):
 * earned rungs, current progress, the next rung, and later bigger rewards
 * (pull-through). Loop ladders explain the loop plainly at the bottom.
 */
export function LadderMap({
  config,
  progress,
  display,
  programId,
  token,
}: {
  config: VisitLadderConfig;
  progress: MemberProgress;
  display: ProgressDisplay;
  programId: string;
  token: string;
}) {
  const total = ladderTotals(config, progress);
  const nextRung = config.rungs.find((rung) => rung.visits > total);
  const pref = parseChoicePref(progress.choice_pref);

  return (
    <Card border className="mt-4">
      {/* WS-E item 1: kill the dead stuck fraction — completed/lap-complete
          states get their honest label instead of "current of target". */}
      <p className="font-display text-5xl font-extrabold">
        {display.completed || display.lapComplete ? display.label : `${display.current} of ${display.target}`}
      </p>
      <p className="mt-2 text-lg">
        {display.completed
          ? "You've earned every reward on this card."
          : display.lapComplete
            ? "Lap complete. A fresh lap starts on your next visit."
            : `${Math.max(0, display.target - display.current)} visits to ${rungCopy(nextRung?.options ?? config.rungs.at(-1)!.options)}`}
      </p>
      {/* WS-E item 1: ONE unmistakable filled style (ink) for earned pips —
          endowment is marked with a small "H" label, never a competing
          color, per DESIGN.md's pip-treatment rule. */}
      <div className="mt-5 flex flex-wrap gap-2" aria-label={`${display.current} of ${display.target} visits`}>
        {Array.from({ length: display.target }, (_, i) => {
          const earned = i < display.current;
          const isEndowed = i < progress.endowed_count && progress.cycle === 1;
          return (
            <span
              key={i}
              className={`relative flex h-9 w-9 items-center justify-center rounded-full border-2 border-ink text-xs font-bold ${
                earned ? "bg-ink text-cream" : "bg-cream text-ink"
              }`}
            >
              {i + 1}
              {isEndowed && (
                <span
                  aria-hidden="true"
                  className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-ink bg-paper text-[9px] font-bold text-ink"
                >
                  H
                </span>
              )}
              {isEndowed && <span className="sr-only">head start</span>}
            </span>
          );
        })}
      </div>
      {progress.endowed_count > 0 && progress.cycle === 1 && <p className="mt-2 text-xs font-semibold text-muted">H = head start</p>}

      <ul className="mt-6 space-y-3 border-t-2 border-line pt-5">
        {config.rungs.map((rung, index) => {
          const earned = rung.visits <= total;
          const isNext = !earned && rung.visits === nextRung?.visits;
          const hasChoice = rung.options.length > 1;
          return (
            <li key={index} className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span className={`text-base ${earned ? "text-muted line-through" : isNext ? "font-semibold" : ""}`}>
                {rung.visits} visits: {rungCopy(rung.options)}
              </span>
              <span
                className={`shrink-0 self-start rounded-full border-2 border-ink px-2.5 py-0.5 font-display text-xs font-bold sm:self-auto ${
                  earned ? "bg-peach" : isNext ? "bg-coral text-cream" : "bg-cream"
                }`}
              >
                {earned ? "earned" : isNext ? "next" : "later"}
              </span>
              {/* WS-E item 3: pre-choice, only on the upcoming (not-yet-earned) rung */}
              {!earned && hasChoice && (
                <PreChoicePicker
                  token={token}
                  programId={programId}
                  rungVisits={rung.visits}
                  cycle={progress.cycle}
                  options={rung.options}
                  initialPick={choicePrefFor(pref, rung.visits, progress.cycle)}
                />
              )}
            </li>
          );
        })}
      </ul>

      {config.loop && (
        <p className="mt-5 text-sm text-muted">
          Once you reach {config.rungs.at(-1)!.visits} visits your card loops back around. You&apos;ll keep earning toward {rungCopy(config.rungs[0].options)} again.
        </p>
      )}
    </Card>
  );
}
