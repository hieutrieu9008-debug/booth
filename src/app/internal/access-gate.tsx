"use client";

import { useActionState } from "react";
import { submitAccessCode, type GateState } from "./gate-actions";

const initialState: GateState = { error: null };

/** Simple code-entry form gating /internal — not customer-visible, function over beauty. */
export function AccessGate() {
  const [state, formAction, pending] = useActionState(submitAccessCode, initialState);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-ink px-6 text-center">
      <p className="font-display text-lg font-bold text-cream/70">Internal</p>
      <form action={formAction} className="flex w-full max-w-xs flex-col gap-4">
        <label htmlFor="code" className="sr-only">
          Access code
        </label>
        <input
          id="code"
          name="code"
          type="password"
          autoFocus
          autoComplete="off"
          placeholder="Access code"
          className="min-h-14 rounded-card border-2 border-cream bg-transparent px-4 text-center font-display text-2xl font-bold text-cream placeholder:text-cream/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral"
        />
        {state.error && (
          <p className="font-display text-base font-bold text-coral" role="alert">
            {state.error}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="min-h-14 rounded-button bg-coral font-display text-xl font-bold text-cream disabled:opacity-50"
        >
          {pending ? "Checking…" : "Unlock"}
        </button>
      </form>
    </div>
  );
}
