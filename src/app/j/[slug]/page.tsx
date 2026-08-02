import { notFound } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { primaryBrandColor } from "@/lib/booth/branding";
import { parseProgramConfig, resolveJoinPage, joinPageSchema, type JoinPageRenderModel } from "@/lib/booth/programs";
import type { RewardProgram } from "@/lib/booth/types";
import { JoinForm } from "./join-form";

const VIP_DEFAULT_HEADLINE = "Join the VIP list: first to know about events, new items, and deals";

/** Ladder-specific copy for the render model — kept out of join-form.tsx so vip/custom never touch it. */
function ladderCopy(program: RewardProgram): { rewardCopy: string; endowment: { current: number; target: number } | null } {
  const parsed = parseProgramConfig(program.type, program.config);
  if (parsed.type !== "visit_ladder") return { rewardCopy: "your first reward", endowment: null };
  const firstRung = parsed.config.rungs[0];
  const rewardCopy =
    firstRung.options.length > 1 ? `your pick of ${firstRung.options.map((o) => o.reward).join(" or ")}` : firstRung.options[0].reward;
  const endowment = parsed.config.endowed_start > 0 ? { current: parsed.config.endowed_start, target: firstRung.visits } : { current: 0, target: firstRung.visits };
  return { rewardCopy, endowment };
}

export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ qa?: string }>;
}) {
  const { slug } = await params;
  const { qa } = await searchParams;
  const admin = createSupabaseAdminClient();
  const { data: restaurant } = await admin
    .from("restaurants")
    .select("id, name, brand_color, brand_colors, phone_prefix, country, logo_url, background_url, join_page")
    .eq("slug", slug)
    .maybeSingle();
  if (!restaurant) notFound();

  const brandColor = primaryBrandColor(restaurant);
  const { data: programRows } = await admin
    .from("reward_programs")
    .select("*")
    .eq("restaurant_id", restaurant.id)
    .eq("type", "visit_ladder")
    .eq("active", true);
  const activeLadders = (programRows ?? []) as RewardProgram[];
  const joinPage = restaurant.join_page ? joinPageSchema.parse(restaurant.join_page) : null;
  const renderModel: JoinPageRenderModel = resolveJoinPage(joinPage, activeLadders);
  const ladder = renderModel.magnet === "ladder" ? ladderCopy(renderModel.program) : null;

  return (
    <main className="min-h-screen bg-paper px-6 py-10 text-ink">
      <div className="mx-auto max-w-md">
        {restaurant.background_url && (
          <div className="relative h-36 w-full overflow-hidden rounded-card border-2 border-ink">
            {/* Framed/washed panel — never full-bleed behind text (DESIGN.md ban). */}
            <img src={restaurant.background_url} alt="" className="h-full w-full object-cover" />
            <div className="absolute inset-0" style={{ backgroundColor: brandColor, opacity: 0.35 }} />
          </div>
        )}
        <div className="mt-6 flex items-center gap-3">
          {restaurant.logo_url ? (
            <img src={restaurant.logo_url} alt={`${restaurant.name} logo`} className="h-11 w-11 shrink-0 rounded-full border-2 border-ink object-cover" />
          ) : (
            <span aria-label="Restaurant brand colour" className="h-3 w-3 shrink-0 rounded-full border border-ink" style={{ backgroundColor: brandColor }} />
          )}
          <h1 className="font-display text-4xl font-extrabold">{restaurant.name}</h1>
        </div>

        {ladder && (
          <>
            <p className="mt-2 text-lg text-muted">Rewards for coming back</p>
            <p className="mt-6 font-display text-2xl font-extrabold">
              {ladder.endowment && ladder.endowment.current > 0
                ? `${ladder.endowment.current} of ${ladder.endowment.target} toward ${ladder.rewardCopy}, already stamped`
                : `${ladder.endowment?.current ?? 0} of ${ladder.endowment?.target ?? 0} toward ${ladder.rewardCopy}`}
            </p>
          </>
        )}
        {renderModel.magnet === "vip" && <p className="mt-4 font-display text-2xl font-extrabold">{renderModel.headline ?? VIP_DEFAULT_HEADLINE}</p>}
        {renderModel.magnet === "custom" && (
          <>
            {renderModel.headline && <p className="mt-4 font-display text-2xl font-extrabold">{renderModel.headline}</p>}
            <p className="mt-3 text-lg">{renderModel.customText}</p>
          </>
        )}

        <ul className="mt-8 space-y-2 rounded-card border-2 border-ink bg-cream p-5 text-base">
          <li>· Rewards that build every time you visit</li>
          <li>· Offers and news by text, before anyone else</li>
          <li>· Reply STOP any time to opt out</li>
        </ul>

        <JoinForm
          slug={slug}
          restaurantName={restaurant.name}
          phonePrefix={restaurant.phone_prefix}
          country={restaurant.country}
          endowment={ladder?.endowment?.current ? ladder.endowment : null}
          rewardCopy={ladder?.rewardCopy ?? null}
          qaPreviewSuccess={
            qa === "success" && process.env.NODE_ENV !== "production"
              ? { name: "Alex", phone: "+447700900000", cardUrl: "#", welcomeReward: ladder?.rewardCopy ?? null, repeatJoin: false }
              : undefined
          }
        />
      </div>
    </main>
  );
}
