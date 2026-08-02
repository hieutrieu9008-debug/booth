import type { Metadata } from "next";
import { ScanSpikeClient } from "./scan-client";

export const metadata: Metadata = {
  title: "Scan spike — Booth Loyalty dev",
  robots: { index: false, follow: false },
};

export default function ScanSpikePage() {
  return (
    <main className="min-h-dvh bg-paper">
      <ScanSpikeClient />
    </main>
  );
}
