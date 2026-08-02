"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/kit";
import { getRedemptionsToday, undoAction, type RedemptionRow } from "./actions";

/**
 * F2 (SPEC-WSB-F.md WS-F item 4): rows get their own Undo affordance so a
 * redemption is still undoable after its result panel's been dismissed —
 * undo has no time window server-side (fn_undo_event), and this list is how
 * a staffer reaches an older one.
 */
function RedemptionRowItem({ slug, row }: { slug: string; row: RedemptionRow }) {
  const [undoing, setUndoing] = useState(false);
  const [status, setStatus] = useState<"idle" | "undone" | "blocked" | "already_voided">(row.voided ? "undone" : "idle");

  async function handleUndo() {
    setUndoing(true);
    // Redemptions-today rows are keyed off the redemption event id, exactly
    // what undoAction expects.
    const result = await undoAction(slug, row.id);
    setUndoing(false);
    if (result.status === "undone") setStatus("undone");
    else if (result.status === "blocked_redeemed_grant") setStatus("blocked");
    else setStatus("already_voided");
  }

  const voided = row.voided || status === "undone";

  return (
    <div className={`rounded-card border-2 border-ink px-4 py-3 ${voided ? "bg-paper opacity-50" : "bg-white"}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-display text-lg font-bold text-ink">{row.memberName}</span>
        <span className="text-sm text-muted">
          {new Date(row.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </span>
      </div>
      <p className="text-base text-ink">{row.rewardText}</p>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
        {row.source}
        {voided ? " · voided" : ""}
      </p>
      {!voided && (
        <button
          onClick={handleUndo}
          disabled={undoing}
          className="mt-2 min-h-9 rounded-button border-2 border-ink px-3 text-sm font-bold text-ink disabled:opacity-50"
        >
          {undoing ? "Undoing…" : "Undo"}
        </button>
      )}
      {status === "blocked" && (
        <p className="mt-2 text-sm font-semibold text-coral-dark">Can&apos;t undo — this reward&apos;s already been redeemed again since.</p>
      )}
      {status === "already_voided" && <p className="mt-2 text-sm font-semibold text-muted">Already undone.</p>}
    </div>
  );
}

/** Redemptions-today tab (M4-STAFF-SPEC.md) — register reconciliation list. */
export function RedemptionsTab({ slug }: { slug: string }) {
  const [rows, setRows] = useState<RedemptionRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getRedemptionsToday(slug).then((r) => {
      if (!cancelled) setRows(r);
    });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (rows === null) {
    return (
      <div className="flex flex-1 flex-col gap-3 bg-paper p-4">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center bg-paper p-4">
        <p className="text-lg font-semibold text-muted">No redemptions yet today.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto bg-paper p-4">
      {rows.map((r) => (
        <RedemptionRowItem key={r.id} slug={slug} row={r} />
      ))}
      <p className="mt-2 font-display text-sm font-bold text-muted">
        {rows.length} redemption{rows.length === 1 ? "" : "s"} today
      </p>
    </div>
  );
}
