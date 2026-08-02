import type { LadderOption, VisitLadderConfig } from "./programs";
import type { MemberProgress } from "./types";

/**
 * PURE functions for visit-ladder math — no I/O, unit-testable. All grant
 * materialization / DB writes live in rewards.ts, which calls into these.
 */

export type DueLadderGrant = {
  rungIndex: number;
  cycle: number;
  slot: string;
  options: LadderOption[];
};

export type ProgressDisplay = {
  current: number;
  target: number;
  label: string;
  /** True once a looping ladder has finished its last rung this lap and is waiting on the next visit to start a fresh lap. */
  lapComplete: boolean;
  /** True only for a NON-looping ladder that has earned every rung — nothing left to unlock on this program, ever (WS-E: kills the dead stuck-fraction state). */
  completed: boolean;
};

/** Lap-local total: endowment counts toward lap 1 only. */
export function ladderTotals(config: VisitLadderConfig, progress: MemberProgress): number {
  const endowed = progress.cycle === 1 ? progress.endowed_count : 0;
  return endowed + progress.earned_count;
}

/** Every rung whose threshold has been reached this lap and hasn't already been granted. */
export function dueLadderGrants(
  config: VisitLadderConfig,
  progress: MemberProgress,
  existingSlots: Set<string>
): DueLadderGrant[] {
  const total = ladderTotals(config, progress);
  const cycle = progress.cycle;
  const due: DueLadderGrant[] = [];
  config.rungs.forEach((rung, rungIndex) => {
    if (rung.visits > total) return;
    const slot = `ladder:${rungIndex}:${cycle}`;
    if (existingSlots.has(slot)) return;
    due.push({ rungIndex, cycle, slot, options: rung.options });
  });
  return due;
}

/** True once a looping ladder has reached its last rung this lap. */
export function lapComplete(config: VisitLadderConfig, progress: MemberProgress): boolean {
  if (!config.loop) return false;
  const total = ladderTotals(config, progress);
  const lastRung = config.rungs[config.rungs.length - 1];
  return total >= lastRung.visits;
}

/** How much earned_count decreases when a lap rolls over (cycle -> cycle + 1). */
export function consumedOnLapReset(config: VisitLadderConfig, cycle: number): number {
  const lastRung = config.rungs[config.rungs.length - 1];
  const endowed = cycle === 1 ? config.endowed_start : 0;
  return lastRung.visits - endowed;
}

/** Exact progress numbers toward the next unearned rung this lap — never a range (PRD). */
export function progressDisplay(config: VisitLadderConfig, progress: MemberProgress): ProgressDisplay {
  const total = ladderTotals(config, progress);
  const nextRung = config.rungs.find((rung) => rung.visits > total);
  if (nextRung) {
    return { current: total, target: nextRung.visits, label: `${total} of ${nextRung.visits}`, lapComplete: false, completed: false };
  }
  const lastRung = config.rungs[config.rungs.length - 1];
  if (config.loop) {
    // Looping ladder, last rung reached this lap: honest "lap complete" state
    // rather than a misleading "0 visits to X" (the next lap hasn't started).
    return { current: lastRung.visits, target: lastRung.visits, label: "Lap complete", lapComplete: true, completed: false };
  }
  // Non-looping ladder, every rung already earned — honest "ladder complete"
  // state instead of a dead stuck fraction ("10 of 10" that never changes).
  return {
    current: lastRung.visits,
    target: lastRung.visits,
    label: `Ladder complete — ${config.rungs.length} reward${config.rungs.length === 1 ? "" : "s"} earned`,
    lapComplete: false,
    completed: true,
  };
}
