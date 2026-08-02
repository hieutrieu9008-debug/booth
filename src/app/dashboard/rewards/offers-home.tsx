"use client";

import { useState, useTransition } from "react";
import { Button, Card, Field } from "@/components/kit";
import type { InactiveOfferDraft, OfferStats } from "./data";
import { createOfferAction, duplicateOfferAction, toggleProgramActive, type CreateOfferInput } from "./actions";

const formatDate = (v: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(v));

function OfferCard({ stat }: { stat: OfferStats }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const c = stat.program.config as Record<string, unknown>;
  const summary =
    stat.program.type === "anytime"
      ? `${c.reward}, up to ${c.per_member_limit} per member`
      : `${c.reward}, ${formatDate(c.starts_at as string)} – ${formatDate(c.ends_at as string)}`;

  function duplicate() {
    setMessage(null);
    startTransition(async () => {
      const result = await duplicateOfferAction(stat.program.id);
      setMessage(result.ok ? "Duplicated — find it in Inactive drafts below, switch it on when it's ready." : result.error);
    });
  }

  return (
    <Card border className="!p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-muted">{stat.program.type === "anytime" ? "Anytime" : "Timed"}</p>
          <p className="font-display text-lg font-bold">{stat.program.name}</p>
          <p className="mt-1 text-sm text-muted">{summary}</p>
        </div>
        <Button variant="secondary" className="min-h-9 px-3 text-sm" disabled={pending} onClick={duplicate}>
          Duplicate
        </Button>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-muted">Issued</dt>
          <dd className="font-display text-xl font-bold">{stat.issued}</dd>
        </div>
        <div>
          <dt className="text-muted">Active</dt>
          <dd className="font-display text-xl font-bold">{stat.active}</dd>
        </div>
        <div>
          <dt className="text-muted">Redeemed</dt>
          <dd className="font-display text-xl font-bold">{stat.redeemed}</dd>
        </div>
        <div>
          <dt className="text-muted">Redemption rate</dt>
          <dd className="font-display text-xl font-bold">{stat.redemptionRate != null ? `${stat.redemptionRate}%` : "—"}</dd>
        </div>
      </dl>
      <p className="mt-2 text-sm text-muted">{stat.attributedVisits} attributed visit{stat.attributedVisits === 1 ? "" : "s"}</p>
      {stat.program.type === "anytime" && (
        <p className="mt-2 text-xs text-muted">
          Per-member limit is checked when you save this offer, not yet enforced when it&apos;s attached to a message —
          a member could receive more than {String(c.per_member_limit)} across separate messages today.
        </p>
      )}
      {message && <p className="mt-2 text-sm font-semibold text-ink">{message}</p>}
    </Card>
  );
}

function CreateOfferForm() {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"anytime" | "timed">("anytime");
  const [name, setName] = useState("");
  const [reward, setReward] = useState("");
  const [perMemberLimit, setPerMemberLimit] = useState(1);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    // Codex #6: send raw date parts, never a client-computed ISO instant —
    // the server resolves start/end-of-day against the restaurant's own
    // timezone (createOfferAction -> resolveTimedBounds), so a remote
    // owner's device timezone can never shift the boundary.
    const input: CreateOfferInput =
      type === "anytime"
        ? { type, name, config: { reward, per_member_limit: perMemberLimit } }
        : { type, name, config: { reward, starts_date: startsAt, ends_date: endsAt } };
    startTransition(async () => {
      const result = await createOfferAction(input);
      if (!result.ok) setError(result.error);
      else {
        setOpen(false);
        setName("");
        setReward("");
      }
    });
  }

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Create offer
      </Button>
    );
  }

  return (
    <Card bg="paper" border className="!p-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setType("anytime")}
          className={`rounded-button border-2 px-3 py-2 text-sm font-semibold ${type === "anytime" ? "border-ink bg-peach" : "border-line bg-cream"}`}
        >
          Anytime
        </button>
        <button
          type="button"
          onClick={() => setType("timed")}
          className={`rounded-button border-2 px-3 py-2 text-sm font-semibold ${type === "timed" ? "border-ink bg-peach" : "border-line bg-cream"}`}
        >
          Timed
        </button>
      </div>
      <div className="mt-4 space-y-3">
        <Field id="offer-name" label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <Field id="offer-reward" label="Reward text" value={reward} onChange={(e) => setReward(e.target.value)} />
        {type === "anytime" ? (
          <Field
            id="offer-limit"
            label="Per-member limit"
            type="number"
            min={1}
            value={perMemberLimit}
            onChange={(e) => setPerMemberLimit(Number(e.target.value))}
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="offer-starts" label="Starts" type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            <Field id="offer-ends" label="Ends" type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </div>
        )}
      </div>
      {error && <p className="mt-3 text-sm font-semibold text-coral-dark">{error}</p>}
      <div className="mt-4 flex gap-2">
        <Button disabled={pending || !name.trim() || !reward.trim()} onClick={submit}>
          {pending ? "Saving…" : "Save offer"}
        </Button>
        <Button variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

/** Codex #5: duplicate creates an inactive program — this is the "below" the duplicate success copy actually points to. Also where an owner switches on any anytime/timed draft. */
function DraftCard({ draft, onActivated }: { draft: InactiveOfferDraft; onActivated: (id: string) => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function activate() {
    setError(null);
    startTransition(async () => {
      const result = await toggleProgramActive(draft.id, true);
      if (!result.ok) setError(result.error);
      else onActivated(draft.id);
    });
  }

  return (
    <Card border className="!p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-muted">{draft.type === "anytime" ? "Anytime" : "Timed"} · inactive</p>
          <p className="font-display text-lg font-bold">{draft.name}</p>
          <p className="mt-1 text-sm text-muted">{draft.summary}</p>
        </div>
        <Button className="min-h-9 px-3 text-sm" disabled={pending} onClick={activate}>
          {pending ? "Activating…" : "Activate"}
        </Button>
      </div>
      {error && <p className="mt-2 text-sm font-semibold text-coral-dark">{error}</p>}
    </Card>
  );
}

export function OffersHome({ stats, drafts }: { stats: OfferStats[]; drafts: InactiveOfferDraft[] }) {
  const [remainingDrafts, setRemainingDrafts] = useState(drafts);
  const [activatedMessage, setActivatedMessage] = useState<string | null>(null);

  function handleActivated(draft: InactiveOfferDraft) {
    setRemainingDrafts((prev) => prev.filter((x) => x.id !== draft.id));
    setActivatedMessage(`${draft.name} is now live — reload the page to see its stats above.`);
  }

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="font-display text-2xl font-extrabold">Live offers</h2>
        <CreateOfferForm />
      </div>
      {activatedMessage && <p className="mt-2 text-sm font-semibold text-ink">{activatedMessage}</p>}
      {stats.length === 0 ? (
        <p className="mt-4 text-base text-muted">No active anytime/timed offers yet — create one above.</p>
      ) : (
        <div className="mt-4 space-y-4">
          {stats.map((s) => (
            <OfferCard key={s.program.id} stat={s} />
          ))}
        </div>
      )}

      {remainingDrafts.length > 0 && (
        <div className="mt-8">
          <h3 className="font-display text-lg font-bold">Inactive drafts</h3>
          <p className="mt-1 text-sm text-muted">Duplicates and unfinished offers land here until you switch them on.</p>
          <div className="mt-4 space-y-4">
            {remainingDrafts.map((d) => (
              <DraftCard key={d.id} draft={d} onActivated={() => handleActivated(d)} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
