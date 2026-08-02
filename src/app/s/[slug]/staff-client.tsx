"use client";

import { useState } from "react";
import { ScanScreen } from "./scan-screen";
import { RedemptionsTab } from "./redemptions-tab";
import { DemoCheatSheet } from "./demo-cheat-sheet";

type Tab = "scan" | "redemptions";

const TAB_LABEL: Record<Tab, string> = {
  scan: "Scan",
  redemptions: "Redemptions",
};

// Hardcoded demo tenant id (AGENTS.md / seed script) — gates the cheat sheet
// + Lock control so they never render for a real tenant, in any environment
// (SPEC-WS3.md item 4: "gate on the demo tenant id ... never show for real tenants").
const DEMO_RESTAURANT_ID = "00000000-0000-4000-8000-000000000001";

/**
 * Staff loop shell. SPEC-WSB-F.md WS-F item 1 (F1 "One screen") killed the
 * separate scan/phone tabs — camera + phone lookup now live together in
 * ScanScreen, one merged "Scan" view. Redemptions-today stays the only
 * secondary view/toggle. Bottom thumb-tabs on phones only (SPEC-WS3.md item
 * 1); on >=md the tabs move into a left sidebar alongside the restaurant name
 * so the surface stops reading as a stretched phone app on a desktop/tablet.
 */
export function StaffClient({
  slug,
  restaurantId,
  restaurantName,
  phonePrefix,
  ownerDashboardHref,
}: {
  slug: string;
  restaurantId: string;
  restaurantName: string;
  phonePrefix: string;
  /** F1 "Owner-mode entry" (SPEC-WSB-F.md item 3): set only when an owner
   * session exists for THIS restaurant — shows a quiet link back to the
   * dashboard. No owner powers render in the scanner itself. */
  ownerDashboardHref: string | null;
}) {
  const [tab, setTab] = useState<Tab>("scan");
  const isDemo = restaurantId === DEMO_RESTAURANT_ID;

  return (
    <div className="flex h-dvh flex-col bg-ink md:flex-row">
      <header className="flex items-center justify-between px-4 py-2 md:hidden">
        <span className="font-display text-sm font-bold text-cream/70">{restaurantName}</span>
        {ownerDashboardHref && (
          <a href={ownerDashboardHref} className="text-xs font-semibold text-cream/50 underline underline-offset-2">
            Back to dashboard
          </a>
        )}
      </header>

      <nav className="hidden shrink-0 flex-col md:flex md:w-56 md:border-r-2 md:border-cream/20">
        <div className="px-4 py-4">
          <span className="font-display text-sm font-bold text-cream/70">{restaurantName}</span>
          {ownerDashboardHref && (
            <a
              href={ownerDashboardHref}
              className="mt-1 block text-xs font-semibold text-cream/50 underline underline-offset-2"
            >
              Back to dashboard
            </a>
          )}
        </div>
        <div className="flex flex-col gap-1 px-2">
          {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`min-h-14 rounded-button px-4 text-left font-display text-sm font-bold uppercase tracking-wide ${
                tab === t ? "bg-coral text-cream" : "text-cream/60"
              }`}
            >
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>
        {isDemo && (
          <div className="mt-auto">
            <DemoCheatSheet slug={slug} />
          </div>
        )}
      </nav>

      <div className="flex flex-1 flex-col overflow-hidden">
        {tab === "scan" && <ScanScreen slug={slug} phonePrefix={phonePrefix} />}
        {tab === "redemptions" && <RedemptionsTab slug={slug} />}
      </div>

      {isDemo && (
        <div className="md:hidden">
          <DemoCheatSheet slug={slug} />
        </div>
      )}

      <nav className="flex shrink-0 border-t-2 border-cream/20 bg-ink md:hidden">
        {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`min-h-14 flex-1 font-display text-sm font-bold uppercase tracking-wide ${
              tab === t ? "bg-coral text-cream" : "text-cream/60"
            }`}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </nav>
    </div>
  );
}
