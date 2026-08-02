import Link from "next/link";
import { requireOwnerRestaurant } from "@/lib/owner";
import { Card, Section } from "@/components/kit";
import { getOwnerRestaurantFull, searchMembers, type MemberSavedView } from "@/lib/booth/dashboard-data";
import { MembersFilters } from "./filters";

const VALID_VIEWS: MemberSavedView[] = ["close_to_reward", "gone_quiet", "birthday_month"];

const formatDate = (value: string | null) =>
  value ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(value)) : "never";

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; view?: string }>;
}) {
  const owner = await requireOwnerRestaurant();
  const restaurant = await getOwnerRestaurantFull(owner.id);
  const params = await searchParams;
  const view = VALID_VIEWS.includes(params.view as MemberSavedView) ? (params.view as MemberSavedView) : undefined;
  const rows = await searchMembers(restaurant, { query: params.q, view });

  return (
    <Section bg="paper">
      <h1 className="font-display text-3xl font-extrabold">Members</h1>
      <MembersFilters query={params.q ?? ""} view={view} />

      <div className="mt-6">
        {rows.length === 0 ? (
          <Card border className="text-center">
            <p className="text-base text-muted">No members match right now.</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {rows.map((m) => (
              <Link key={m.memberId} href={`/dashboard/members/${m.memberId}`} className="block">
                <Card border shadow className="!p-4 transition-transform hover:-translate-y-0.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-display text-base font-bold">{m.name}</p>
                      <p className="text-sm text-muted">{m.phone}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold">
                        {m.closeLabel ?? m.progressLabel ?? "No active ladder"}
                      </p>
                      <p className="text-sm text-muted">
                        last visit {formatDate(m.lastVisitAt)} ·{" "}
                        {m.consent === "opted_out" ? "opted out" : "opted in"}
                      </p>
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </Section>
  );
}
