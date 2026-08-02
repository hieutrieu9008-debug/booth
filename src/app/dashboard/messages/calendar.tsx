"use client";

import { useEffect, useState, useTransition } from "react";
import { Button, Card } from "@/components/kit";
import { notableDatesForCountry, type NotableDateCountry } from "@/lib/booth/notable-dates";
import { getCalendarMonthDotsAction, type CalendarDots } from "./calendar-data";

// timeZone: "UTC" is required here — the value being formatted is a
// deliberately-constructed UTC-anchored calendar marker (Date.UTC(year,
// month-1, 1)), not a real instant. Without pinning it, Intl falls back to
// the viewer's own device timezone and can render the wrong month for any
// viewer west of UTC (e.g. showing "June" for a UTC July 1 00:00 marker in a
// UTC-5 browser) — exactly the class of bug Codex #7 exists to close, so the
// label must not reintroduce a device-timezone dependency of its own.
const MONTH_LABEL = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toDateKey(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** JS getUTCDay() is 0=Sun..6=Sat. Returns how many blank leading cells a month needs for the given week-start convention. */
function leadingBlanks(year: number, month: number, weekStart: "mon" | "sun"): number {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  if (weekStart === "sun") return firstWeekday;
  return (firstWeekday + 6) % 7; // shift so Monday = 0
}

const WEEKDAY_LABELS: Record<"mon" | "sun", string[]> = {
  mon: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  sun: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
};

export function Calendar({
  country,
  initialYear,
  initialMonth,
  onSelectDate,
}: {
  /** GB gets Monday-start weeks + the GB notable-date set; anything else (US) gets Sunday-start + the US set. */
  country: string;
  /** Restaurant-local current year/month (Codex #7) — server-supplied via getRestaurantScheduleContext's localYMD, never the browser's UTC date. */
  initialYear: number;
  initialMonth: number;
  onSelectDate: (date: string) => void;
}) {
  const weekStart: "mon" | "sun" = country === "US" ? "sun" : "mon";
  const notableCountry: NotableDateCountry = country === "US" ? "US" : "GB";
  const [year, setYear] = useState(initialYear);
  const [month, setMonth] = useState(initialMonth); // 1-12
  const [dots, setDots] = useState<CalendarDots>({});
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      const result = await getCalendarMonthDotsAction(year, month);
      setDots(result);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month]);

  const notableByDate = new Map(notableDatesForCountry(notableCountry, year).map((d) => [d.date, d.label]));
  const total = daysInMonth(year, month);
  const blanks = leadingBlanks(year, month, weekStart);
  const cells: (number | null)[] = [...Array(blanks).fill(null), ...Array.from({ length: total }, (_, i) => i + 1)];

  function go(delta: number) {
    const next = new Date(Date.UTC(year, month - 1 + delta, 1));
    setYear(next.getUTCFullYear());
    setMonth(next.getUTCMonth() + 1);
  }

  return (
    <Card bg="paper" border className="!p-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" className="px-2" onClick={() => go(-1)} aria-label="Previous month">
          ←
        </Button>
        <p className="font-display text-base font-bold">{MONTH_LABEL.format(new Date(Date.UTC(year, month - 1, 1)))}</p>
        <Button variant="ghost" className="px-2" onClick={() => go(1)} aria-label="Next month">
          →
        </Button>
      </div>
      <div className="mt-3 grid grid-cols-7 gap-1 text-center text-xs font-semibold text-muted">
        {WEEKDAY_LABELS[weekStart].map((label) => (
          <div key={label}>{label}</div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (day === null) return <div key={`blank-${i}`} />;
          const dateKey = toDateKey(year, month, day);
          const dotCount = dots[dateKey] ?? 0;
          const notableLabel = notableByDate.get(dateKey);
          return (
            <button
              key={dateKey}
              type="button"
              onClick={() => onSelectDate(dateKey)}
              title={notableLabel}
              className={`flex aspect-square flex-col items-center justify-center rounded-button border-2 text-sm font-semibold ${
                notableLabel ? "border-butter bg-butter/40" : "border-line bg-cream"
              }`}
            >
              {day}
              {dotCount > 0 && <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-coral" aria-label={`${dotCount} message(s)`} />}
            </button>
          );
        })}
      </div>
      {pending && <p className="mt-2 text-xs text-muted">Loading…</p>}
      <p className="mt-3 text-xs text-muted">Butter-highlighted days are notable dates. Dots mark days you have a message scheduled or sent.</p>
    </Card>
  );
}
