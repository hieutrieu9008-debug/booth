"use client";

import { useMemo, useState } from "react";
import { Button, Field } from "@/components/kit";
import { birthdayConfigSchema, type BirthdayConfig } from "@/lib/booth/programs";
import { renderTemplate } from "@/lib/booth/template";

function errorsByPath(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.join(".");
    if (!map[key]) map[key] = issue.message;
  }
  return map;
}

const VARIABLE_CHIPS = ["{name}", "{reward}", "{restaurant}", "{link}"];

/** Sample vars for the live preview — a demo card link, never a real member. */
const PREVIEW_VARS = { name: "Alex", restaurant: "Your restaurant", link: "https://bth.link/demo" };

export function BirthdayEditor({ config, onSubmit }: { config: BirthdayConfig; onSubmit: (c: BirthdayConfig) => void }) {
  const [reward, setReward] = useState(config.reward);
  const [mode, setMode] = useState<BirthdayConfig["mode"]>(config.mode);
  const [windowDays, setWindowDays] = useState(config.window_days ?? 14);
  const [message, setMessage] = useState(config.message ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const defaultMessage =
    mode === "month"
      ? `${PREVIEW_VARS.restaurant}: happy birthday month! {reward} is on your card, valid all month → {link}`
      : `${PREVIEW_VARS.restaurant}: happy birthday month! {reward} is on your card → {link}`;
  const preview = useMemo(
    () => renderTemplate(message.trim() || defaultMessage, { ...PREVIEW_VARS, reward: reward || "your reward" }),
    [message, defaultMessage, reward],
  );

  function save() {
    const candidate: BirthdayConfig = {
      reward,
      mode,
      window_days: mode === "window" ? windowDays : undefined,
      message: message.trim() || undefined,
    };
    const parsed = birthdayConfigSchema.safeParse(candidate);
    if (!parsed.success) {
      setErrors(errorsByPath(parsed.error.issues));
      return;
    }
    setErrors({});
    onSubmit(parsed.data);
  }

  return (
    <div className="mt-4 space-y-4">
      <Field id="reward" label="Reward" value={reward} onChange={(e) => setReward(e.target.value)} error={errors["reward"]} />

      <fieldset>
        <legend className="text-sm font-semibold text-ink">When it's valid</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setMode("window")}
            className={`rounded-button border-2 px-4 py-3 text-left text-sm font-semibold ${
              mode === "window" ? "border-ink bg-peach" : "border-line bg-cream"
            }`}
          >
            A window of days
            <span className="block text-xs font-normal text-muted">Valid for N days around their birthday.</span>
          </button>
          <button
            type="button"
            onClick={() => setMode("month")}
            className={`rounded-button border-2 px-4 py-3 text-left text-sm font-semibold ${
              mode === "month" ? "border-ink bg-peach" : "border-line bg-cream"
            }`}
          >
            Their whole birthday month
            <span className="block text-xs font-normal text-muted">Valid any day that month, no window to remember.</span>
          </button>
        </div>
      </fieldset>

      {mode === "window" && (
        <Field
          id="window_days"
          label="Window around birthday (days)"
          type="number"
          min={1}
          value={windowDays}
          onChange={(e) => setWindowDays(Number(e.target.value))}
          error={errors["window_days"]}
        />
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="birthday-message" className="text-sm font-semibold text-ink">
          Birthday text (optional — leave blank to use the standard wording)
        </label>
        <textarea
          id="birthday-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          placeholder={defaultMessage}
          className="rounded-button border-2 border-line bg-cream px-4 py-3 text-base text-ink placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral-dark"
        />
        <div className="flex flex-wrap gap-2">
          {VARIABLE_CHIPS.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => setMessage((prev) => `${prev}${chip}`)}
              className="rounded-full border-2 border-line bg-paper px-3 py-1 text-xs font-semibold text-ink"
            >
              {chip}
            </button>
          ))}
        </div>
        {errors["message"] && <p className="text-sm font-semibold text-coral-dark" role="alert">{errors["message"]}</p>}
        <p className="text-sm text-muted">
          Preview (sample member): <span className="font-semibold text-ink">&quot;{preview}&quot;</span>
        </p>
      </div>

      <Button className="mt-2" onClick={save}>
        Save
      </Button>
    </div>
  );
}
