"use client";

import { useState } from "react";
import { Button, Card, Checkbox, Field } from "@/components/kit";
import { visitLadderConfigSchema, type LadderOption, type VisitLadderConfig } from "@/lib/booth/programs";

type UiOption = LadderOption & { key: string };
type UiRung = { key: string; visits: number; options: UiOption[] };

let uidCounter = 0;
function uid(): string {
  uidCounter += 1;
  return `ui-${Date.now()}-${uidCounter}`;
}

export function toUiRungs(rungs: VisitLadderConfig["rungs"]): UiRung[] {
  return rungs.map((r) => ({ key: uid(), visits: r.visits, options: r.options.map((o) => ({ ...o, key: uid() })) }));
}

export function fromUiRungs(rungs: UiRung[]): VisitLadderConfig["rungs"] {
  return rungs.map(({ key: _key, options, ...rest }) => ({
    ...rest,
    options: options.map(({ key: _optKey, ...opt }) => opt),
  }));
}

/** Field-path -> message, keyed like zod issue paths joined with '.' (e.g. "rungs.1.visits"). */
function errorsByPath(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.join(".");
    if (!map[key]) map[key] = issue.message;
  }
  return map;
}

export function LadderEditor({ config, onSubmit }: { config: VisitLadderConfig; onSubmit: (c: VisitLadderConfig) => void }) {
  const [endowedStart, setEndowedStart] = useState(config.endowed_start);
  const [loop, setLoop] = useState(config.loop);
  const [rungs, setRungs] = useState<UiRung[]>(() => toUiRungs(config.rungs));
  const [errors, setErrors] = useState<Record<string, string>>({});

  function addRung() {
    const lastVisits = rungs[rungs.length - 1]?.visits ?? 0;
    setRungs((prev) => [...prev, { key: uid(), visits: lastVisits + 1, options: [{ key: uid(), reward: "" }] }]);
  }
  function removeRung(i: number) {
    setRungs((prev) => prev.filter((_, idx) => idx !== i));
  }
  function updateRungVisits(i: number, visits: number) {
    setRungs((prev) => prev.map((r, idx) => (idx === i ? { ...r, visits } : r)));
  }
  function addOption(rungIndex: number) {
    setRungs((prev) =>
      prev.map((r, idx) => (idx === rungIndex ? { ...r, options: [...r.options, { key: uid(), reward: "" }] } : r)),
    );
  }
  function removeOption(rungIndex: number, optionIndex: number) {
    setRungs((prev) =>
      prev.map((r, idx) => (idx === rungIndex ? { ...r, options: r.options.filter((_, oi) => oi !== optionIndex) } : r)),
    );
  }
  function updateOption(rungIndex: number, optionIndex: number, patch: Partial<LadderOption>) {
    setRungs((prev) =>
      prev.map((r, idx) =>
        idx === rungIndex ? { ...r, options: r.options.map((o, oi) => (oi === optionIndex ? { ...o, ...patch } : o)) } : r,
      ),
    );
  }

  function save() {
    const candidate: VisitLadderConfig = { endowed_start: endowedStart, loop, rungs: fromUiRungs(rungs) };
    const parsed = visitLadderConfigSchema.safeParse(candidate);
    if (!parsed.success) {
      setErrors(errorsByPath(parsed.error.issues));
      return;
    }
    setErrors({});
    onSubmit(parsed.data);
  }

  return (
    <div className="mt-4 space-y-4">
      <p className="text-sm font-semibold text-coral-dark">Members keep the progress they already have.</p>
      <Field
        id="endowed_start"
        label="Head start (visits already stamped for new joiners)"
        type="number"
        min={0}
        value={endowedStart}
        onChange={(e) => setEndowedStart(Number(e.target.value))}
        error={errors["endowed_start"]}
      />
      <Checkbox
        id="loop"
        label="Loop back to the first rung after the last reward"
        checked={loop}
        onChange={(e) => setLoop(e.target.checked)}
      />
      {loop && (
        <p className="-mt-2 text-sm text-muted">
          After the last reward at {rungs[rungs.length - 1]?.visits ?? "N"} visits, the card starts a fresh lap. The
          member keeps earning rewards on repeat.
        </p>
      )}

      <div className="space-y-3">
        {rungs.map((rung, i) => (
          <Card key={rung.key} bg="paper" border className="!p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold text-muted">Rung {i + 1}</p>
              {rungs.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeRung(i)}
                  className="text-sm font-semibold text-coral-dark underline"
                >
                  Remove rung
                </button>
              )}
            </div>
            <Field
              id={`rung-visits-${rung.key}`}
              label="Visits"
              type="number"
              min={1}
              className="mt-2 max-w-[10rem]"
              value={rung.visits}
              onChange={(e) => updateRungVisits(i, Number(e.target.value))}
              error={errors[`rungs.${i}.visits`]}
            />

            <div className="mt-4 space-y-3">
              <p className="text-sm font-semibold text-ink">
                Reward option{rung.options.length > 1 ? "s" : ""}
                {rung.options.length > 1 && <span className="ml-1 font-normal text-muted">(member picks one when they earn it)</span>}
              </p>
              {rung.options.length > 1 && (
                <p className="text-sm text-muted">
                  Tip: keep options at roughly the same price point so the choice feels fair.
                </p>
              )}
              {rung.options.map((option, oi) => (
                <div key={option.key} className="rounded-card border-2 border-line bg-cream p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-semibold text-muted">Option {oi + 1}</p>
                    {rung.options.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeOption(i, oi)}
                        className="text-xs font-semibold text-coral-dark underline"
                      >
                        Remove option
                      </button>
                    )}
                  </div>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    <Field
                      id={`rung-reward-${option.key}`}
                      label="Reward"
                      value={option.reward}
                      onChange={(e) => updateOption(i, oi, { reward: e.target.value })}
                      error={errors[`rungs.${i}.options.${oi}.reward`]}
                    />
                    <Field
                      id={`rung-note-${option.key}`}
                      label="Ring-up note (staff-only)"
                      value={option.ring_up_note ?? ""}
                      onChange={(e) => updateOption(i, oi, { ring_up_note: e.target.value || undefined })}
                    />
                  </div>
                </div>
              ))}
              <Button variant="ghost" className="px-0 text-sm" onClick={() => addOption(i)}>
                + Add another option
              </Button>
            </div>
          </Card>
        ))}
      </div>

      <Button variant="secondary" onClick={addRung}>
        + Add another rung
      </Button>

      {errors["rungs"] && <p className="text-sm font-semibold text-coral-dark">{errors["rungs"]}</p>}

      <Button className="mt-2" onClick={save}>
        Save
      </Button>
    </div>
  );
}
