import { requireOwnerRestaurant } from "@/lib/owner";
import { signOutAction } from "./actions";
import { NavTabs } from "./nav-tabs";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const restaurant = await requireOwnerRestaurant();

  return (
    <div className="min-h-screen bg-paper text-ink">
      <header className="border-b-2 border-line bg-cream">
        <div className="flex items-center justify-between px-6 py-4">
          <p className="font-display text-lg font-bold">{restaurant.name}</p>
          <form action={signOutAction}>
            <button
              type="submit"
              className="text-sm font-semibold text-muted underline underline-offset-2 hover:text-ink"
            >
              Sign out
            </button>
          </form>
        </div>
        <NavTabs />
      </header>
      <main>{children}</main>
    </div>
  );
}
