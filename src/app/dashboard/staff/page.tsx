import { requireOwnerRestaurant } from "@/lib/owner";
import { Section } from "@/components/kit";
import { getStaffPins } from "./data";
import { PinsClient } from "./pins-client";

export default async function StaffPage() {
  const restaurant = await requireOwnerRestaurant();
  const pins = await getStaffPins(restaurant.id);

  return (
    <Section bg="paper">
      <h1 className="font-display text-3xl font-extrabold">Staff</h1>
      <PinsClient initialPins={pins} />
    </Section>
  );
}
