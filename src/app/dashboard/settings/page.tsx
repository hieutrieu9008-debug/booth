import { requireOwnerRestaurant } from "@/lib/owner";
import { Section } from "@/components/kit";
import { getSettingsPageData } from "./data";
import { SettingsForm } from "./settings-form";

export default async function SettingsPage() {
  const restaurant = await requireOwnerRestaurant();
  const data = await getSettingsPageData(restaurant.id);

  return (
    <Section bg="paper">
      <h1 className="font-display text-3xl font-extrabold">Settings</h1>
      <SettingsForm data={data} />
    </Section>
  );
}
