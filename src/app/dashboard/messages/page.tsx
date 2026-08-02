import { requireOwnerRestaurant } from "@/lib/owner";
import { Section } from "@/components/kit";
import { getCadenceSignal } from "@/lib/booth/dashboard-data";
import {
  getAttachableOffers,
  getMessageHistory,
  getFilterablePrograms,
  getRestaurantScheduleContext,
  getSegmentCounts,
} from "./data";
import { MessagesClient } from "./messages-client";
import { History } from "./history";

export default async function MessagesPage() {
  const restaurant = await requireOwnerRestaurant();
  const [segmentCounts, offers, cadence, messages, filterablePrograms, scheduleContext] = await Promise.all([
    getSegmentCounts(restaurant.id),
    getAttachableOffers(restaurant.id),
    getCadenceSignal(restaurant.id),
    getMessageHistory(restaurant.id),
    getFilterablePrograms(restaurant.id),
    getRestaurantScheduleContext(restaurant.id),
  ]);

  return (
    <Section bg="paper">
      <h1 className="font-display text-3xl font-extrabold">Messages</h1>
      <div className="mt-8">
        <MessagesClient
          segmentCounts={segmentCounts}
          offers={offers}
          cadence={cadence}
          filterablePrograms={filterablePrograms}
          schedule={scheduleContext}
        />
      </div>
      <div className="mt-10">
        <h2 className="font-display text-xl font-bold">History</h2>
        <History messages={messages} />
      </div>
    </Section>
  );
}
