"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { MemberSavedView } from "@/lib/booth/dashboard-data";

const CHIPS: { value: MemberSavedView; label: string }[] = [
  { value: "close_to_reward", label: "Close to a reward" },
  { value: "gone_quiet", label: "Gone quiet" },
  { value: "birthday_month", label: "Birthday this month" },
];

export function MembersFilters({ query, view }: { query: string; view: MemberSavedView | undefined }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [text, setText] = useState(query);
  const [, startTransition] = useTransition();

  function pushParams(next: { q?: string; view?: string }) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.q !== undefined) {
      if (next.q) params.set("q", next.q);
      else params.delete("q");
    }
    if (next.view !== undefined) {
      if (next.view) params.set("view", next.view);
      else params.delete("view");
    }
    startTransition(() => router.push(`/dashboard/members?${params.toString()}`));
  }

  // Debounced server-side search — same idiom as the composer's audience recount.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (text !== query) pushParams({ q: text });
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <div className="mt-6 space-y-4">
      <input
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Search by name or phone…"
        aria-label="Search members"
        className="min-h-11 w-full max-w-md rounded-button border-2 border-line bg-cream px-4 text-base text-ink placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral-dark"
      />
      <div className="flex flex-wrap gap-2">
        {CHIPS.map((chip) => {
          const active = view === chip.value;
          return (
            <button
              key={chip.value}
              type="button"
              onClick={() => pushParams({ view: active ? "" : chip.value })}
              className={`rounded-pill border-2 px-4 py-2 text-sm font-semibold ${
                active ? "border-ink bg-peach" : "border-line bg-cream"
              }`}
            >
              {chip.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
