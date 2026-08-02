import type { RewardProgram } from "@/lib/booth/types";

export type OutstandingGrant = { id: string; memberName: string; expiresAt: string };
export type RewardsPageProgram = { program: RewardProgram; outstandingGrants: OutstandingGrant[] };

/** Program types whose config carries an expiry field (valid_days/ends_at) — eligible for the bulk Extend action. */
export const EXTENDABLE_PROGRAM_TYPES = new Set(["welcome", "come_back", "timed"]);
