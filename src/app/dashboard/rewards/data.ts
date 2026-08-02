import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import type { RewardProgram } from "@/lib/booth/types";
import type { RewardsPageProgram } from "./shared";

export async function getRewardsPageData(restaurantId: string): Promise<RewardsPageProgram[]> {
  const admin = createSupabaseAdminClient();
  // 'custom' is the hidden per-member-offer bucket (Plan V3) — grant
  // parentage only, never a program the owner sees/manages on this page.
  const { data: programRows, error: programsError } = await admin
    .from("reward_programs")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .neq("type", "custom")
    .order("created_at", { ascending: true });
  if (programsError) throw programsError;
  const programs = (programRows ?? []) as RewardProgram[];

  const result: RewardsPageProgram[] = [];
  for (const program of programs) {
    const { data: grantRows, error: grantsError } = await admin
      .from("reward_grants")
      .select("id, expires_at, members(name)")
      .eq("program_id", program.id)
      .eq("state", "earned")
      .not("expires_at", "is", null)
      .order("expires_at", { ascending: true })
      .limit(25);
    if (grantsError) throw grantsError;
    const outstandingGrants = (grantRows ?? []).map((g) => ({
      id: g.id as string,
      memberName: (g.members as unknown as { name: string } | null)?.name ?? "Unknown",
      expiresAt: g.expires_at as string,
    }));
    result.push({ program, outstandingGrants });
  }
  return result;
}

// ---------------------------------------------------------------------------
// WS-C — "Live offers" section (every active anytime/timed program's stats)
// ---------------------------------------------------------------------------

export type OfferStats = {
  program: RewardProgram;
  issued: number;
  active: number;
  redeemed: number;
  /** Percent, rounded to 1dp; null when issued is 0 ("—" in the UI, never a divide-by-zero). */
  redemptionRate: number | null;
  attributedVisits: number;
};

/** Inactive anytime/timed programs (Codex #5) — mainly duplicates the owner hasn't switched on yet. Surfaced in offers-home.tsx's "Inactive drafts" subsection so the duplicate success copy's "find it below" is actually true. */
export type InactiveOfferDraft = { id: string; name: string; type: "anytime" | "timed"; summary: string };

export async function getInactiveOfferDrafts(restaurantId: string): Promise<InactiveOfferDraft[]> {
  const admin = createSupabaseAdminClient();
  const { data: programRows, error } = await admin
    .from("reward_programs")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .in("type", ["anytime", "timed"])
    .eq("active", false)
    .order("created_at", { ascending: true });
  if (error) throw error;
  const fmt = (v: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(v));
  return ((programRows ?? []) as RewardProgram[]).map((program) => {
    const c = program.config as Record<string, unknown>;
    const summary =
      program.type === "anytime"
        ? `${c.reward}, up to ${c.per_member_limit} per member`
        : `${c.reward}, ${fmt(c.starts_at as string)} – ${fmt(c.ends_at as string)}`;
    return { id: program.id, name: program.name, type: program.type as "anytime" | "timed", summary };
  });
}

export async function getOffersHomeData(restaurantId: string): Promise<OfferStats[]> {
  const admin = createSupabaseAdminClient();
  const { data: programRows, error } = await admin
    .from("reward_programs")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .in("type", ["anytime", "timed"])
    .eq("active", true)
    .order("created_at", { ascending: true });
  if (error) throw error;
  const programs = (programRows ?? []) as RewardProgram[];

  const stats: OfferStats[] = [];
  for (const program of programs) {
    const { count: issued, error: issuedError } = await admin
      .from("reward_grants")
      .select("id", { count: "exact", head: true })
      .eq("program_id", program.id);
    if (issuedError) throw issuedError;

    const { count: active, error: activeError } = await admin
      .from("reward_grants")
      .select("id", { count: "exact", head: true })
      .eq("program_id", program.id)
      .eq("state", "earned")
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
    if (activeError) throw activeError;

    const { data: redeemedRows, error: redeemedError } = await admin
      .from("reward_grants")
      .select("redeemed_event_id")
      .eq("program_id", program.id)
      .eq("state", "redeemed");
    if (redeemedError) throw redeemedError;
    const redeemed = redeemedRows?.length ?? 0;

    // Attributed visits: fn_redeem_grant auto-adds a visit event whose
    // related_event_id points back at the redemption event (see
    // ARCHITECTURE.md's events spine) — count those for this program's
    // redemptions.
    const redemptionEventIds = (redeemedRows ?? [])
      .map((r) => r.redeemed_event_id as string | null)
      .filter((v): v is string => !!v);
    let attributedVisits = 0;
    if (redemptionEventIds.length > 0) {
      const { count, error: visitError } = await admin
        .from("events")
        .select("id", { count: "exact", head: true })
        .eq("type", "visit")
        .in("related_event_id", redemptionEventIds);
      if (visitError) throw visitError;
      attributedVisits = count ?? 0;
    }

    stats.push({
      program,
      issued: issued ?? 0,
      active: active ?? 0,
      redeemed,
      redemptionRate: issued && issued > 0 ? Math.round((redeemed / issued) * 1000) / 10 : null,
      attributedVisits,
    });
  }
  return stats;
}
