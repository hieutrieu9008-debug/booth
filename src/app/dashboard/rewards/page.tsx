import { requireOwnerRestaurant } from "@/lib/owner";
import { Section } from "@/components/kit";
import { getInactiveOfferDrafts, getOffersHomeData, getRewardsPageData } from "./data";
import { ProgramCard } from "./program-card";
import { OffersHome } from "./offers-home";

export default async function RewardsPage() {
  const restaurant = await requireOwnerRestaurant();
  const [programs, offerStats, drafts] = await Promise.all([
    getRewardsPageData(restaurant.id),
    getOffersHomeData(restaurant.id),
    getInactiveOfferDrafts(restaurant.id),
  ]);

  return (
    <Section bg="paper">
      <h1 className="font-display text-3xl font-extrabold">Rewards</h1>

      <div className="mt-8">
        <OffersHome stats={offerStats} drafts={drafts} />
      </div>

      <div className="mt-10 space-y-6">
        {programs.map(({ program, outstandingGrants }) => (
          <ProgramCard key={program.id} program={program} outstandingGrants={outstandingGrants} />
        ))}
      </div>
    </Section>
  );
}
