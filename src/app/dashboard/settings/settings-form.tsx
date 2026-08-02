"use client";

import { useMemo, useState, useTransition } from "react";
import { Button, Card, Field } from "@/components/kit";
import { renderTemplate } from "@/lib/booth/template";
import { updateMessageTemplatesAction, updateSettingsAction } from "./actions";
import type { SettingsPageData } from "./data";

function quietHoursLabel(start: number, end: number): string {
  const fmt = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;
  return `${fmt(start)} – ${fmt(end)}`;
}

const PREVIEW_VARS = { restaurant: "Your restaurant", link: "https://bth.link/demo" };
const WELCOME_DEFAULT = `${PREVIEW_VARS.restaurant}: your rewards card → {link}`;
const COME_BACK_DEFAULT = `${PREVIEW_VARS.restaurant}: we miss you. {reward} is waiting on your card → {link}`;

/** Welcome + come-back message wording — same variable-chip/live-preview pattern as the birthday editor (src/app/dashboard/rewards/birthday-editor.tsx), wired to restaurants.message_templates via updateMessageTemplatesAction. */
function MessageTemplatesEditor({ data }: { data: SettingsPageData }) {
  const [welcome, setWelcome] = useState(data.messageTemplates.welcome ?? "");
  const [comeBack, setComeBack] = useState(data.messageTemplates.come_back ?? "");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const welcomePreview = useMemo(
    () => renderTemplate(welcome.trim() || WELCOME_DEFAULT, PREVIEW_VARS),
    [welcome],
  );
  const comeBackPreview = useMemo(
    () => renderTemplate(comeBack.trim() || COME_BACK_DEFAULT, { ...PREVIEW_VARS, reward: "Free coffee" }),
    [comeBack],
  );

  function save() {
    setResult(null);
    startTransition(async () => {
      const res = await updateMessageTemplatesAction({ welcome, comeBack });
      setResult(res.ok ? { ok: true, message: "Saved." } : { ok: false, message: res.error });
    });
  }

  return (
    <Card shadow border>
      <h2 className="font-display text-xl font-bold">Message wording</h2>
      <p className="mt-2 text-sm text-muted">
        Your birthday text has its own editor and preview under the Birthday reward in Rewards.
      </p>
      <a href="/dashboard/rewards" className="mt-1 inline-block text-sm font-semibold text-coral-dark underline">
        Edit birthday wording →
      </a>

      <div className="mt-4 flex flex-col gap-1.5">
        <label htmlFor="welcome-message" className="text-sm font-semibold text-ink">
          Welcome text (optional — leave blank to use the standard wording)
        </label>
        <textarea
          id="welcome-message"
          value={welcome}
          onChange={(e) => setWelcome(e.target.value)}
          rows={2}
          placeholder={WELCOME_DEFAULT}
          className="rounded-button border-2 border-line bg-cream px-4 py-3 text-base text-ink placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral-dark"
        />
        <div className="flex flex-wrap gap-2">
          {["{restaurant}", "{link}"].map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => setWelcome((prev) => `${prev}${chip}`)}
              className="rounded-full border-2 border-line bg-paper px-3 py-1 text-xs font-semibold text-ink"
            >
              {chip}
            </button>
          ))}
        </div>
        <p className="text-sm text-muted">
          Preview: <span className="font-semibold text-ink">&quot;{welcomePreview}&quot;</span>
        </p>
      </div>

      <div className="mt-4 flex flex-col gap-1.5">
        <label htmlFor="come-back-message" className="text-sm font-semibold text-ink">
          Come-back text (optional — leave blank to use the standard wording)
        </label>
        <textarea
          id="come-back-message"
          value={comeBack}
          onChange={(e) => setComeBack(e.target.value)}
          rows={2}
          placeholder={COME_BACK_DEFAULT}
          className="rounded-button border-2 border-line bg-cream px-4 py-3 text-base text-ink placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral-dark"
        />
        <div className="flex flex-wrap gap-2">
          {["{restaurant}", "{reward}", "{link}"].map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => setComeBack((prev) => `${prev}${chip}`)}
              className="rounded-full border-2 border-line bg-paper px-3 py-1 text-xs font-semibold text-ink"
            >
              {chip}
            </button>
          ))}
        </div>
        <p className="text-sm text-muted">
          Preview: <span className="font-semibold text-ink">&quot;{comeBackPreview}&quot;</span>
        </p>
      </div>

      {result && (
        <p className={`mt-3 text-sm font-semibold ${result.ok ? "text-ink" : "text-coral-dark"}`} role="status">
          {result.message}
        </p>
      )}
      <Button className="mt-4" disabled={pending} onClick={save}>
        {pending ? "Saving…" : "Save wording"}
      </Button>
    </Card>
  );
}

export function SettingsForm({ data }: { data: SettingsPageData }) {
  const [extendNotifyDefault, setExtendNotifyDefault] = useState(data.settings.extend_notify_default);
  const [expiryReminderDays, setExpiryReminderDays] = useState(data.settings.expiry_reminder_days);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  function save() {
    setResult(null);
    startTransition(async () => {
      const res = await updateSettingsAction({ extendNotifyDefault, expiryReminderDays });
      setResult(res.ok ? { ok: true, message: "Saved." } : { ok: false, message: res.error });
    });
  }

  return (
    <div className="mt-8 space-y-6">
      <Card shadow border>
        <h2 className="font-display text-xl font-bold">Your restaurant</h2>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="font-semibold text-ink">Timezone</dt>
            <dd className="text-muted">{data.timezone}</dd>
          </div>
          <div>
            <dt className="font-semibold text-ink">Country</dt>
            <dd className="text-muted">{data.country}</dd>
          </div>
          <div>
            <dt className="font-semibold text-ink">Currency</dt>
            <dd className="text-muted">{data.currency}</dd>
          </div>
        </dl>
        <p className="mt-3 text-sm text-muted">
          These come from your account setup. To change them, get in touch — they affect scheduling and message wording
          across the app.
        </p>
      </Card>

      <Card shadow border>
        <h2 className="font-display text-xl font-bold">Quiet hours</h2>
        <p className="mt-2 text-sm text-muted">
          Marketing texts never send during quiet hours (transactional texts, like a redemption QR, are exempt).
        </p>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="font-semibold text-ink">Platform floor (fixed)</dt>
            <dd className="text-muted">{quietHoursLabel(data.platformQuietStart, data.platformQuietEnd)}, every restaurant</dd>
          </div>
          <div>
            <dt className="font-semibold text-ink">Your restaurant&apos;s window</dt>
            <dd className="text-muted">
              {quietHoursLabel(data.tenantQuietStart, data.tenantQuietEnd)} (widest of this and the platform floor always
              applies)
            </dd>
          </div>
        </dl>
      </Card>

      <Card shadow border>
        <h2 className="font-display text-xl font-bold">Reward extensions</h2>
        <label className="mt-3 flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={extendNotifyDefault}
            onChange={(e) => setExtendNotifyDefault(e.target.checked)}
            className="h-5 w-5 accent-coral"
          />
          Default to texting members when you extend their reward&apos;s expiry
        </label>
        <p className="mt-1 text-sm text-muted">
          You can still turn this off per-extension in Rewards — this just sets the starting checkbox state.
        </p>
      </Card>

      <Card shadow border>
        <h2 className="font-display text-xl font-bold">Expiry reminders</h2>
        <Field
          id="expiry-reminder-days"
          label="Remind members this many days before a reward expires"
          type="number"
          min={1}
          value={expiryReminderDays}
          onChange={(e) => setExpiryReminderDays(Number(e.target.value))}
          className="mt-3 max-w-xs"
        />
      </Card>

      <Card shadow border>
        <h2 className="font-display text-xl font-bold">Win-back pacing</h2>
        <p className="mt-2 text-sm text-muted">
          How often the automated come-back nudge can re-text a quiet member lives with your Win-back program, not here.
        </p>
        <a href="/dashboard/rewards" className="mt-2 inline-block text-sm font-semibold text-coral-dark underline">
          Edit in Rewards →
        </a>
      </Card>

      <MessageTemplatesEditor data={data} />

      {result && (
        <p className={`text-sm font-semibold ${result.ok ? "text-ink" : "text-coral-dark"}`} role="status">
          {result.message}
        </p>
      )}

      <Button disabled={pending} onClick={save}>
        {pending ? "Saving…" : "Save settings"}
      </Button>
    </div>
  );
}
