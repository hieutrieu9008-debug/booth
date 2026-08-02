"use client";

import type { ReactNode } from "react";
import { Button } from "./button";
import { Card } from "./card";

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  /** The specifics to review before committing — recipient count, full message text, send time, etc. */
  body: ReactNode;
  /** Explicit final verb, e.g. "Send now", "Deactivate", "Replace existing". Never a vague "OK"/"Confirm". */
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmDisabled?: boolean;
  pending?: boolean;
  /** Extra content between the body and the buttons — e.g. the generator's typed-slug confirmation input. */
  children?: ReactNode;
};

/** Punch-shadow confirmation card, shown as a plain overlay (no blur per DESIGN.md). Explicit final verb on the confirm button — never "OK". */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
  confirmDisabled = false,
  pending = false,
  children,
}: ConfirmDialogProps) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4"
    >
      <Card shadow border className="max-w-md">
        <h2 className="font-display text-xl font-bold">{title}</h2>
        <div className="mt-3 text-sm text-ink">{body}</div>
        {children && <div className="mt-4">{children}</div>}
        <div className="mt-6 flex flex-wrap gap-3">
          <Button onClick={onConfirm} disabled={confirmDisabled || pending}>
            {pending ? "Working…" : confirmLabel}
          </Button>
          <Button variant="secondary" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
        </div>
      </Card>
    </div>
  );
}
