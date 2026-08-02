"use client";
import { useState, useTransition } from "react";
import { setChoicePrefAction } from "./actions";

export type PreChoiceOption = { reward: string };

/**
 * "Your pick" dropdown for a multi-option rung the diner hasn't reached yet
 * (WS-E item 3). Native select (scales to 30 options without a custom
 * listbox) styled per kit tokens. Selectable from day one, changeable any
 * time before the rung is earned — rewards.ts copies whatever's stored here
 * onto the grant the moment it's created.
 */
export function PreChoicePicker({
  token,
  programId,
  rungVisits,
  cycle,
  options,
  initialPick,
}: {
  token: string;
  programId: string;
  rungVisits: number;
  cycle: number;
  options: PreChoiceOption[];
  initialPick: string | null;
}) {
  const [value, setValue] = useState(initialPick ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const fieldId = `pick-${programId}-${rungVisits}-${cycle}`;

  function onChange(next: string) {
    setValue(next);
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await setChoicePrefAction(token, programId, rungVisits, cycle, next);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
    });
  }

  return (
    <div className="mt-2 w-full">
      <label htmlFor={fieldId} className="text-sm font-semibold text-muted">
        Your pick
      </label>
      <select
        id={fieldId}
        value={value}
        disabled={pending}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 min-h-11 w-full rounded-button border-2 border-line bg-cream px-4 text-base text-ink disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral-dark"
      >
        <option value="" disabled>
          Choose your reward
        </option>
        {options.map((option) => (
          <option key={option.reward} value={option.reward}>
            {option.reward}
          </option>
        ))}
      </select>
      {error && (
        <p role="alert" className="mt-1 text-sm font-semibold text-coral-dark">
          {error}
        </p>
      )}
      {saved && !error && <p className="mt-1 text-sm text-muted">Saved. You can change this any time before you earn it.</p>}
    </div>
  );
}
