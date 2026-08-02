"use client";

import { useEffect, useState } from "react";
import { Button, Card } from "@/components/kit";

/**
 * F2 redemption-panel mockup (SPEC-WSB-F.md WS-F item 4). MOCKUP ONLY — no
 * server wiring, no real fn_redeem_grant call, no server-side undo policy.
 * Fixed example data, clearly labeled as an example (AGENTS.md: no invented
 * numbers presented as real). Ticks a live countdown purely as a client-side
 * timer so a reviewer can feel the honesty of each variant’s copy, not to
 * demonstrate any implemented policy.
 */

const EXAMPLE = {
  memberName: "Priya S.",
  rewardText: "Free garlic naan",
  ringUpNote: "1x garlic naan, no charge",
  eventId: "8f2c9a1e-77bb-4e10-9c3d-b6a204de19f0",
  timestamp: "2026-07-18T13:42:00Z",
};

function shortRef(eventId: string): string {
  return eventId.slice(-6);
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function useCountdown(startSeconds: number) {
  const [secondsLeft, setSecondsLeft] = useState(startSeconds);
  useEffect(() => {
    if (secondsLeft <= 0) return;
    const t = setTimeout(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [secondsLeft]);
  return secondsLeft;
}

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function PanelBody({ undoLabel, dismissed, onDismiss }: { undoLabel: string; dismissed: boolean; onDismiss: () => void }) {
  if (dismissed) {
    return (
      <div className="flex min-h-[240px] items-center justify-center rounded-t-3xl border-2 border-dashed border-line bg-paper p-6">
        <p className="text-base font-semibold text-muted">Dismissed — panel is gone until the next scan.</p>
      </div>
    );
  }

  return (
    <div className="rounded-t-3xl bg-ink p-6 text-cream shadow-punch" onClick={(e) => e.stopPropagation()}>
      <p className="font-display text-2xl font-extrabold text-cream/70">VALID</p>
      <p className="mt-1 font-display text-4xl font-extrabold">{EXAMPLE.rewardText}</p>
      <p className="mt-3 rounded-button bg-coral px-4 py-3 font-display text-lg font-bold text-cream">
        Ring this up now: {EXAMPLE.ringUpNote}
      </p>
      <p className="mt-3 text-sm font-semibold text-cream/70">
        {formatTimestamp(EXAMPLE.timestamp)} · ref {shortRef(EXAMPLE.eventId)} · {EXAMPLE.memberName}
      </p>
      <p className="mt-3 font-display text-lg font-bold">+1 visit stamped</p>

      <button className="mt-4 min-h-11 w-full rounded-button border-2 border-cream px-4 font-display font-bold text-cream">
        {undoLabel}
      </button>

      <button
        onClick={onDismiss}
        className="mt-3 min-h-11 w-full font-display text-sm font-bold uppercase tracking-wide text-cream/60"
      >
        Dismiss
      </button>
    </div>
  );
}

function VariantA() {
  const secondsLeft = useCountdown(15 * 60);
  const [dismissed, setDismissed] = useState(false);
  const expired = secondsLeft <= 0;

  return (
    <Card border className="!p-0 overflow-hidden">
      <div className="p-4">
        <p className="font-display text-lg font-bold text-ink">Variant A — 15-minute server-enforced window</p>
        <p className="mt-1 text-sm text-muted">
          Undo works for exactly 15 minutes after redemption, enforced server-side (fn_undo_event would start refusing
          once the window closes, not just hiding the button). After that, the redemption stands — no undo, from
          anyone, ever.
        </p>
      </div>
      <PanelBody
        undoLabel={expired ? "Undo window closed" : `Undo (${formatCountdown(secondsLeft)} left)`}
        dismissed={dismissed}
        onDismiss={() => setDismissed(true)}
      />
      {dismissed && (
        <div className="p-4">
          <Button variant="secondary" onClick={() => setDismissed(false)}>
            Reset mockup
          </Button>
        </div>
      )}
    </Card>
  );
}

function VariantB() {
  const [dismissed, setDismissed] = useState(false);

  return (
    <Card border className="!p-0 overflow-hidden">
      <div className="p-4">
        <p className="font-display text-lg font-bold text-ink">Variant B — until end of day</p>
        <p className="mt-1 text-sm text-muted">
          Undo stays available until the restaurant's close of business (restaurant-local midnight), unless the same
          grant gets re-redeemed first — a re-redemption locks the original undo out immediately, since the reward's
          already been used again.
        </p>
      </div>
      <PanelBody
        undoLabel="Undo (until close today)"
        dismissed={dismissed}
        onDismiss={() => setDismissed(true)}
      />
      {dismissed && (
        <div className="p-4">
          <Button variant="secondary" onClick={() => setDismissed(false)}>
            Reset mockup
          </Button>
        </div>
      )}
    </Card>
  );
}

export function RedeemPanelMockup() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-16 sm:px-8">
      <h1 className="font-display text-3xl font-extrabold text-ink">Redemption panel — F2 mockup</h1>
      <p className="mt-2 max-w-2xl text-base text-muted">
        SPEC-WSB-F.md WS-F item 4. Static, dev-only. The real result panel (src/app/s/[slug]/result-panel.tsx) keeps
        its current behavior except it no longer auto-dismisses at 6s (that part is already decided and shipped);
        everything below is the proposed redesign, gated on picking one of the two undo policies. Example data
        below is fixed and labeled — not from a real redemption.
      </p>

      <div className="mt-10 grid gap-8 md:grid-cols-2">
        <VariantA />
        <VariantB />
      </div>

      <p className="mt-10 text-sm text-muted">
        Both variants share every other change from the current panel: reward text is now the dominant line (not the
        member name), a timestamp + short reference (last 6 characters of the event id) replace the bare relative
        time, and &quot;+1 visit stamped&quot; is now always shown when a visit was auto-added rather than being
        implied.
      </p>
    </div>
  );
}
