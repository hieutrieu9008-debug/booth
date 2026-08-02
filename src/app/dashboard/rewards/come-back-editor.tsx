"use client";

import { useState } from "react";
import { Button, Card, Field } from "@/components/kit";
import { comeBackConfigSchema, type ComeBackBlock, type ComeBackConfig } from "@/lib/booth/programs";

export function freshId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `b-${Date.now()}-${Math.random()}`;
}

function errorsByPath(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.join(".");
    if (!map[key]) map[key] = issue.message;
  }
  return map;
}

export function ComeBackEditor({ config, onSubmit }: { config: ComeBackConfig; onSubmit: (c: ComeBackConfig) => void }) {
  // Existing blocks keep their id on every edit (WS1 contract — grants already
  // sent reference it); only newly-added blocks mint a fresh one.
  const [blocks, setBlocks] = useState<ComeBackBlock[]>(config.blocks);
  const [minDaysBetweenContact, setMinDaysBetweenContact] = useState(config.min_days_between_contact);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function addBlock() {
    const lastDaysQuiet = blocks[blocks.length - 1]?.days_quiet ?? 0;
    setBlocks((prev) => [...prev, { id: freshId(), days_quiet: lastDaysQuiet + 1, reward: "", valid_days: 7 }]);
  }
  function removeBlock(i: number) {
    setBlocks((prev) => prev.filter((_, idx) => idx !== i));
  }
  function updateBlock(i: number, patch: Partial<Omit<ComeBackBlock, "id">>) {
    setBlocks((prev) => prev.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  }

  function save() {
    const candidate: ComeBackConfig = { blocks, min_days_between_contact: minDaysBetweenContact };
    const parsed = comeBackConfigSchema.safeParse(candidate);
    if (!parsed.success) {
      setErrors(errorsByPath(parsed.error.issues));
      return;
    }
    setErrors({});
    onSubmit(parsed.data);
  }

  return (
    <div className="mt-4 space-y-4">
      <p className="text-sm text-muted">
        Only the deepest block a quiet member has crossed fires. So if someone&apos;s been gone 20 days and you have
        7d and 14d blocks, they get the 14d one, not both.
      </p>

      <div className="space-y-3">
        {blocks.map((block, i) => (
          <Card key={block.id} bg="paper" border className="!p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold text-muted">Block {i + 1}</p>
              {blocks.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeBlock(i)}
                  className="text-sm font-semibold text-coral-dark underline"
                >
                  Remove block
                </button>
              )}
            </div>
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              <Field
                id={`block-days-quiet-${block.id}`}
                label="Days quiet"
                type="number"
                min={1}
                value={block.days_quiet}
                onChange={(e) => updateBlock(i, { days_quiet: Number(e.target.value) })}
                error={errors[`blocks.${i}.days_quiet`]}
              />
              <Field
                id={`block-reward-${block.id}`}
                label="Reward"
                value={block.reward}
                onChange={(e) => updateBlock(i, { reward: e.target.value })}
                error={errors[`blocks.${i}.reward`]}
              />
              <Field
                id={`block-valid-days-${block.id}`}
                label="Valid for (days)"
                type="number"
                min={1}
                value={block.valid_days}
                onChange={(e) => updateBlock(i, { valid_days: Number(e.target.value) })}
                error={errors[`blocks.${i}.valid_days`]}
              />
            </div>
          </Card>
        ))}
      </div>

      <Button variant="secondary" onClick={addBlock}>
        + Add another block
      </Button>

      {errors["blocks"] && <p className="text-sm font-semibold text-coral-dark">{errors["blocks"]}</p>}

      <Field
        id="min_days_between_contact"
        label="Leave-alone window"
        type="number"
        min={0}
        value={minDaysBetweenContact}
        onChange={(e) => setMinDaysBetweenContact(Number(e.target.value))}
        hint="Don't text anyone who heard from you in the last N days. Set 0 to switch this off, your call. (Applies only to the automated win-back nudge, not manual messages.)"
      />

      <Button className="mt-2" onClick={save}>
        Save
      </Button>
    </div>
  );
}
