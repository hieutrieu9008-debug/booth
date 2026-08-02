import Link from "next/link";
import { Card, Section } from "@/components/kit";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { NewRestaurantForm } from "./new-restaurant-form";

export default async function InternalHomePage() {
  const admin = createSupabaseAdminClient();
  const { data: restaurants } = await admin
    .from("restaurants")
    .select("id, slug, name, created_at")
    .order("created_at", { ascending: false });

  const { data: memberRows } = await admin.from("members").select("restaurant_id");
  const memberCounts = new Map<string, number>();
  for (const row of memberRows ?? []) {
    const id = row.restaurant_id as string;
    memberCounts.set(id, (memberCounts.get(id) ?? 0) + 1);
  }

  return (
    <Section bg="paper">
      <h1 className="font-display text-3xl font-extrabold">Internal — Tenants</h1>
      <p className="mt-1 text-muted">Not customer-visible. Function over beauty.</p>

      <div className="mt-6 grid gap-4">
        {(restaurants ?? []).map((r) => (
          <Card key={r.id} border shadow className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <Link href={`/internal/${r.slug}`} className="font-display text-xl font-bold underline">
                {r.name}
              </Link>
              <p className="text-sm text-muted">
                {r.slug} · {memberCounts.get(r.id) ?? 0} members · created {new Date(r.created_at).toLocaleDateString("en-GB")}
              </p>
            </div>
            <Link href={`/internal/${r.slug}/generate`} className="text-sm font-semibold underline">
              Setup generator →
            </Link>
          </Card>
        ))}
        {(restaurants ?? []).length === 0 && <p className="text-muted">No restaurants yet — create one below.</p>}
      </div>

      <Card border shadow className="mt-10 max-w-2xl">
        <h2 className="font-display text-xl font-bold">New restaurant</h2>
        <NewRestaurantForm />
      </Card>
    </Section>
  );
}
