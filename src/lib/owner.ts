import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase/server";

export type OwnerRestaurant = {
  id: string;
  slug: string;
  name: string;
};

/**
 * Resolves the signed-in owner's restaurant, redirecting to /login when
 * there's no session or no restaurant row for that user. Cached per-request
 * so dashboard layout + page can both call it without a duplicate lookup.
 */
export const requireOwnerRestaurant = cache(async (): Promise<OwnerRestaurant> => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createSupabaseAdminClient();
  const { data: restaurant } = await admin
    .from("restaurants")
    .select("id, slug, name")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!restaurant) redirect("/login");

  return restaurant;
});

/**
 * Non-redirecting variant of requireOwnerRestaurant (SPEC-WSB-F.md WS-F item
 * 3, "F1 — Owner-mode entry"): the staff scanner must render fine with no
 * owner session at all, so it peeks for one instead of requiring it. Returns
 * null on no session / no matching restaurant row rather than redirecting.
 */
export const peekOwnerRestaurant = cache(async (): Promise<OwnerRestaurant | null> => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const admin = createSupabaseAdminClient();
  const { data: restaurant } = await admin
    .from("restaurants")
    .select("id, slug, name")
    .eq("owner_id", user.id)
    .maybeSingle();
  return restaurant ?? null;
});
