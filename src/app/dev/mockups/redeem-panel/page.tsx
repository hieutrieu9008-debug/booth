import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RedeemPanelMockup } from "./redeem-panel-mockup";

export const metadata: Metadata = {
  title: "Redeem panel mockup — Booth Loyalty dev",
  robots: { index: false, follow: false },
};

/**
 * Dev-gated per SPEC-WSB-F.md WS-F item 4: this page shows the PROPOSED F2
 * redemption-panel redesign, pending sign-off — it is not wired to any
 * real data or the real result panel, and must never be reachable in
 * production.
 */
export default function RedeemPanelMockupPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <main className="min-h-dvh bg-paper">
      <RedeemPanelMockup />
    </main>
  );
}
