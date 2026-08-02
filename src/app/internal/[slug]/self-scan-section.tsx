"use client";

import { useState } from "react";
import { Button, Card } from "@/components/kit";
import type { DayKey, OpenHours } from "@/lib/booth/open-hours";
import {
  generateSelfScanTokenAction,
  saveSelfScanSettingsAction,
  type GenerateSelfScanTokenState,
  type SelfScanSettingsState,
} from "./actions";

const DAY_ORDER: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_LABELS: Record<DayKey, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
const DEFAULT_HOURS = { open: "11:00", close: "22:00" };

const tokenIdle: GenerateSelfScanTokenState = { status: "idle" };
const settingsIdle: SelfScanSettingsState = { status: "idle" };

export function SelfScanSection({
  restaurantId,
  slug,
  visitMode,
  selfScanToken,
  openHours,
}: {
  restaurantId: string;
  slug: string;
  visitMode: string;
  selfScanToken: string | null;
  openHours: OpenHours | null;
}) {
  const [mode, setMode] = useState(visitMode);
  const [token, setToken] = useState(selfScanToken);
  const [hours, setHours] = useState<OpenHours>(openHours ?? {});
  const [tokenState, setTokenState] = useState(tokenIdle);
  const [settingsState, setSettingsState] = useState(settingsIdle);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);

  function toggleDay(day: DayKey, on: boolean) {
    setHours((h) => {
      const next = { ...h };
      if (on) next[day] = next[day] ?? DEFAULT_HOURS;
      else delete next[day];
      return next;
    });
  }

  function setDayTime(day: DayKey, field: "open" | "close", value: string) {
    setHours((h) => ({ ...h, [day]: { ...(h[day] ?? DEFAULT_HOURS), [field]: value } }));
  }

  async function handleGenerateToken() {
    setGenerating(true);
    try {
      const result = await generateSelfScanTokenAction(restaurantId, slug);
      setTokenState(result);
      if (result.status === "success" && result.token) setToken(result.token);
    } finally {
      setGenerating(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const result = await saveSelfScanSettingsAction(restaurantId, slug, { visitMode: mode, openHours: hours });
      setSettingsState(result);
    } catch (caught) {
      setSettingsState({ status: "error", error: caught instanceof Error ? caught.message : "Save failed — try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card border shadow className="mt-6">
      <h2 className="font-display text-xl font-bold">Self check-in</h2>
      <p className="mt-2 text-sm text-muted">Lets a diner tap a counter QR to check themselves in, no staff scan needed.</p>

      <div className="mt-4 flex flex-col gap-2">
        <p className="text-sm font-semibold text-ink">Check-in mode</p>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          className="min-h-9 w-fit rounded-button border-2 border-line bg-cream px-3 text-sm text-ink"
        >
          <option value="staff_scan">Staff scan only</option>
          <option value="self_scan">Self check-in only</option>
          <option value="both">Both</option>
        </select>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <p className="text-sm font-semibold text-ink">Counter code</p>
        {token ? (
          <code className="w-fit rounded bg-cream px-2 py-1 text-xs">{token}</code>
        ) : (
          <p className="text-sm text-muted">Not generated yet — the self-scan sign needs this.</p>
        )}
        <Button type="button" variant="secondary" className="w-fit" disabled={generating} onClick={handleGenerateToken}>
          {generating ? "Generating…" : token ? "Regenerate code" : "Generate code"}
        </Button>
        {tokenState.status === "error" && (
          <p className="text-sm font-semibold text-coral-dark" role="alert">
            {tokenState.error}
          </p>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <p className="text-sm font-semibold text-ink">Open hours</p>
        <p className="text-xs text-muted">Leave a day unchecked to skip configuring it (self check-in stays available all day until every day is set).</p>
        <div className="flex flex-col gap-2">
          {DAY_ORDER.map((day) => {
            const dayHours = hours[day];
            const on = dayHours !== undefined && dayHours !== null;
            return (
              <div key={day} className="flex items-center gap-2">
                <label className="flex w-16 items-center gap-2 text-sm">
                  <input type="checkbox" checked={on} onChange={(e) => toggleDay(day, e.target.checked)} />
                  {DAY_LABELS[day]}
                </label>
                {on && dayHours && (
                  <>
                    <input
                      type="time"
                      value={dayHours.open}
                      onChange={(e) => setDayTime(day, "open", e.target.value)}
                      className="min-h-8 rounded-button border-2 border-line bg-cream px-2 text-sm text-ink"
                    />
                    <span className="text-sm text-muted">to</span>
                    <input
                      type="time"
                      value={dayHours.close}
                      onChange={(e) => setDayTime(day, "close", e.target.value)}
                      className="min-h-8 rounded-button border-2 border-line bg-cream px-2 text-sm text-ink"
                    />
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <Button type="button" className="mt-4 w-fit" disabled={saving} onClick={handleSave}>
        {saving ? "Saving…" : "Save check-in settings"}
      </Button>
      {settingsState.status === "error" && (
        <p className="mt-2 text-sm font-semibold text-coral-dark" role="alert">
          {settingsState.error}
        </p>
      )}
      {settingsState.status === "success" && <p className="mt-2 text-sm font-semibold text-ink">Saved.</p>}
    </Card>
  );
}
