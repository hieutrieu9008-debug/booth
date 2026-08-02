"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Button, Card, Checkbox, ConfirmDialog, Field } from "@/components/kit";
import type { AudienceFilters } from "@/lib/booth/audiences";
import type { CampaignAudience } from "@/lib/booth/types";
import type { CadenceSignal } from "@/lib/booth/dashboard-data";
import { formatWallTimeSummary, generateTimeOptions, wallTimeToUtc } from "@/lib/booth/schedule";
import type { OfferOption, RestaurantScheduleContext, SegmentCounts } from "./data";
import { createMessageAction, recountAudienceAction } from "./actions";

const STOP_SUFFIX = " Reply STOP to opt out.";

const AUDIENCE_OPTIONS: { value: CampaignAudience; label: string }[] = [
  { value: "all", label: "All" },
  { value: "gone_quiet", label: "Gone quiet" },
  { value: "redeemed_before", label: "Redeemed before" },
  { value: "new", label: "New" },
];

type MessageMode = "message_only" | "message_with_offer";

function smsSegments(text: string): number {
  if (text.length === 0) return 0;
  if (text.length <= 160) return 1;
  return Math.ceil(text.length / 153);
}

const EMPTY_FILTERS: AudienceFilters = {};

function cleanFilters(filters: AudienceFilters): AudienceFilters {
  const cleaned: AudienceFilters = {};
  if (filters.redeemed_within_days) cleaned.redeemed_within_days = filters.redeemed_within_days;
  if (filters.redeemed_program_id) cleaned.redeemed_program_id = filters.redeemed_program_id;
  if (filters.min_visits) cleaned.min_visits = filters.min_visits;
  if (filters.joined_within_days) cleaned.joined_within_days = filters.joined_within_days;
  if (filters.birthday_this_month) cleaned.birthday_this_month = true;
  if (filters.near_reward) cleaned.near_reward = true;
  return cleaned;
}

function hasAnyFilter(filters: AudienceFilters): boolean {
  return Object.keys(cleanFilters(filters)).length > 0;
}

/** Plain-English "what happens" panel — audience + live count, exact text, where the offer lands, and what gets logged. Read before sending, not after. */
function ConsequencePreview({
  audienceLabel,
  count,
  previewBody,
  mode,
  offer,
  sendNow,
  scheduledSummary,
}: {
  audienceLabel: string;
  count: number | null;
  previewBody: string;
  mode: MessageMode;
  offer: OfferOption | null;
  sendNow: boolean;
  /** Pre-formatted resolved send time in the restaurant's own timezone, or null when nothing's picked yet. */
  scheduledSummary: string | null;
}) {
  return (
    <Card bg="paper" border className="mt-6 !p-4">
      <p className="font-display text-base font-bold">Before you send</p>
      <dl className="mt-3 space-y-3 text-sm">
        <div>
          <dt className="font-semibold text-ink">Who gets texted</dt>
          <dd className="mt-0.5 text-muted">
            {audienceLabel}: {count === null ? "counting…" : `${count} ${count === 1 ? "person" : "people"}`}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">What the text will say</dt>
          <dd className="mt-0.5 text-muted">{previewBody ? `"${previewBody}"` : "Nothing yet. Write a message above."}</dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">Where the offer appears</dt>
          <dd className="mt-0.5 text-muted">
            {mode === "message_only"
              ? "No offer attached. This is a plain text, nothing added to anyone's card."
              : offer
                ? `Added to their card as "${offer.rewardText}" (${offer.name}) as soon as this sends. ${offer.expiryNote}.`
                : "Pick an offer below to attach one."}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">What gets logged</dt>
          <dd className="mt-0.5 text-muted">
            The message body and recipient count, saved to History below
            {mode === "message_with_offer" && offer ? ", plus one reward grant per recipient." : "."}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">When</dt>
          <dd className="mt-0.5 text-muted">
            {sendNow
              ? `Sends right now to everyone counted above.`
              : scheduledSummary
                ? `Scheduled for ${scheduledSummary} (fires within ~15 minutes of that time). The recipient list is locked in at that time, not now.`
                : "Pick a date and time below."}
          </dd>
        </div>
      </dl>
    </Card>
  );
}

export function Composer({
  segmentCounts,
  offers,
  cadence,
  filterablePrograms,
  schedule,
  prefillDate,
}: {
  segmentCounts: SegmentCounts;
  offers: OfferOption[];
  cadence: CadenceSignal;
  filterablePrograms: OfferOption[];
  /** Restaurant timezone + country (Codex #15/#11/#14 — A3): drives wall-time conversion and AM/PM vs 24h presentation. */
  schedule: RestaurantScheduleContext;
  /** WS-D — set when the calendar's date click bumps this (e.g. via a changing key); switches to Schedule and fills the date. */
  prefillDate?: string;
}) {
  const [audience, setAudience] = useState<CampaignAudience>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<AudienceFilters>(EMPTY_FILTERS);
  const [filteredCount, setFilteredCount] = useState<number | null>(null);
  const [body, setBody] = useState("");
  const [mode, setMode] = useState<MessageMode>("message_only");
  const [programId, setProgramId] = useState<string>("");
  const [sendNow, setSendNow] = useState(!prefillDate);
  const [scheduledDate, setScheduledDate] = useState(prefillDate ?? "");
  const [scheduledTime, setScheduledTime] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (prefillDate) {
      setSendNow(false);
      setScheduledDate(prefillDate);
    }
  }, [prefillDate]);

  const timeOptions = useMemo(() => generateTimeOptions(schedule.country), [schedule.country]);
  const activeFilters = useMemo(() => cleanFilters(filters), [filters]);
  const audienceLabel = AUDIENCE_OPTIONS.find((o) => o.value === audience)?.label ?? audience;
  const liveCount = hasAnyFilter(activeFilters) ? filteredCount : segmentCounts[audience];
  const selectedOffer = offers.find((o) => o.id === programId) ?? null;

  // Resolved UTC instant for the picked wall-clock date+time, computed the
  // same way the server will (wallTimeToUtc against the restaurant's own
  // timezone) — used only for the pre-submit summary line, never sent to
  // the server as-is (the server re-derives it from the raw date/time parts).
  const scheduledSummary = useMemo(() => {
    if (!scheduledDate || !scheduledTime) return null;
    const utcIso = wallTimeToUtc(scheduledDate, scheduledTime, schedule.timezone);
    return formatWallTimeSummary(utcIso, schedule.timezone);
  }, [scheduledDate, scheduledTime, schedule.timezone]);

  useEffect(() => {
    if (mode === "message_only" && programId) setProgramId("");
  }, [mode, programId]);

  // Live recount: base segment + filters, recomputed server-side whenever
  // either changes. Debounced so number-input keystrokes don't spam the server action.
  useEffect(() => {
    if (!hasAnyFilter(activeFilters)) {
      setFilteredCount(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      recountAudienceAction(audience, activeFilters).then((res) => {
        if (!cancelled && res.ok) setFilteredCount(res.count);
      });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [audience, activeFilters]);

  const previewBody = useMemo(() => {
    const trimmed = body.trim();
    if (!trimmed) return "";
    return trimmed.includes("Reply STOP to opt out.") ? trimmed : `${trimmed}${STOP_SUFFIX}`;
  }, [body]);
  const segments = smsSegments(previewBody);

  function submit() {
    setResult(null);
    setConfirming(false);
    startTransition(async () => {
      try {
        const res = await createMessageAction({
          audience,
          audienceFilters: hasAnyFilter(activeFilters) ? activeFilters : null,
          body,
          programId: mode === "message_with_offer" ? programId || null : null,
          sendNow,
          // Wall-clock parts only — the server resolves these against the
          // restaurant's timezone (Codex #15). Never send a client-computed instant.
          scheduledDate: sendNow ? null : scheduledDate || null,
          scheduledTime: sendNow ? null : scheduledTime || null,
        });
        if (!res.ok) {
          setResult({ ok: false, message: res.error });
        } else if (sendNow) {
          setResult({ ok: true, message: `Sent to ${res.sentCount ?? 0} people.` });
          setBody("");
        } else {
          setResult({ ok: true, message: "Scheduled." });
          setBody("");
        }
      } catch {
        // createMessageAction throwing (rather than returning {ok:false}) is
        // unexpected, but a network hiccup or an unhandled server error
        // shouldn't crash the composer (Codex #16) — surface it same as any
        // other failure instead of an uncaught rejection.
        setResult({ ok: false, message: "Something went wrong sending that. Nothing was lost — try again." });
      }
    });
  }

  return (
    <Card shadow border>
      <h2 className="font-display text-xl font-bold">New message</h2>

      {cadence.show && (
        <Card bg="paper" border className="mt-4 !bg-butter !p-4">
          <p className="text-sm font-semibold">
            You&apos;ve sent about {cadence.avgPerMember.toFixed(1)} promos per member this month. Above 4,
            opt-outs climb. Your call.
          </p>
        </Card>
      )}

      <fieldset className="mt-6">
        <legend className="text-sm font-semibold text-ink">Audience</legend>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {AUDIENCE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setAudience(opt.value)}
              className={`rounded-button border-2 px-3 py-2 text-left text-sm font-semibold ${
                audience === opt.value ? "border-ink bg-peach" : "border-line bg-cream"
              }`}
            >
              {opt.label}
              <span className="block text-xs font-normal text-muted">{segmentCounts[opt.value]} people</span>
            </button>
          ))}
        </div>
        {hasAnyFilter(activeFilters) && (
          <p className="mt-2 text-sm font-semibold text-ink">
            {filteredCount === null ? "Counting…" : `${filteredCount} people match your filters`}
          </p>
        )}
      </fieldset>

      <div className="mt-4">
        <button
          type="button"
          onClick={() => setFiltersOpen((v) => !v)}
          className="text-sm font-semibold text-coral-dark underline"
        >
          {filtersOpen ? "Hide narrowing filters" : "Narrow it down (optional)"}
        </button>
        {filtersOpen && (
          <Card bg="paper" border className="mt-3 !p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                id="filter-redeemed-within-days"
                label="Redeemed within (days)"
                type="number"
                min={1}
                value={filters.redeemed_within_days ?? ""}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, redeemed_within_days: e.target.value ? Number(e.target.value) : undefined }))
                }
              />
              <Field
                id="filter-min-visits"
                label="Minimum visits"
                type="number"
                min={1}
                value={filters.min_visits ?? ""}
                onChange={(e) => setFilters((f) => ({ ...f, min_visits: e.target.value ? Number(e.target.value) : undefined }))}
              />
              <Field
                id="filter-joined-within-days"
                label="Joined within (days)"
                type="number"
                min={1}
                value={filters.joined_within_days ?? ""}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, joined_within_days: e.target.value ? Number(e.target.value) : undefined }))
                }
              />
              <div className="flex flex-col gap-1.5">
                <label htmlFor="filter-redeemed-program" className="text-sm font-semibold text-ink">
                  Redeemed a specific offer
                </label>
                <select
                  id="filter-redeemed-program"
                  value={filters.redeemed_program_id ?? ""}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, redeemed_program_id: e.target.value || undefined }))
                  }
                  className="min-h-11 rounded-button border-2 border-line bg-cream px-4 text-base"
                >
                  <option value="">Any offer</option>
                  {filterablePrograms.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              <Checkbox
                id="filter-birthday-this-month"
                label="Birthday this month"
                checked={!!filters.birthday_this_month}
                onChange={(e) => setFilters((f) => ({ ...f, birthday_this_month: e.target.checked }))}
              />
              <Checkbox
                id="filter-near-reward"
                label="Near their next reward (within 2 visits)"
                checked={!!filters.near_reward}
                onChange={(e) => setFilters((f) => ({ ...f, near_reward: e.target.checked }))}
              />
            </div>
          </Card>
        )}
      </div>

      <div className="mt-6">
        <label htmlFor="message-body" className="text-sm font-semibold text-ink">
          Message
        </label>
        <textarea
          id="message-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          className="mt-1.5 w-full rounded-button border-2 border-line bg-cream px-4 py-3 text-base text-ink placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral-dark"
          placeholder="20% off your next visit this week only..."
        />
        <p className="mt-1.5 text-sm text-muted">
          {previewBody.length} chars · {segments || 1} SMS segment{segments === 1 ? "" : "s"} (160 single / 153 per
          segment)
        </p>
      </div>

      <fieldset className="mt-6">
        <legend className="text-sm font-semibold text-ink">What this message does</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setMode("message_only")}
            className={`rounded-button border-2 px-4 py-3 text-left text-sm font-semibold ${
              mode === "message_only" ? "border-ink bg-peach" : "border-line bg-cream"
            }`}
          >
            Message only
            <span className="block text-xs font-normal text-muted">Just a text, nothing added to anyone&apos;s card.</span>
          </button>
          <button
            type="button"
            onClick={() => setMode("message_with_offer")}
            disabled={offers.length === 0}
            className={`rounded-button border-2 px-4 py-3 text-left text-sm font-semibold disabled:opacity-50 ${
              mode === "message_with_offer" ? "border-ink bg-peach" : "border-line bg-cream"
            }`}
          >
            Message with an offer attached
            <span className="block text-xs font-normal text-muted">
              {offers.length === 0 ? "No attachable offers active right now." : "Everyone texted also gets a reward on their card."}
            </span>
          </button>
        </div>
        {offers.length === 0 && (
          <p className="mt-2 text-sm text-muted">
            <Link href="/dashboard/rewards" className="font-semibold text-coral-dark underline">
              Create an offer
            </Link>{" "}
            to attach one to a message.
          </p>
        )}
        {mode === "message_with_offer" && offers.length > 0 && (
          <div className="mt-3">
            <label htmlFor="offer" className="text-sm font-semibold text-ink">
              Offer
            </label>
            <select
              id="offer"
              value={programId}
              onChange={(e) => setProgramId(e.target.value)}
              className="mt-1.5 min-h-11 w-full rounded-button border-2 border-line bg-cream px-4 text-base"
            >
              <option value="">Choose an offer…</option>
              {offers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}: {o.rewardText}
                </option>
              ))}
            </select>
          </div>
        )}
      </fieldset>

      <fieldset className="mt-6">
        <legend className="text-sm font-semibold text-ink">When</legend>
        <div className="mt-2 flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="radio" name="when" checked={sendNow} onChange={() => setSendNow(true)} className="accent-coral" />
            Send now
          </label>
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="radio" name="when" checked={!sendNow} onChange={() => setSendNow(false)} className="accent-coral" />
            Schedule
          </label>
        </div>
        {!sendNow && (
          <div className="mt-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                className="min-h-10 rounded-button border-2 border-line bg-cream px-3 text-sm"
              />
              <select
                value={scheduledTime}
                onChange={(e) => setScheduledTime(e.target.value)}
                className="min-h-10 rounded-button border-2 border-line bg-cream px-3 text-sm"
              >
                <option value="">Time…</option>
                {timeOptions.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <p className="mt-1.5 text-sm text-muted">
              Times are in {schedule.timezone} (your restaurant&apos;s local time). Sends fire within ~15 minutes of
              the chosen time, not to the second.
            </p>
          </div>
        )}
      </fieldset>

      <ConsequencePreview
        audienceLabel={audienceLabel}
        count={liveCount}
        previewBody={previewBody}
        mode={mode}
        offer={selectedOffer}
        sendNow={sendNow}
        scheduledSummary={scheduledSummary}
      />

      {result && (
        <p className={`mt-4 text-sm font-semibold ${result.ok ? "text-ink" : "text-coral-dark"}`} role="status">
          {result.message}
        </p>
      )}

      <Button
        className="mt-6 w-full"
        disabled={pending || !body.trim() || (!sendNow && (!scheduledDate || !scheduledTime))}
        onClick={() => setConfirming(true)}
      >
        {pending ? "Sending…" : sendNow ? "Send now" : "Schedule message"}
      </Button>

      <ConfirmDialog
        open={confirming}
        title={sendNow ? "Send this now?" : "Schedule this message?"}
        confirmLabel={sendNow ? "Send now" : "Schedule"}
        pending={pending}
        onConfirm={submit}
        onCancel={() => setConfirming(false)}
        body={
          <dl className="space-y-2">
            <div>
              <dt className="font-semibold text-ink">Recipients</dt>
              <dd className="text-muted">
                {audienceLabel}: {liveCount === null ? "counting…" : `${liveCount} ${liveCount === 1 ? "person" : "people"}`}
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-ink">Full message</dt>
              <dd className="text-muted">&quot;{previewBody}&quot;</dd>
            </div>
            <div>
              <dt className="font-semibold text-ink">When</dt>
              <dd className="text-muted">
                {sendNow ? "Right now" : scheduledSummary ? `${scheduledSummary} (${schedule.timezone})` : "—"}
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-ink">Reversible</dt>
              <dd className="text-muted">No — once sent, a text can&apos;t be recalled.</dd>
            </div>
          </dl>
        }
      />
    </Card>
  );
}
