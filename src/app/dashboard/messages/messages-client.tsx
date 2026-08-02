"use client";

import { useState } from "react";
import type { CadenceSignal } from "@/lib/booth/dashboard-data";
import { Calendar } from "./calendar";
import { Composer } from "./composer";
import type { OfferOption, RestaurantScheduleContext, SegmentCounts } from "./data";

export function MessagesClient({
  segmentCounts,
  offers,
  cadence,
  filterablePrograms,
  schedule,
}: {
  segmentCounts: SegmentCounts;
  offers: OfferOption[];
  cadence: CadenceSignal;
  filterablePrograms: OfferOption[];
  schedule: RestaurantScheduleContext;
}) {
  const [prefillDate, setPrefillDate] = useState<string | undefined>(undefined);
  const [composerKey, setComposerKey] = useState(0);

  function handleSelectDate(date: string) {
    setPrefillDate(date);
    setComposerKey((k) => k + 1); // remount so a second click on a new date re-applies the prefill even if the composer's own state has since diverged
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,320px)_1fr]">
      <Calendar
        country={schedule.country}
        initialYear={schedule.currentYear}
        initialMonth={schedule.currentMonth}
        onSelectDate={handleSelectDate}
      />
      <Composer
        key={composerKey}
        segmentCounts={segmentCounts}
        offers={offers}
        cadence={cadence}
        filterablePrograms={filterablePrograms}
        schedule={schedule}
        prefillDate={prefillDate}
      />
    </div>
  );
}
