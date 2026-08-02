"use client";

import { useActionState } from "react";
import { submitPin, type PinFormState } from "./actions";

const initialState: PinFormState = { error: null };

/** Big numeric keypad-friendly PIN entry (M4-STAFF-SPEC.md). */
export function PinGate({ slug, restaurantName }: { slug: string; restaurantName: string }) {
  const action = submitPin.bind(null, slug);
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-8 bg-ink px-6 text-center">
      <p className="font-display text-lg font-bold text-cream/70">{restaurantName}</p>
      <form action={formAction} className="flex w-full max-w-xs flex-col gap-4">
        <label htmlFor="pin" className="sr-only">
          Staff PIN
        </label>
        <input
          id="pin"
          name="pin"
          type="tel"
          inputMode="numeric"
          pattern="[0-9]*"
          autoFocus
          autoComplete="off"
          placeholder="••••"
          className="min-h-20 rounded-card border-2 border-cream bg-transparent text-center font-display text-5xl font-extrabold tracking-[0.3em] text-cream placeholder:text-cream/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral"
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
