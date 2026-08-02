"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/kit";
import type { WeeklyPoint } from "@/lib/booth/chart-data";

const RANGE_OPTIONS: { value: string; label: string; weeks: number | null }[] = [
  { value: "4w", label: "4w", weeks: 4 },
  { value: "12w", label: "12w", weeks: 12 },
  { value: "6m", label: "6m", weeks: 26 },
  { value: "all", label: "All", weeks: null },
];

const METRICS: { key: keyof Omit<WeeklyPoint, "weekStart">; label: string }[] = [
  { key: "visits", label: "Visits / week" },
  { key: "joins", label: "Joins / week" },
  { key: "redemptions", label: "Redemptions / week" },
  { key: "optOuts", label: "Opt-outs / week" },
];

const formatWeekLabel = (iso: string) =>
  // timeZone pinned: weekStart is a calendar date encoded as UTC midnight — without
  // this, a viewer in a non-GMT browser timezone sees every label shifted a day.
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(`${iso}T00:00:00.000Z`),
  );

function LineChart({ points, metricKey, title }: { points: WeeklyPoint[]; metricKey: keyof Omit<WeeklyPoint, "weekStart">; title: string }) {
  const width = 560;
  const height = 180;
  const padding = { top: 16, right: 12, bottom: 24, left: 28 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const values = points.map((p) => p[metricKey]);
  const max = Math.max(1, ...values); // never divides by zero; an all-zero series still renders flat at the baseline, honestly
  const stepX = points.length > 1 ? plotWidth / (points.length - 1) : 0;

  const coords = values.map((v, i) => ({
    x: padding.left + i * stepX,
    y: padding.top + plotHeight - (v / max) * plotHeight,
  }));
  const path = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(" ");
  const xLabelIndexes =
    points.length <= 1 ? [0] : Array.from(new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]));
  const latest = values[values.length - 1] ?? 0;

  return (
    <Card shadow border>
      <p className="text-sm font-semibold text-muted">{title}</p>
      <p className="mt-1 font-display text-3xl font-extrabold">{latest}</p>
      <p className="text-xs text-muted">this week</p>
      <svg viewBox={`0 0 ${width} ${height}`} className="mt-3 w-full" role="img" aria-label={`${title}, ${points.length} weeks`}>
        {[0, 0.5, 1].map((g) => {
          const y = padding.top + plotHeight * g;
          return <line key={g} x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="var(--line)" strokeWidth={1} opacity={0.35} />;
        })}
        <line x1={padding.left} x2={padding.left} y1={padding.top} y2={height - padding.bottom} stroke="var(--ink)" strokeWidth={1.5} />
        <line
          x1={padding.left}
          x2={width - padding.right}
          y1={height - padding.bottom}
          y2={height - padding.bottom}
          stroke="var(--ink)"
          strokeWidth={1.5}
        />
        <text x={2} y={padding.top + 4} fontSize={11} fontFamily="var(--font-figtree)" fill="var(--muted)">
          {max}
        </text>
        <text x={2} y={height - padding.bottom} fontSize={11} fontFamily="var(--font-figtree)" fill="var(--muted)">
          0
        </text>
        {points.length > 0 && <path d={path} fill="none" stroke="var(--ink)" strokeWidth={2} />}
        {coords.map((c, i) => (
          <circle key={i} cx={c.x} cy={c.y} r={i === coords.length - 1 ? 4 : 2.5} fill={i === coords.length - 1 ? "var(--coral)" : "var(--ink)"} />
        ))}
        {xLabelIndexes.map((i) => (
          <text
            key={i}
            x={coords[i]?.x ?? padding.left}
            y={height - 6}
            fontSize={11}
            textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
            fontFamily="var(--font-figtree)"
            fill="var(--muted)"
          >
            {points[i] ? formatWeekLabel(points[i].weekStart) : ""}
          </text>
        ))}
      </svg>
    </Card>
  );
}

export function Charts({ series }: { series: WeeklyPoint[] }) {
  const [range, setRange] = useState<string>("12w");
  const rangeOption = RANGE_OPTIONS.find((r) => r.value === range) ?? RANGE_OPTIONS[1];
  const sliced = useMemo(() => (rangeOption.weeks == null ? series : series.slice(-rangeOption.weeks)), [series, rangeOption]);

  return (
    <div className="mt-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="font-display text-xl font-bold">Trends</h2>
        <div className="flex gap-1" role="group" aria-label="Time range">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setRange(opt.value)}
              aria-pressed={range === opt.value}
              className={`rounded-button border-2 px-3 py-1.5 text-sm font-semibold ${
                range === opt.value ? "border-ink bg-peach" : "border-line bg-cream text-muted"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-4 grid gap-6 sm:grid-cols-2">
        {METRICS.map((m) => (
          <LineChart key={m.key} points={sliced} metricKey={m.key} title={m.label} />
        ))}
      </div>
    </div>
  );
}
