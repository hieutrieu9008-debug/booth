import { requireOwnerRestaurant } from "@/lib/owner";
import { Button, Card, Section } from "@/components/kit";
import { getCadenceSignal, getDrawerDetails, getOverviewTiles, getOwnerRestaurantFull } from "@/lib/booth/dashboard-data";
import { getWeeklySeries } from "@/lib/booth/chart-data";
import { formatCurrency } from "@/lib/booth/format";
import { Drawer, SeeWhosCloseButton } from "./drawer";
import { Charts } from "./charts";

// OwnerRestaurantFull (src/lib/booth/dashboard-data.ts, out of this chunk's
// fence) doesn't project `country` — formatCurrency doesn't need it to
// disambiguate GBP/USD, so it's omitted here rather than widening that
// query. Flagged for the orchestrator: add `country` to that select if a
// future currency needs it to pick a locale.
const money = (n: number, currency: string) => formatCurrency(n, currency);

export default async function OverviewPage() {
  const owner = await requireOwnerRestaurant();
  const restaurant = await getOwnerRestaurantFull(owner.id);
  const [tiles, cadence, drawer, series] = await Promise.all([
    getOverviewTiles(restaurant),
    getCadenceSignal(restaurant.id),
    getDrawerDetails(restaurant),
    getWeeklySeries(restaurant.id, restaurant.timezone),
  ]);

  return (
    <Section bg="paper">
      <h1 className="font-display text-3xl font-extrabold">Overview</h1>

      {cadence.show && (
        <Card bg="paper" border className="mt-6 !bg-butter">
          <p className="font-semibold">
            You&apos;ve sent about {cadence.avgPerMember.toFixed(1)} promos per member this month. Above 4, opt-outs
            climb. Your call.
          </p>
        </Card>
      )}

      <div className="mt-8 grid gap-6 sm:grid-cols-3">
        <Card shadow border>
          <p className="text-sm font-semibold text-muted">Customers brought back</p>
          <p className="mt-2 font-display text-6xl font-extrabold">{tiles.customersBack.count}</p>
          {tiles.customersBack.estGbp != null && tiles.customersBack.avgTicket != null && (
            <p className="mt-2 text-sm text-muted">
              {money(tiles.customersBack.estGbp, restaurant.currency)} est. Estimate at {money(tiles.customersBack.avgTicket, restaurant.currency)} avg ticket
            </p>
          )}
          <Button href="/dashboard/messages" variant="secondary" className="mt-6 w-full">
            Text your list
          </Button>
        </Card>

        <Card shadow border>
          <p className="text-sm font-semibold text-muted">Your list</p>
          <p className="mt-2 font-display text-6xl font-extrabold">{tiles.list.count}</p>
          <p className="mt-2 text-sm text-muted">+{tiles.list.newThisMonth} this month</p>
          <Button href="/dashboard/signs" variant="secondary" className="mt-6 w-full">
            Print more signs
          </Button>
        </Card>

        <Card shadow border>
          <p className="text-sm font-semibold text-muted">Regulars rescued</p>
          <p className="mt-2 font-display text-6xl font-extrabold">{tiles.regularsRescued.count}</p>
          <p className="mt-2 text-sm text-muted">Gone quiet, then back this month</p>
          <SeeWhosCloseButton />
        </Card>
      </div>

      <Charts series={series} />

      <Drawer details={drawer} />
    </Section>
  );
}
