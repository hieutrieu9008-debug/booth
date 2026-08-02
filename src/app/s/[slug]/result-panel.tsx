"use client";

import { useEffect, useState } from "react";
import { undoAction, type ScanOutcome } from "./actions";

// M4-STAFF-SPEC.md color rule: every state gets a distinct full-bleed panel,
// no two states share a color. globals.css has no green/basil token, so
// VALID gets the ink panel per the spec's fallback instruction rather than
// inventing a new color.
const STATE_CLASSES: Record<ScanOutcome["kind"], string> = {
  visit_added: "bg-peach text-ink",
  already_today: "bg-butter text-ink",
  redeem_valid: "bg-ink text-cream",
  already_used: "bg-coral-dark text-cream",
  expired: "bg-muted text-cream",
  choice_required: "bg-butter text-ink border-2 border-ink",
  not_a_booth_code: "bg-paper text-ink border-2 border-line",
  member_not_found: "bg-paper text-ink border-2 border-line",
  invalid: "bg-paper text-ink border-2 border-line",
};

function relativeTime(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins === 1) return "1 min ago";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return hrs === 1 ? "1 hr ago" : `${hrs} hr ago`;
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Last 6 characters of the event id — a short human-readable reference, not a real lookup key (staff never type it anywhere). */
function shortRef(eventId: string): string {
  return eventId.slice(-6);
}

function ResultBody({ outcome }: { outcome: ScanOutcome }) {
  switch (outcome.kind) {
    case "visit_added":
      return (
        <div>
          <p className="font-display text-5xl font-extrabold">+1 {outcome.memberName}</p>
          {outcome.progressDisplays.length > 0 && (
            <div className="mt-3 flex flex-col gap-1">
              {outcome.progressDisplays.map((p, i) => (
                <p key={i} className="text-lg font-semibold">
                  {p.label}
                </p>
              ))}
            </div>
          )}
          {outcome.newGrants.length > 0 && (
            <p className="mt-4 rounded-button bg-coral px-4 py-3 font-display text-lg font-bold text-cream">
              NEW REWARD EARNED: texted to them
            </p>
          )}
        </div>
      );
    case "already_today":
      return (
        <p className="font-display text-4xl font-extrabold">
          ALREADY STAMPED TODAY: {outcome.memberName}
        </p>
      );
    case "redeem_valid":
      // F2 rebuild (SPEC-WSB-F.md WS-F item 4): reward text is the dominant
      // line (not the member name), the ring-up instruction is its own
      // coral pill, and a timestamp + short ref replace the bare relative
      // time — matching src/app/dev/mockups/redeem-panel's decided design.
      return (
        <div>
          <p className="font-display text-xl font-extrabold text-cream/70">VALID</p>
          <p className="mt-1 font-display text-4xl font-extrabold">{outcome.rewardText}</p>
          {outcome.ringUpNote && (
            <p className="mt-3 rounded-button bg-coral px-4 py-3 font-display text-lg font-bold text-cream">
              Ring this up now: {outcome.ringUpNote}
            </p>
          )}
          <p className="mt-3 text-sm font-semibold text-cream/70">
            {formatTimestamp(outcome.redeemedAt)} · ref {shortRef(outcome.eventId)} · {outcome.memberName}
          </p>
          {outcome.visitAdded && <p className="mt-3 font-display text-lg font-bold">+1 visit stamped</p>}
        </div>
      );
    case "already_used":
      return (
        <div>
          <p className="font-display text-4xl font-extrabold">ALREADY USED</p>
          <p className="mt-2 text-lg font-semibold">
            {relativeTime(outcome.redeemedAt)}, {outcome.memberName}
          </p>
        </div>
      );
    case "expired":
      return (
        <div>
          <p className="font-display text-4xl font-extrabold">EXPIRED</p>
          <p className="mt-2 text-lg font-semibold">
            {outcome.memberName}, {outcome.rewardText}
          </p>
        </div>
      );
    case "choice_required":
      return (
        <div>
          <p className="font-display text-3xl font-extrabold">Ask them to pick their reward on their card first</p>
          <p className="mt-2 text-lg font-semibold">
            {outcome.memberName}, {outcome.rewardText}
          </p>
        </div>
      );
    case "not_a_booth_code":
      return <p className="font-display text-3xl font-extrabold">NOT A BOOTH CODE</p>;
    case "member_not_found":
      return <p className="font-display text-3xl font-extrabold">Member not found</p>;
    case "invalid":
      return <p className="font-display text-3xl font-extrabold">Invalid code</p>;
  }
}

/**
 * Full-bleed bottom-sheet result panel shared by the camera pane and the
 * phone lookup pane. Vibrates on mount. Persists until the staffer dismisses
 * it.
 *
 * Decided deliberately: undo works
 * ANYTIME — no time window, no countdown, matching fn_undo_event's actual
 * server policy (it has never had a time limit; it only blocks a grant
 * that's since been re-redeemed). The old 60s countdown copy was never true
 * server-side and is gone. Undo is also available later from the
 * Redemptions list (redemptions-tab.tsx) after this panel's been dismissed.
 */
export function ResultPanel({
  outcome,
  slug,
  onDismiss,
}: {
  outcome: ScanOutcome;
  slug: string;
  onDismiss: () => void;
}) {
  const [undoing, setUndoing] = useState(false);
  const [undone, setUndone] = useState(false);
  const [visitUndone, setVisitUndone] = useState<"yes" | "no" | "blocked" | undefined>(undefined);
  const [undoError, setUndoError] = useState<string | null>(null);

  useEffect(() => {
    if (navigator.vibrate) navigator.vibrate(60);
    // No auto-dismiss timer: the panel persists until the staffer dismisses
    // it (tap anywhere on the panel) — see the component doc comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcome]);

  async function handleUndo() {
    if (outcome.kind !== "redeem_valid") return;
    setUndoing(true);
    setUndoError(null);
    const result = await undoAction(slug, outcome.eventId);
    setUndoing(false);
    if (result.status === "undone") {
      setUndone(true);
      setVisitUndone(result.visit_undone);
    } else if (result.status === "blocked_redeemed_grant") {
      setUndoError("Can't undo — this reward's already been redeemed again since.");
    } else {
      setUndoError("Nothing to undo here — this redemption's already voided.");
    }
  }

  return (
    <div
      className={`absolute inset-x-0 bottom-0 z-10 rounded-t-3xl p-6 shadow-punch ${STATE_CLASSES[outcome.kind]}`}
      onClick={onDismiss}
    >
      <div onClick={(e) => e.stopPropagation()}>
        <ResultBody outcome={outcome} />
        {outcome.kind === "redeem_valid" && !undone && (
          <button
            onClick={handleUndo}
            disabled={undoing}
            className="mt-4 min-h-11 w-full rounded-button border-2 border-cream px-4 font-display font-bold text-cream disabled:opacity-50"
          >
            {undoing ? "Undoing…" : "Undo"}
          </button>
        )}
        {undoError && <p className="mt-3 font-display font-bold">{undoError}</p>}
        {undone && visitUndone === "blocked" && (
          <p className="mt-3 font-display font-bold">
            Undone. Visit kept: reward from it was already used.
          </p>
        )}
        {undone && visitUndone !== "blocked" && <p className="mt-3 font-display font-bold">Undone.</p>}
      </div>
    </div>
  );
}
