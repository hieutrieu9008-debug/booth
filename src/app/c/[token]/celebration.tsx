"use client";
import { useEffect, useRef, useState } from "react";

const STORAGE_KEY = "bl_celebrated_grants";

function readCelebrated(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeCelebrated(ids: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // localStorage unavailable (private mode, quota) — celebration just
    // won't dedupe across visits; never worth failing the page render for.
  }
}

const formatDate = (value: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));

export type CelebrationGrant = { id: string; reward_text: string; expires_at: string | null };

/**
 * Diner-facing congratulations block for a freshly earned grant (WS-E item
 * 1). Shown once per device per grant id — tracked in localStorage rather
 * than a new schema column, since it's purely a "have I already shown this"
 * client-side flag, not app state. Kit-styled, punch shadow, coral moment
 * allowed per DESIGN.md; prefers-reduced-motion collapses the entrance
 * animation to an instant appearance (motion-safe: prefix below).
 */
export function Celebration({ grants }: { grants: CelebrationGrant[] }) {
  const [fresh, setFresh] = useState<CelebrationGrant[]>([]);
  // Guards against React StrictMode's dev-only double-invoke of effects
  // (mount -> cleanup -> mount again on the SAME instance): without this,
  // the first invocation marks the grant seen in localStorage, and the
  // second invocation immediately sees it as already-seen and never sets
  // `fresh` — so the celebration would silently never appear, even on a
  // diner's genuine first view. The ref persists across that double-invoke
  // (only effects re-run, not refs/state), so the write can only happen once
  // per real mount.
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    const seen = readCelebrated();
    const newOnes = grants.filter((g) => !seen.has(g.id));
    if (newOnes.length === 0) return;
    setFresh(newOnes);
    newOnes.forEach((g) => seen.add(g.id));
    writeCelebrated(seen);
    // Only ever run once per mount — re-running on every grants re-render
    // would re-celebrate a grant already marked seen this session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (fresh.length === 0) return null;

  return (
    <div className="space-y-4">
      {fresh.map((grant) => (
        // Not the shared Card primitive here — this is the one diner surface
        // where the coral moment (DESIGN.md) replaces the usual white/paper
        // card background, and Card's bg prop only offers white/paper.
        <div key={grant.id} className="animate-celebration-pop rounded-card border-2 border-ink bg-coral p-6 text-cream shadow-punch">
          <p className="font-display text-2xl font-extrabold">
            You&apos;ve earned {grant.reward_text}. It&apos;s in your wallet below.
          </p>
          {grant.expires_at && <p className="mt-2 text-base text-cream/90">Use it by {formatDate(grant.expires_at)}.</p>}
        </div>
      ))}
    </div>
  );
}
