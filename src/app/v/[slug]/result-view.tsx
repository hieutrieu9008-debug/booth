import type { CheckInResult } from "./actions";

/**
 * Shared between page.tsx (Server Component, renders a terminal validation
 * state straight off the GET) and confirm-check-in.tsx (Client Component,
 * renders the result of the POST-backed confirm tap). Plain module, no
 * "use client"/"use server" — safe to import from either side.
 */
export function renderCheckInResult(result: CheckInResult) {
  switch (result.kind) {
    case "checked_in":
      return (
        <h1 className="font-display text-3xl font-extrabold">
          You&apos;re checked in{result.progressLabel ? ` — ${result.progressLabel}` : ""}.
        </h1>
      );
    case "already_today":
      return <h1 className="font-display text-2xl font-extrabold">Already checked in today{result.memberName ? `, ${result.memberName}` : ""}.</h1>;
    case "closed":
      return <h1 className="font-display text-2xl font-extrabold">We&apos;re closed right now — hours {result.hoursLabel}.</h1>;
    case "no_session":
      return (
        <>
          <h1 className="font-display text-2xl font-extrabold">Open your card from your text first.</h1>
          <p className="mt-3 text-base text-muted">We couldn&apos;t find your Booth card on this device yet.</p>
        </>
      );
    case "wrong_tenant":
      return (
        <>
          <h1 className="font-display text-2xl font-extrabold">Open your card from your text first.</h1>
          <p className="mt-3 text-base text-muted">Your card is for a different restaurant than this one.</p>
        </>
      );
    case "invalid_code":
      return (
        <>
          <h1 className="font-display text-2xl font-extrabold">This code isn&apos;t set up for check-in.</h1>
          <p className="mt-3 text-base text-muted">Ask staff to scan you in instead.</p>
        </>
      );
  }
}
