import { notFound } from "next/navigation";
import Link from "next/link";
import { Section } from "@/components/kit";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { GeneratorClient } from "./generator-client";

const PROGRAM_TYPES = ["welcome", "visit_ladder", "birthday", "come_back"] as const;

export default async function GeneratePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const admin = createSupabaseAdminClient();
  const { data: restaurant } = await admin.from("restaurants").select("id, name, slug, menu_items").eq("slug", slug).maybeSingle();
  if (!restaurant) notFound();

  const { data: existingPrograms } = await admin
    .from("reward_programs")
    .select("type")
    .eq("restaurant_id", restaurant.id)
    .eq("active", true)
    .in("type", PROGRAM_TYPES);
  const existingActiveTypes = [...new Set((existingPrograms ?? []).map((p) => p.type as string))];

  return (
    <Section bg="paper">
      <Link href={`/internal/${slug}`} className="text-sm font-semibold underline">
        ← {restaurant.name}
      </Link>
      <h1 className="mt-2 font-display text-3xl font-extrabold">Setup generator</h1>
      <p className="mt-1 text-muted">Paste the call intake answers. Review and edit before applying — nothing writes until you hit Apply.</p>

      <GeneratorClient
        slug={slug}
        hasApiKey={Boolean(process.env.OPENAI_API_KEY)}
        menuItems={restaurant.menu_items ?? []}
        existingActiveTypes={existingActiveTypes}
      />
    </Section>
  );
}
