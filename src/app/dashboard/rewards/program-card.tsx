"use client";

import { useEffect, useState, useTransition } from "react";
import { Button, Card, ConfirmDialog, Field } from "@/components/kit";
import type {
  AnytimeConfig,
  BirthdayConfig,
  ComeBackConfig,
  TimedConfig,
  VisitLadderConfig,
  WelcomeConfig,
} from "@/lib/booth/programs";
import type { RewardProgram } from "@/lib/booth/types";
import { EXTENDABLE_PROGRAM_TYPES, type OutstandingGrant } from "./shared";
import {
  extendGrant,
  extendProgramGrants,
  getExtendNotifyDefaultAction,
  toggleProgramActive,
  updateProgramConfig,
} from "./actions";
import { LadderEditor } from "./ladder-editor";
import { ComeBackEditor } from "./come-back-editor";
import { BirthdayEditor } from "./birthday-editor";

/** WS-D — loaded once per rewards page visit; used as the extend-notify checkbox's starting state everywhere on the page. */
function useExtendNotifyDefault(): boolean {
  const [value, setValue] = useState(true);
  useEffect(() => {
    getExtendNotifyDefaultAction().then(setValue);
  }, []);
  return value;
}

const TYPE_LABEL: Record<string, string> = {
  welcome: "Welcome",
  visit_ladder: "Visit ladder",
  birthday: "Birthday",
  come_back: "Come back",
  anytime: "Anytime",
  timed: "Timed",
};

function summarize(program: RewardProgram): string {
  const c = program.config as Record<string, unknown>;
  switch (program.type) {
    case "welcome":
      return `${c.reward} within ${c.valid_days} days of joining`;
    case "visit_ladder": {
      const rungs = (c.rungs as { visits: number; options: { reward: string }[] }[]) ?? [];
      return `Head start ${c.endowed_start} · ${rungs.map((r) => `${r.visits} visits → ${r.options.map((o) => o.reward).join(" or ")}`).join(" · ")}${c.loop ? " · loops" : ""}`;
    }
    case "birthday":
      return c.mode === "month" ? `${c.reward}, valid all birthday month` : `${c.reward}, valid ${c.window_days} days around birthday`;
    case "come_back": {
      const blocks = (c.blocks as { days_quiet: number; reward: string; valid_days: number }[]) ?? [];
      return blocks.map((b) => `${b.days_quiet}d quiet → ${b.reward} (${b.valid_days}d)`).join(" · ");
    }
    case "anytime":
      return `${c.reward}, up to ${c.per_member_limit} per member`;
    case "timed":
      return `${c.reward}, ${new Date(c.starts_at as string).toLocaleDateString()} - ${new Date(c.ends_at as string).toLocaleDateString()}`;
    default:
      return "";
  }
}

const formatDate = (v: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(v));
const toDateInputValue = (v: string) => v.slice(0, 10);

function ExtendGrantsRow({ grant, extendNotifyDefault }: { grant: OutstandingGrant; extendNotifyDefault: boolean }) {
  const [date, setDate] = useState(toDateInputValue(grant.expiresAt));
  const [confirming, setConfirming] = useState(false);
  const [notify, setNotify] = useState(extendNotifyDefault);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setNotify(extendNotifyDefault), [extendNotifyDefault]);

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await extendGrant(grant.id, new Date(date + "T23:59:59").toISOString(), notify);
      if (!result.ok) setError(result.error);
      setConfirming(false);
    });
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-line py-2 text-sm">
      <span>
        {grant.memberName} · expires {formatDate(grant.expiresAt)}
      </span>
      <span className="flex items-center gap-2">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="min-h-9 rounded-button border-2 border-line bg-cream px-2 text-sm"
        />
        <Button variant="secondary" className="min-h-9 px-3 text-sm" disabled={pending} onClick={() => setConfirming(true)}>
          Extend
        </Button>
      </span>
      {error && <span className="w-full text-coral-dark">{error}</span>}
      <ConfirmDialog
        open={confirming}
        title="Extend this reward?"
        confirmLabel={pending ? "Extending…" : "Extend"}
        pending={pending}
        onConfirm={submit}
        onCancel={() => setConfirming(false)}
        body={
          <p>
            {grant.memberName}&apos;s reward will now expire {formatDate(new Date(date + "T23:59:59").toISOString())}.
          </p>
        }
      >
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="h-5 w-5 accent-coral" />
          Also text them about the new expiry
        </label>
      </ConfirmDialog>
    </li>
  );
}

function ExtendAllForm({ programId, count, extendNotifyDefault }: { programId: string; count: number; extendNotifyDefault: boolean }) {
  const [date, setDate] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [notify, setNotify] = useState(extendNotifyDefault);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => setNotify(extendNotifyDefault), [extendNotifyDefault]);

  function submit() {
    if (!date) return;
    setError(null);
    startTransition(async () => {
      const result = await extendProgramGrants(programId, new Date(date + "T23:59:59").toISOString(), notify);
      if (!result.ok) setError(result.error);
      else setDone(true);
      setConfirming(false);
    });
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <input
        type="date"
        aria-label="New expiry date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className="min-h-10 rounded-button border-2 border-line bg-cream px-3 text-sm"
      />
      <Button variant="secondary" disabled={pending || !date} onClick={() => setConfirming(true)}>
        Extend all outstanding grants
      </Button>
      {done && <span className="text-sm font-semibold text-ink">Extended.</span>}
      {error && <span className="text-sm text-coral-dark">{error}</span>}
      <ConfirmDialog
        open={confirming}
        title="Extend all outstanding grants?"
        confirmLabel={pending ? "Extending…" : "Extend all"}
        pending={pending}
        onConfirm={submit}
        onCancel={() => setConfirming(false)}
        body={
          <p>
            {count} outstanding {count === 1 ? "grant" : "grants"} on this reward will now expire{" "}
            {date ? formatDate(new Date(date + "T23:59:59").toISOString()) : "—"}. Reversible: no.
          </p>
        }
      >
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="h-5 w-5 accent-coral" />
          Also text everyone affected about the new expiry
        </label>
      </ConfirmDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-type edit forms
// ---------------------------------------------------------------------------

function WelcomeForm({ config, onSubmit }: { config: WelcomeConfig; onSubmit: (c: WelcomeConfig) => void }) {
  const [reward, setReward] = useState(config.reward);
  const [ringUpNote, setRingUpNote] = useState(config.ring_up_note ?? "");
  const [validDays, setValidDays] = useState(config.valid_days);
  return (
    <div className="mt-4 space-y-3">
      <Field id="reward" label="Reward" value={reward} onChange={(e) => setReward(e.target.value)} />
      <Field id="ring_up_note" label="Ring-up note (staff-only)" value={ringUpNote} onChange={(e) => setRingUpNote(e.target.value)} />
      <Field id="valid_days" label="Valid for (days)" type="number" min={1} value={validDays} onChange={(e) => setValidDays(Number(e.target.value))} />
      <Button className="mt-2" onClick={() => onSubmit({ reward, ring_up_note: ringUpNote || undefined, valid_days: validDays })}>
        Save
      </Button>
    </div>
  );
}

function AnytimeForm({ config, onSubmit }: { config: AnytimeConfig; onSubmit: (c: AnytimeConfig) => void }) {
  const [reward, setReward] = useState(config.reward);
  const [limit, setLimit] = useState(config.per_member_limit);
  return (
    <div className="mt-4 space-y-3">
      <Field id="reward" label="Reward" value={reward} onChange={(e) => setReward(e.target.value)} />
      <Field id="limit" label="Per-member limit" type="number" min={1} value={limit} onChange={(e) => setLimit(Number(e.target.value))} />
      <Button className="mt-2" onClick={() => onSubmit({ reward, per_member_limit: limit })}>
        Save
      </Button>
    </div>
  );
}

type TimedFormSubmit = { reward: string; starts_date: string; ends_date: string };

/** Codex #6: dates go to the server as raw parts (starts_date/ends_date), resolved against the restaurant's timezone by updateProgramConfig — never a client-computed ISO instant. */
function TimedForm({ config, onSubmit }: { config: TimedConfig; onSubmit: (c: TimedFormSubmit) => void }) {
  const [reward, setReward] = useState(config.reward);
  const [startsAt, setStartsAt] = useState(toDateInputValue(config.starts_at));
  const [endsAt, setEndsAt] = useState(toDateInputValue(config.ends_at));
  return (
    <div className="mt-4 space-y-3">
      <Field id="reward" label="Reward" value={reward} onChange={(e) => setReward(e.target.value)} />
      <Field id="starts_at" label="Starts" type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
      <Field id="ends_at" label="Ends" type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
      <Button className="mt-2" onClick={() => onSubmit({ reward, starts_date: startsAt, ends_date: endsAt })}>
        Save
      </Button>
    </div>
  );
}

export function ProgramCard({ program, outstandingGrants }: { program: RewardProgram; outstandingGrants: OutstandingGrant[] }) {
  const [editing, setEditing] = useState(false);
  const [active, setActive] = useState(program.active);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [toggleConfirming, setToggleConfirming] = useState<boolean | null>(null); // the pending `next` value, or null when closed
  const [pending, startTransition] = useTransition();
  const extendNotifyDefault = useExtendNotifyDefault();

  function handleToggle(next: boolean) {
    setToggleConfirming(next);
  }

  function confirmToggle() {
    const next = toggleConfirming;
    if (next === null) return;
    setActive(next);
    setToggleConfirming(null);
    startTransition(async () => {
      const result = await toggleProgramActive(program.id, next);
      if (!result.ok) {
        setActive(!next);
        setSaveError(result.error);
      }
    });
  }

  function save(config: unknown) {
    setSaveError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateProgramConfig(program.id, config);
      if (!result.ok) setSaveError(result.error);
      else {
        setSaved(true);
        setEditing(false);
      }
    });
  }

  return (
    <Card shadow border>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-muted">{TYPE_LABEL[program.type]}</p>
          <h2 className="mt-1 font-display text-xl font-bold">{program.name}</h2>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => handleToggle(e.target.checked)}
            className="h-5 w-5 accent-coral"
          />
          Active
        </label>
      </div>
      <p className="mt-3 text-base text-muted">{summarize(program)}</p>

      {saveError && <p className="mt-3 text-sm font-semibold text-coral-dark">{saveError}</p>}
      {saved && <p className="mt-3 text-sm font-semibold text-ink">Saved.</p>}

      <Button variant="ghost" className="mt-4 px-0" onClick={() => setEditing((v) => !v)}>
        {editing ? "Cancel" : "Edit"}
      </Button>

      {editing && (
        <>
          {program.type === "welcome" && <WelcomeForm config={program.config as WelcomeConfig} onSubmit={save} />}
          {program.type === "come_back" && <ComeBackEditor config={program.config as ComeBackConfig} onSubmit={save} />}
          {program.type === "birthday" && <BirthdayEditor config={program.config as BirthdayConfig} onSubmit={save} />}
          {program.type === "anytime" && <AnytimeForm config={program.config as AnytimeConfig} onSubmit={save} />}
          {program.type === "timed" && <TimedForm config={program.config as TimedConfig} onSubmit={save} />}
          {program.type === "visit_ladder" && <LadderEditor config={program.config as VisitLadderConfig} onSubmit={save} />}
        </>
      )}

      {EXTENDABLE_PROGRAM_TYPES.has(program.type) && (
        <div className="mt-6 border-t-2 border-line pt-4">
          <p className="font-display text-base font-bold">Expiry extension</p>
          <ExtendAllForm programId={program.id} count={outstandingGrants.length} extendNotifyDefault={extendNotifyDefault} />
          {outstandingGrants.length > 0 && (
            <ul className="mt-4">
              {outstandingGrants.map((g) => (
                <ExtendGrantsRow key={g.id} grant={g} extendNotifyDefault={extendNotifyDefault} />
              ))}
            </ul>
          )}
        </div>
      )}

      <ConfirmDialog
        open={toggleConfirming !== null}
        title={toggleConfirming ? "Activate this reward?" : "Deactivate this reward?"}
        confirmLabel={toggleConfirming ? "Activate" : "Deactivate"}
        pending={pending}
        onConfirm={confirmToggle}
        onCancel={() => setToggleConfirming(null)}
        body={
          <p>
            {toggleConfirming
              ? "Members will start earning and receiving this reward again."
              : "Members stop earning or receiving this reward. Anything already on a member's card keeps working until it's used or expires."}
          </p>
        }
      />
    </Card>
  );
}
