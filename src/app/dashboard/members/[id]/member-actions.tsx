"use client";

import { useState, useTransition } from "react";
import { Button, Card, ConfirmDialog } from "@/components/kit";
import type { CadenceSignal } from "@/lib/booth/dashboard-data";
import { extendGrant } from "@/app/dashboard/rewards/actions";
import { createCustomOfferAction, eraseMemberAction, sendMemberMessageAction } from "../actions";

const STOP_SUFFIX = " Reply STOP to opt out.";

/** Textarea -> confirm -> send, using the shared kit ConfirmDialog (punch-shadow card, explicit final verb button). */
export function MessagePanel({ memberId, memberName, cadence }: { memberId: string; memberName: string; cadence: CadenceSignal }) {
  const [body, setBody] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const trimmed = body.trim();
  const previewBody = trimmed ? (trimmed.includes("Reply STOP to opt out.") ? trimmed : `${trimmed}${STOP_SUFFIX}`) : "";

  function send() {
    setResult(null);
    startTransition(async () => {
      const res = await sendMemberMessageAction(memberId, body);
      setConfirming(false);
      if (!res.ok) setResult({ ok: false, message: res.error });
      else {
        setResult({ ok: true, message: `Sent to ${memberName}.` });
        setBody("");
      }
    });
  }

  return (
    <Card border className="mt-4 !p-4">
      <p className="font-display text-base font-bold">Message {memberName}</p>
      {cadence.show && (
        <p className="mt-2 text-sm font-semibold text-coral-dark">
          You&apos;ve sent about {cadence.avgPerMember.toFixed(1)} promos per member this month. Above 4, opt-outs
          climb.
        </p>
      )}
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        className="mt-3 w-full rounded-button border-2 border-line bg-cream px-4 py-3 text-base text-ink placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral-dark"
        placeholder="Hey — thought you'd want to know..."
      />
      <Button className="mt-3" disabled={!trimmed} onClick={() => setConfirming(true)}>
        Send
      </Button>
      <ConfirmDialog
        open={confirming}
        title={`Send this text to ${memberName} now?`}
        body={
          <>
            <p>&quot;{previewBody}&quot;</p>
            <p className="mt-1 text-muted">Reversible: no.</p>
          </>
        }
        confirmLabel={pending ? "Sending…" : "Send now"}
        pending={pending}
        onConfirm={send}
        onCancel={() => setConfirming(false)}
      />
      {result && (
        <p className={`mt-3 text-sm font-semibold ${result.ok ? "text-ink" : "text-coral-dark"}`} role="status">
          {result.message}
        </p>
      )}
    </Card>
  );
}

/** Reward text + optional expiry date -> confirm -> issued to the member's wallet + texted, via createCustomOfferAction. */
export function CustomOfferPanel({ memberId, memberName, cadence }: { memberId: string; memberName: string; cadence: CadenceSignal }) {
  const [rewardText, setRewardText] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const trimmed = rewardText.trim();

  function send() {
    setResult(null);
    startTransition(async () => {
      const iso = expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : undefined;
      const res = await createCustomOfferAction(memberId, rewardText, iso);
      setConfirming(false);
      if (!res.ok) setResult({ ok: false, message: res.error });
      else {
        setResult({ ok: true, message: `Added to ${memberName}'s wallet and texted.` });
        setRewardText("");
        setExpiresAt("");
      }
    });
  }

  return (
    <Card border className="mt-4 !p-4">
      <p className="font-display text-base font-bold">Custom offer for {memberName}</p>
      {cadence.show && (
        <p className="mt-2 text-sm font-semibold text-coral-dark">
          You&apos;ve sent about {cadence.avgPerMember.toFixed(1)} promos per member this month. Above 4, opt-outs
          climb.
        </p>
      )}
      <label className="mt-3 block text-sm font-semibold text-ink" htmlFor="custom-offer-reward">
        Reward
      </label>
      <input
        id="custom-offer-reward"
        value={rewardText}
        onChange={(e) => setRewardText(e.target.value)}
        placeholder="Free birthday cake slice"
        className="mt-1.5 w-full rounded-button border-2 border-line bg-cream px-4 py-3 text-base text-ink placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral-dark"
      />
      <label className="mt-3 block text-sm font-semibold text-ink" htmlFor="custom-offer-expiry">
        Expires (optional)
      </label>
      <input
        id="custom-offer-expiry"
        type="date"
        value={expiresAt}
        onChange={(e) => setExpiresAt(e.target.value)}
        className="mt-1.5 rounded-button border-2 border-line bg-cream px-4 py-2 text-base text-ink"
      />
      <Button className="mt-3" disabled={!trimmed} onClick={() => setConfirming(true)}>
        Add offer
      </Button>
      <ConfirmDialog
        open={confirming}
        title={`Give ${memberName} this offer now?`}
        body={
          <>
            <p>
              &quot;{trimmed}&quot;{expiresAt ? ` — expires ${expiresAt}` : " — no expiry"}
            </p>
            <p className="mt-1 text-muted">
              Goes straight to their wallet, and they&apos;ll get a text with the link. Reversible: no.
            </p>
          </>
        }
        confirmLabel={pending ? "Adding…" : "Add offer"}
        pending={pending}
        onConfirm={send}
        onCancel={() => setConfirming(false)}
      />
      {result && (
        <p className={`mt-3 text-sm font-semibold ${result.ok ? "text-ink" : "text-coral-dark"}`} role="status">
          {result.message}
        </p>
      )}
    </Card>
  );
}

const toDateInputValue = (v: string) => v.slice(0, 10);

/** Extend a single wallet grant's expiry — reuses rewards/actions.ts's extendGrant (same action the Rewards page's per-grant extend row calls). */
export function ExtendGrantControl({ grantId, expiresAt }: { grantId: string; expiresAt: string }) {
  const [date, setDate] = useState(toDateInputValue(expiresAt));
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function submit() {
    setMessage(null);
    startTransition(async () => {
      const result = await extendGrant(grantId, new Date(date + "T23:59:59").toISOString());
      setMessage(result.ok ? "Extended." : result.error);
    });
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className="min-h-9 rounded-button border-2 border-line bg-cream px-2 text-sm"
      />
      <Button variant="secondary" className="min-h-9 px-3 text-sm" disabled={pending} onClick={submit}>
        Extend
      </Button>
      {message && <span className="text-sm text-muted">{message}</span>}
    </span>
  );
}

/** Downloads everything Booth holds on this diner as JSON (Task C, UK GDPR right to access) — plain link to the owner-authed route handler, no confirm needed since it's read-only. */
export function ExportDataButton({ memberId }: { memberId: string }) {
  return (
    <Button variant="secondary" href={`/dashboard/members/${memberId}/export`}>
      Export data
    </Button>
  );
}

/** Permanently deletes this diner and everything tied to them (Task C, UK GDPR right to erasure), via eraseMemberAction, which redirects to the members list on success. */
export function DeleteMemberPanel({ memberId, memberName }: { memberId: string; memberName: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function erase() {
    setError(null);
    startTransition(async () => {
      const res = await eraseMemberAction(memberId);
      if (!res.ok) {
        setConfirming(false);
        setError(res.error);
      }
      // On success eraseMemberAction redirects to /dashboard/members itself.
    });
  }

  return (
    <Card border className="mt-4 !p-4">
      <p className="font-display text-base font-bold">Delete {memberName}</p>
      <p className="mt-2 text-sm text-muted">
        Permanently removes their profile, visit and redemption history, reward wallet, and message history.
      </p>
      <Button variant="secondary" className="mt-3" onClick={() => setConfirming(true)}>
        Delete this diner
      </Button>
      <ConfirmDialog
        open={confirming}
        title={`Delete ${memberName}?`}
        body={
          <>
            <p>
              This permanently removes {memberName}&apos;s profile, visit and redemption history, reward wallet, and
              message history from Booth.
            </p>
            <p className="mt-1 text-muted">This cannot be undone.</p>
          </>
        }
        confirmLabel={pending ? "Deleting…" : "Delete this diner"}
        pending={pending}
        onConfirm={erase}
        onCancel={() => setConfirming(false)}
      />
      {error && (
        <p className="mt-3 text-sm font-semibold text-coral-dark" role="status">
          {error}
        </p>
      )}
    </Card>
  );
}
