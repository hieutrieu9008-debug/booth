import { z } from "zod";

/**
 * Optional filters layered on top of a campaign's base segment
 * (CampaignAudience) — see supabase/migrations/20260717000000_audience_filters.sql
 * and engine.ts's segmentMembers. All fields optional; every field present is
 * ANDed together, applied on top of the base segment. opted_out exclusion is
 * absolute and applied before any of these (segmentMembers' base query).
 */
export const audienceFiltersSchema = z.object({
  redeemed_within_days: z.number().int().positive().optional(),
  redeemed_program_id: z.string().uuid().optional(),
  min_visits: z.number().int().positive().optional(),
  joined_within_days: z.number().int().positive().optional(),
  birthday_this_month: z.boolean().optional(),
  near_reward: z.boolean().optional(),
});
export type AudienceFilters = z.infer<typeof audienceFiltersSchema>;

/** True when every field is undefined/false — equivalent to "no filters". */
export function isEmptyAudienceFilters(filters: AudienceFilters | null | undefined): boolean {
  if (!filters) return true;
  return (
    filters.redeemed_within_days === undefined &&
    filters.redeemed_program_id === undefined &&
    filters.min_visits === undefined &&
    filters.joined_within_days === undefined &&
    !filters.birthday_this_month &&
    !filters.near_reward
  );
}

/** Compact human fragments for the blast history list, e.g. ["redeemed in last 14d", "3+ visits"]. */
export function describeAudienceFilters(
  filters: AudienceFilters | null | undefined,
  programNameById: Record<string, string> = {},
): string[] {
  if (!filters) return [];
  const parts: string[] = [];
  if (filters.redeemed_within_days !== undefined) parts.push(`redeemed in last ${filters.redeemed_within_days}d`);
  if (filters.redeemed_program_id !== undefined) {
    const name = programNameById[filters.redeemed_program_id];
    parts.push(name ? `redeemed ${name}` : "redeemed a specific offer");
  }
  if (filters.min_visits !== undefined) parts.push(`${filters.min_visits}+ visits`);
  if (filters.joined_within_days !== undefined) parts.push(`joined in last ${filters.joined_within_days}d`);
  if (filters.birthday_this_month) parts.push("birthday this month");
  if (filters.near_reward) parts.push("near next reward");
  return parts;
}
