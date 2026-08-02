"use client";

import { useState } from "react";
import { Button, Card, ConfirmDialog } from "@/components/kit";
import { EMPTY_INTAKE, type IntakeInput, type GiveawayComfort, type LeadMagnetChoice } from "@/lib/generator/types";
import type { GeneratedSetup } from "@/lib/generator/schema";
import type { ApplyResult } from "@/lib/generator/apply";
import type { MenuItem } from "@/lib/booth/programs";
import { applySetup, runGenerate } from "./actions";

const INTAKE_FIELDS: { key: keyof IntakeInput; label: string; placeholder: string }[] = [
  { key: "cuisine", label: "Restaurant type / cuisine", placeholder: "e.g. Neighbourhood Italian, family-run" },
  { key: "menuHighlights", label: "Menu highlights + rough prices", placeholder: "e.g. Truffle tagliatelle £16, garlic bread £5, tiramisu £6.50" },
  { key: "giveawayItems", label: "Items easy to give away", placeholder: "e.g. garlic bread, side salad, house wine glass" },
  { key: "marginComfort", label: "Margin comfort", placeholder: "e.g. happy to give starters/desserts, not mains" },
  { key: "slowNights", label: "Slow nights", placeholder: "e.g. Mondays and Tuesdays are dead" },
  { key: "avgTicket", label: "Average ticket", placeholder: "e.g. around £22 a head" },
  { key: "ownerGoals", label: "Owner goals", placeholder: "e.g. wants regulars to come back weekly, not just once" },
  { key: "extraNotes", label: "Anything else from the call", placeholder: "Optional" },
];

const PROGRAM_LABELS: Record<string, string> = {
  welcome: "Welcome perk",
  visit_ladder: "Visit ladder",
  birthday: "Birthday reward",
  come_back: "Come-back reward",
};

function textareaClass() {
  return "min-h-20 rounded-button border-2 border-line bg-cream px-4 py-2 text-base text-ink placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral-dark";
}

function textInputClass() {
  return "min-h-11 rounded-button border-2 border-line bg-cream px-4 text-base text-ink placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral-dark";
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <Card border shadow className="mt-4 border-coral-dark bg-cream">
      <p className="text-sm font-semibold text-coral-dark" role="alert">
        {message}
      </p>
    </Card>
  );
}

function WhatThisWillDo({ existingActiveTypes }: { existingActiveTypes: string[] }) {
  return (
    <Card border className="mt-4 bg-paper">
      <h2 className="font-display text-lg font-bold">What this will do</h2>
      <p className="mt-1 text-sm text-ink">
        Creates 4 programs (welcome perk, visit ladder, birthday reward, come-back reward), 4 draft campaigns, and sets the
        join page below. Nothing writes until you hit Apply — you review and edit everything first.
      </p>
      {existingActiveTypes.length > 0 ? (
        <p className="mt-2 text-sm font-semibold text-coral-dark">
          Active programs already exist for: {existingActiveTypes.map((t) => PROGRAM_LABELS[t] ?? t).join(", ")}. Applying will
          deactivate those (not delete them) and create the new set.
        </p>
      ) : (
        <p className="mt-2 text-sm text-muted">No active programs of these types exist yet — nothing will be overwritten.</p>
      )}
    </Card>
  );
}

type Stage = "intake" | "review";

export function GeneratorClient({
  slug,
  hasApiKey,
  menuItems,
  existingActiveTypes,
}: {
  slug: string;
  hasApiKey: boolean;
  menuItems: MenuItem[];
  existingActiveTypes: string[];
}) {
  const [stage, setStage] = useState<Stage>("intake");
  const [intake, setIntake] = useState<IntakeInput>({
    ...EMPTY_INTAKE,
    menuItems: menuItems.map((m) => ({ ...m, included: true })),
  });
  const [draft, setDraft] = useState<GeneratedSetup | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [usedAI, setUsedAI] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const [applying, setApplying] = useState(false);
  const [applyErrors, setApplyErrors] = useState<Record<string, string> | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [conflictTypes, setConflictTypes] = useState<string[] | null>(null);
  const [applied, setApplied] = useState<ApplyResult | null>(null);
  // #52 — typed restaurant-slug confirmation before a destructive replace.
  const [replaceConfirming, setReplaceConfirming] = useState(false);
  const [slugTyped, setSlugTyped] = useState("");

  async function handleGenerate() {
    setGenerating(true);
    setGenerateError(null);
    setApplyErrors(null);
    setApplyError(null);
    setConflictTypes(null);
    setApplied(null);
    try {
      const result = await runGenerate(intake);
      setDraft(result.draft);
      setNotice(result.notice);
      setUsedAI(result.usedAI);
      setStage("review");
    } catch (caught) {
      // WS5 bug fix: this used to have no catch — a rejected server action
      // (AI failure, network error, etc.) silently reverted the button with
      // zero feedback. Now it surfaces a visible error and keeps the intake
      // answers on screen so the operator can retry.
      setGenerateError(caught instanceof Error ? caught.message : "Generating failed — try again.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleApply(replaceExisting: boolean) {
    if (!draft) return;
    setApplying(true);
    setApplyErrors(null);
    setApplyError(null);
    try {
      const result = await applySetup(slug, draft, replaceExisting);
      if (result.ok) {
        setApplied(result);
        setConflictTypes(null);
      } else if (result.conflict) {
        setConflictTypes(result.existingTypes);
      } else {
        setApplyErrors(result.errors);
      }
    } catch (caught) {
      // Same fix as handleGenerate: a rejected applySetup (e.g. a network
      // error, or a throw the server action itself didn't catch) used to
      // vanish here too, silently re-showing the intake form with the draft
      // lost. Now the draft stays on screen and the failure is visible.
      setApplyError(caught instanceof Error ? caught.message : "Applying failed — try again.");
    } finally {
      setApplying(false);
    }
  }

  if (stage === "intake" || !draft) {
    return (
      <Card border shadow className="mt-6 max-w-3xl">
        {!hasApiKey && (
          <p className="mb-4 rounded bg-butter px-4 py-3 text-sm font-semibold text-ink">
            OPENAI_API_KEY is not set — generating will produce a manual draft you edit by hand. The intake form still works.
          </p>
        )}
        <WhatThisWillDo existingActiveTypes={existingActiveTypes} />
        <div className="mt-4 grid gap-4">
          {INTAKE_FIELDS.map((f) => (
            <div key={f.key} className="flex flex-col gap-1.5">
              <label htmlFor={f.key} className="text-sm font-semibold text-ink">
                {f.label}
              </label>
              <textarea
                id={f.key}
                value={intake[f.key] as string}
                placeholder={f.placeholder}
                onChange={(e) => setIntake((prev) => ({ ...prev, [f.key]: e.target.value }))}
                className={textareaClass()}
              />
            </div>
          ))}
        </div>

        {menuItems.length > 0 && (
          <div className="mt-6">
            <p className="text-sm font-semibold text-ink">Menu import feed</p>
            <p className="text-xs text-muted">Untick items you don&apos;t want the generator to consider for rewards.</p>
            <div className="mt-2 flex flex-col gap-1.5">
              {intake.menuItems.map((m, i) => (
                <label key={i} className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={m.included}
                    onChange={(e) => {
                      const next = [...intake.menuItems];
                      next[i] = { ...m, included: e.target.checked };
                      setIntake((prev) => ({ ...prev, menuItems: next }));
                    }}
                    className="h-4 w-4"
                  />
                  {m.name}
                  {m.price !== undefined ? ` — £${m.price.toFixed(2)}` : ""}
                  {m.category ? ` (${m.category})` : ""}
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6">
          <p className="text-sm font-semibold text-ink">Giveaway comfort by price tier</p>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            {(["cheap", "mid", "premium"] as const).map((tier) => (
              <div key={tier} className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-muted capitalize">{tier}</label>
                <select
                  value={intake.giveawayComfort[tier]}
                  onChange={(e) =>
                    setIntake((prev) => ({
                      ...prev,
                      giveawayComfort: { ...prev.giveawayComfort, [tier]: e.target.value as GiveawayComfort },
                    }))
                  }
                  className={textInputClass()}
                >
                  <option value="readily">Readily</option>
                  <option value="occasionally">Occasionally</option>
                  <option value="rarely">Rarely</option>
                </select>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6">
          <p className="text-sm font-semibold text-ink">Join page lead magnet</p>
          <div className="mt-2 flex flex-col gap-2">
            {(["ladder", "vip", "custom"] as const).map((choice) => (
              <label key={choice} className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="radio"
                  name="leadMagnet"
                  checked={intake.leadMagnet.choice === choice}
                  onChange={() => setIntake((prev) => ({ ...prev, leadMagnet: { ...prev.leadMagnet, choice: choice as LeadMagnetChoice } }))}
                  className="h-4 w-4"
                />
                {choice === "ladder" && "Visit ladder (join to start earning stamps)"}
                {choice === "vip" && "VIP framing (join to become a regular / VIP)"}
                {choice === "custom" && "Custom text"}
              </label>
            ))}
          </div>
          {(intake.leadMagnet.choice === "vip" || intake.leadMagnet.choice === "custom") && (
            <input
              value={intake.leadMagnet.headline}
              placeholder="Optional headline"
              onChange={(e) => setIntake((prev) => ({ ...prev, leadMagnet: { ...prev.leadMagnet, headline: e.target.value } }))}
              className={`${textInputClass()} mt-2 w-full`}
            />
          )}
          {intake.leadMagnet.choice === "custom" && (
            <textarea
              value={intake.leadMagnet.customText}
              placeholder="Custom join-page text"
              onChange={(e) => setIntake((prev) => ({ ...prev, leadMagnet: { ...prev.leadMagnet, customText: e.target.value } }))}
              className={`${textareaClass()} mt-2 w-full`}
            />
          )}
        </div>

        <Button type="button" className="mt-6" disabled={generating} onClick={handleGenerate}>
          {generating ? "Drafting…" : "Generate setup"}
        </Button>
        {generateError && <ErrorBanner message={generateError} />}
      </Card>
    );
  }

  return (
    <div className="mt-6 max-w-3xl">
      {notice && <p className="mb-4 rounded bg-butter px-4 py-3 text-sm font-semibold text-ink">{notice}</p>}
      {!notice && usedAI && <p className="mb-4 text-sm font-semibold text-ink">AI draft — review and edit before applying.</p>}

      <Button type="button" variant="ghost" onClick={() => setStage("intake")} className="mb-4">
        ← Back to intake
      </Button>

      <WhatThisWillDo existingActiveTypes={existingActiveTypes} />

      <ProgramEditor
        title="Welcome perk"
        entry={draft.welcome}
        error={applyErrors?.welcome}
        onChange={(entry) => setDraft({ ...draft, welcome: entry as GeneratedSetup["welcome"] })}
        fields={["reward", "ring_up_note", "valid_days"]}
      />

      <LadderEditor draft={draft} setDraft={setDraft} error={applyErrors?.visit_ladder} />

      <ProgramEditor
        title="Birthday"
        entry={draft.birthday}
        error={applyErrors?.birthday}
        onChange={(entry) => setDraft({ ...draft, birthday: entry as GeneratedSetup["birthday"] })}
        fields={["reward", "window_days"]}
      />

      <ComeBackEditor draft={draft} setDraft={setDraft} error={applyErrors?.come_back} />

      <JoinPageEditor draft={draft} setDraft={setDraft} error={applyErrors?.join_page} />

      <Card border shadow className="mt-4">
        <h2 className="font-display text-xl font-bold">Campaign drafts</h2>
        <div className="mt-3 flex flex-col gap-4">
          {draft.campaigns.map((c, i) => (
            <div key={i} className="rounded border-2 border-line bg-cream p-3">
              <div className="flex items-center justify-between gap-3">
                <label className="text-sm font-semibold text-ink">Audience</label>
                <select
                  value={c.audience}
                  onChange={(e) => {
                    const campaigns = [...draft.campaigns];
                    campaigns[i] = { ...c, audience: e.target.value as GeneratedSetup["campaigns"][number]["audience"] };
                    setDraft({ ...draft, campaigns });
                  }}
                  className={textInputClass()}
                >
                  <option value="all">all</option>
                  <option value="gone_quiet">gone_quiet</option>
                  <option value="redeemed_before">redeemed_before</option>
                  <option value="new">new</option>
                </select>
              </div>
              <textarea
                value={c.body}
                onChange={(e) => {
                  const campaigns = [...draft.campaigns];
                  campaigns[i] = { ...c, body: e.target.value };
                  setDraft({ ...draft, campaigns });
                }}
                className={`${textareaClass()} mt-2 w-full`}
              />
              <p className="mt-1 text-xs text-muted">{c.body.length}/160 chars</p>
              <input
                value={c.suggested_send_note}
                onChange={(e) => {
                  const campaigns = [...draft.campaigns];
                  campaigns[i] = { ...c, suggested_send_note: e.target.value };
                  setDraft({ ...draft, campaigns });
                }}
                className={`${textInputClass()} mt-2 w-full`}
                placeholder="Suggested send note"
              />
              {applyErrors?.[`campaign_${i}`] && (
                <p className="mt-1 text-sm font-semibold text-coral-dark">{applyErrors[`campaign_${i}`]}</p>
              )}
            </div>
          ))}
        </div>
      </Card>

      {conflictTypes && conflictTypes.length > 0 && (
        <Card border shadow className="mt-4 bg-butter">
          <p className="text-sm font-semibold text-ink">
            Active programs already exist for: {conflictTypes.join(", ")}. Applying again will deactivate those and create
            the new set instead of deleting them.
          </p>
          <Button
            type="button"
            className="mt-3"
            disabled={applying}
            onClick={() => {
              setSlugTyped("");
              setReplaceConfirming(true);
            }}
          >
            {applying ? "Replacing…" : "Replace existing"}
          </Button>
        </Card>
      )}

      <ConfirmDialog
        open={replaceConfirming}
        title="Replace this tenant's active programs?"
        confirmLabel={applying ? "Replacing…" : "Replace existing"}
        pending={applying}
        confirmDisabled={slugTyped.trim() !== slug}
        onConfirm={() => {
          setReplaceConfirming(false);
          handleApply(true);
        }}
        onCancel={() => setReplaceConfirming(false)}
        body={
          <p>
            This deactivates the existing {conflictTypes?.join(", ")} program(s) for <strong>{slug}</strong> and creates
            the new set from this draft instead. Not delete — the old rows stay, deactivated. Reversible: no (they'd need
            to be reactivated and re-edited by hand).
          </p>
        }
      >
        <label className="flex flex-col gap-1.5 text-sm text-ink">
          Type the restaurant slug (<strong>{slug}</strong>) to confirm
          <input
            value={slugTyped}
            onChange={(e) => setSlugTyped(e.target.value)}
            className="min-h-11 rounded-button border-2 border-line bg-cream px-4 text-base"
          />
        </label>
      </ConfirmDialog>

      {applyErrors && !conflictTypes && (
        <p className="mt-4 text-sm font-semibold text-coral-dark" role="alert">
          {applyErrors._draft ?? "Fix the highlighted fields above before applying."}
        </p>
      )}

      {applyError && <ErrorBanner message={applyError} />}

      {applied && applied.ok && (
        <p className="mt-4 rounded bg-butter px-4 py-3 text-sm font-semibold text-ink">
          {applied.numberNotice ?? `Applied: ${applied.programCount} programs, ${applied.campaignCount} campaign drafts.`}
        </p>
      )}

      {!applied?.ok && (
        <Button type="button" className="mt-4" disabled={applying} onClick={() => handleApply(false)}>
          {applying ? "Applying…" : "Apply to tenant"}
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small editors — kept generic-ish rather than one component per program
// type, since welcome/birthday all share the {name, config: {reward, ...}} shape.
// ---------------------------------------------------------------------------

type SimpleEntry = { name: string; config: Record<string, string | number | null> };

function ProgramEditor({
  title,
  entry,
  error,
  onChange,
  fields,
}: {
  title: string;
  entry: SimpleEntry;
  error?: string;
  onChange: (entry: SimpleEntry) => void;
  fields: string[];
}) {
  return (
    <Card border shadow className="mt-4">
      <h2 className="font-display text-xl font-bold">{title}</h2>
      <div className="mt-3 grid gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-semibold text-ink">Program name</label>
          <input
            value={entry.name}
            onChange={(e) => onChange({ ...entry, name: e.target.value })}
            className={textInputClass()}
          />
        </div>
        {fields.map((field) => (
          <div key={field} className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-ink">{fieldLabel(field)}</label>
            <input
              value={entry.config[field] ?? ""}
              type={field.includes("days") ? "number" : "text"}
              onChange={(e) =>
                onChange({
                  ...entry,
                  config: {
                    ...entry.config,
                    [field]: field.includes("days") ? Number(e.target.value) : e.target.value,
                  },
                })
              }
              className={textInputClass()}
            />
          </div>
        ))}
      </div>
      {error && <p className="mt-2 text-sm font-semibold text-coral-dark">{error}</p>}
    </Card>
  );
}

function fieldLabel(field: string): string {
  switch (field) {
    case "reward":
      return "Reward";
    case "ring_up_note":
      return "Ring-up note (staff-facing)";
    case "valid_days":
      return "Valid for (days)";
    case "window_days":
      return "Birthday window (days)";
    default:
      return field;
  }
}

// WS1 stopgap — draft rungs are always single-option (see schema.ts)
function LadderEditor({
  draft,
  setDraft,
  error,
}: {
  draft: GeneratedSetup;
  setDraft: (draft: GeneratedSetup) => void;
  error?: string;
}) {
  const ladder = draft.ladder;

  function updateConfig(patch: Partial<GeneratedSetup["ladder"]["config"]>) {
    setDraft({ ...draft, ladder: { ...ladder, config: { ...ladder.config, ...patch } } });
  }

  function updateRungVisits(index: number, visits: number) {
    const rungs = ladder.config.rungs.map((r, i) => (i === index ? { ...r, visits } : r));
    updateConfig({ rungs });
  }

  function updateRungOption(index: number, patch: Partial<GeneratedSetup["ladder"]["config"]["rungs"][number]["options"][number]>) {
    const rungs = ladder.config.rungs.map((r, i) => (i === index ? { ...r, options: [{ ...r.options[0], ...patch }] } : r));
    updateConfig({ rungs });
  }

  return (
    <Card border shadow className="mt-4">
      <h2 className="font-display text-xl font-bold">Visit ladder</h2>
      <div className="mt-3 grid gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-semibold text-ink">Program name</label>
          <input value={ladder.name} onChange={(e) => setDraft({ ...draft, ladder: { ...ladder, name: e.target.value } })} className={textInputClass()} />
        </div>
        <div className="flex items-center gap-6">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-ink">Endowed start</label>
            <input
              type="number"
              value={ladder.config.endowed_start}
              onChange={(e) => updateConfig({ endowed_start: Number(e.target.value) })}
              className={`${textInputClass()} w-24`}
            />
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold text-ink">
            <input
              type="checkbox"
              checked={ladder.config.loop}
              onChange={(e) => updateConfig({ loop: e.target.checked })}
              className="h-5 w-5"
            />
            Loops (relaunches after the last rung)
          </label>
        </div>

        {ladder.config.rungs.map((rung, i) => (
          <div key={i} className="rounded border-2 border-line bg-cream p-3">
            <p className="text-sm font-semibold text-ink">Rung {i + 1}</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-muted">Visits</label>
                <input type="number" value={rung.visits} onChange={(e) => updateRungVisits(i, Number(e.target.value))} className={textInputClass()} />
              </div>
              <div className="flex flex-col gap-1 sm:col-span-2">
                <label className="text-xs font-semibold text-muted">Reward</label>
                <input value={rung.options[0].reward} onChange={(e) => updateRungOption(i, { reward: e.target.value })} className={textInputClass()} />
              </div>
            </div>
            <div className="mt-2 flex flex-col gap-1">
              <label className="text-xs font-semibold text-muted">Ring-up note</label>
              <input
                value={rung.options[0].ring_up_note ?? ""}
                onChange={(e) => updateRungOption(i, { ring_up_note: e.target.value })}
                className={textInputClass()}
              />
            </div>
          </div>
        ))}
      </div>
      {error && <p className="mt-2 text-sm font-semibold text-coral-dark">{error}</p>}
    </Card>
  );
}

// Come-back's canonical shape is blocks-with-ids (WS1); the draft only ever
// proposes one block. days_quiet isn't drafted here — apply.ts fills it from
// the restaurant's gone_quiet_weeks setting when applying.
function ComeBackEditor({
  draft,
  setDraft,
  error,
}: {
  draft: GeneratedSetup;
  setDraft: (draft: GeneratedSetup) => void;
  error?: string;
}) {
  const comeBack = draft.come_back;
  const block = comeBack.config.blocks[0];

  function updateBlock(patch: Partial<GeneratedSetup["come_back"]["config"]["blocks"][number]>) {
    setDraft({ ...draft, come_back: { ...comeBack, config: { blocks: [{ ...block, ...patch }] } } });
  }

  return (
    <Card border shadow className="mt-4">
      <h2 className="font-display text-xl font-bold">Come-back</h2>
      <div className="mt-3 grid gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-semibold text-ink">Program name</label>
          <input
            value={comeBack.name}
            onChange={(e) => setDraft({ ...draft, come_back: { ...comeBack, name: e.target.value } })}
            className={textInputClass()}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-semibold text-ink">Reward</label>
          <input value={block.reward} onChange={(e) => updateBlock({ reward: e.target.value })} className={textInputClass()} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-semibold text-ink">Valid for (days)</label>
          <input
            type="number"
            value={block.valid_days}
            onChange={(e) => updateBlock({ valid_days: Number(e.target.value) })}
            className={`${textInputClass()} w-32`}
          />
        </div>
      </div>
      {error && <p className="mt-2 text-sm font-semibold text-coral-dark">{error}</p>}
    </Card>
  );
}

function JoinPageEditor({
  draft,
  setDraft,
  error,
}: {
  draft: GeneratedSetup;
  setDraft: (draft: GeneratedSetup) => void;
  error?: string;
}) {
  const joinPage = draft.join_page;
  const magnet = joinPage?.magnet ?? "ladder";

  function setMagnet(next: LeadMagnetChoice) {
    if (next === "ladder") setDraft({ ...draft, join_page: { magnet: "ladder" } });
    else if (next === "vip") setDraft({ ...draft, join_page: { magnet: "vip", headline: undefined } });
    else setDraft({ ...draft, join_page: { magnet: "custom", custom_text: "", headline: undefined } });
  }

  return (
    <Card border shadow className="mt-4">
      <h2 className="font-display text-xl font-bold">Join page</h2>
      <p className="mt-1 text-sm text-muted">What visitors see before they join — the lead magnet framing.</p>
      <div className="mt-3 flex flex-col gap-2">
        {(["ladder", "vip", "custom"] as const).map((choice) => (
          <label key={choice} className="flex items-center gap-2 text-sm text-ink">
            <input type="radio" name="joinPageMagnet" checked={magnet === choice} onChange={() => setMagnet(choice)} className="h-4 w-4" />
            {choice === "ladder" && "Visit ladder"}
            {choice === "vip" && "VIP framing"}
            {choice === "custom" && "Custom text"}
          </label>
        ))}
      </div>
      {joinPage && joinPage.magnet !== "ladder" && (
        <input
          value={joinPage.headline ?? ""}
          placeholder="Optional headline"
          onChange={(e) => setDraft({ ...draft, join_page: { ...joinPage, headline: e.target.value || undefined } })}
          className={`${textInputClass()} mt-2 w-full`}
        />
      )}
      {joinPage?.magnet === "custom" && (
        <textarea
          value={joinPage.custom_text}
          onChange={(e) => setDraft({ ...draft, join_page: { ...joinPage, custom_text: e.target.value } })}
          className={`${textareaClass()} mt-2 w-full`}
          placeholder="Custom join-page text"
        />
      )}
      {error && <p className="mt-2 text-sm font-semibold text-coral-dark">{error}</p>}
    </Card>
  );
}
