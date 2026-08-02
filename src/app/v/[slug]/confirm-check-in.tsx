"use client";

import { useActionState } from "react";
import { confirmCheckInAction, type CheckInResult } from "./actions";
import { renderCheckInResult } from "./result-view";

/**
 * Codex #1 fix: the GET render (page.tsx) only ever gets here once every
 * non-mutating guard (token, tenant cookie, hours) has already passed — this
 * component's whole job is to wait for the diner's explicit tap before any
 * visit is recorded. The tap submits a real POST-backed Server Action
 * (confirmCheckInAction), so a link-preview bot or a page refresh can never
 * trigger it — only a genuine click/tap does.
 */
export function ConfirmCheckIn({ slug, token }: { slug: string; token: string }) {
  const action = confirmCheckInAction.bind(null, slug, token);
  const [state, formAction, pending] = useActionState<CheckInResult | null, FormData>(action, null);

  if (state) return <>{renderCheckInResult(state)}</>;

  return (
    <form action={formAction}>
      <h1 className="font-display text-2xl font-extrabold">Ready to check in?</h1>
      <p className="mt-3 text-base text-muted">Tap below to log today&apos;s visit.</p>
      <button
        type="submit"
        disabled={pending}
        className="mt-6 min-h-14 w-full rounded-button bg-coral px-6 font-display text-xl font-bold text-cream disabled:opacity-50"
      >
        {pending ? "Checking you in…" : "I'm here — check in"}
      </button>
    </form>
  );
}
