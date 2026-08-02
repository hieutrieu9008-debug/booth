import { notFound } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { checkStaffSession } from "@/lib/booth/staff-session";
import { peekOwnerRestaurant } from "@/lib/owner";
import { PinGate } from "./pin-gate";
import { StaffClient } from "./staff-client";

export const dynamic = "force-dynamic";

async function getRestaurant(slug: string) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("restaurants")
    .select("id, slug, name, phone_prefix")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export default async function StaffPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const restaurant = await getRestaurant(slug);
  if (!restaurant) notFound();

  const session = await checkStaffSession(slug, restaurant.id);
  if (!session.unlocked) {
    return <PinGate slug={slug} restaurantName={restaurant.name} />;
  }

  // F1 "Owner-mode entry" (SPEC-WSB-F.md item 3): peek, don't require — the
  // scanner must work with no owner session at all. Only show the link when
  // the signed-in owner's restaurant matches THIS staff page's restaurant,
  // so an owner signed into restaurant A never sees a dashboard link while
  // scanning at restaurant B.
  const owner = await peekOwnerRestaurant();
  const ownerDashboardHref = owner && owner.id === restaurant.id ? "/dashboard" : null;

  return (
    <StaffClient
      slug={slug}
      restaurantId={restaurant.id}
      restaurantName={restaurant.name}
      phonePrefix={restaurant.phone_prefix}
      ownerDashboardHref={ownerDashboardHref}
    />
  );
}
