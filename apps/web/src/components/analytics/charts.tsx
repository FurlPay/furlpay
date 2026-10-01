"use client";

import { useId } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { bucketLabel, fmtCount, fmtUsd } from "./format";

// Chart primitives. Monochrome by brand rule: FurlPay green for the primary
// series, neutral greys for secondary ones — no second hue.

export const NEON = "#00E599";
const GREYS = ["#8E9A95", "#5E6B66", "#3C4743", "#2A3330"];
const AXIS = { fill: "#8E9A95", fontSize: 11 };

/** Tiny line, no axes. Draws nothing for fewer than two points: a one-point
 *  "trend" would be invented shape. */
export function Sparkline({ values, width = 92, height = 30, color = NEON }: { values: number[]; width?: number; height?: number; color?: string }) {
  const uid = useId();
  if (!values || values.length < 2) return <span className="block" style={{ width, height }} aria-hidden />;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * width, height - 3 - ((v - min) / span) * (height - 6)]);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const id = `spk${uid.replace(/:/g, "")}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="shrink-0">
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L${width},${height} L0,${height} Z`} fill={`url(#${id})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

const tooltipStyle = {
  contentStyle: { background: "#0E1311", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, fontSize: 12 },
  labelStyle: { color: "#C9CDCB" },
  itemStyle: { color: "#fff" },
};

export function GrowthChart({
  buckets,
  bucket,
  primary,
  secondary,
  primaryLabel,
  secondaryLabel,
}: {
  buckets: string[];
  bucket: "hour" | "day";
  primary: number[];
  secondary: number[] | null;
  primaryLabel: string;
  secondaryLabel: string;
}) {
  const rows = buckets.map((b, i) => ({ t: bucketLabel(b, bucket), a: primary[i] ?? 0, b: secondary ? secondary[i] ?? 0 : null }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <defs>
          <linearGradient id="growthA" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={NEON} stopOpacity={0.35} />
            <stop offset="100%" stopColor={NEON} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
        <XAxis dataKey="t" tick={AXIS} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} tickFormatter={(v: number) => fmtCount(v, { compact: true })} />
        <Tooltip {...tooltipStyle} />
        <Area type="monotone" dataKey="a" name={primaryLabel} stroke={NEON} strokeWidth={2} fill="url(#growthA)" />
        {secondary && <Area type="monotone" dataKey="b" name={secondaryLabel} stroke={GREYS[0]} strokeWidth={1.6} fill="transparent" />}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function StackedBars({
  buckets,
  bucket,
  series,
  usd = true,
}: {
  buckets: string[];
  bucket: "hour" | "day";
  series: { name: string; values: number[] }[];
  usd?: boolean;
}) {
  const rows = buckets.map((b, i) => {
    const row: Record<string, number | string> = { t: bucketLabel(b, bucket) };
    for (const s of series) row[s.name] = s.values[i] ?? 0;
    return row;
  });
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -6 }}>
        <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
        <XAxis dataKey="t" tick={AXIS} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis
          tick={AXIS}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => (usd ? fmtUsd(v, { compact: true }) : fmtCount(v, { compact: true }))}
        />
        <Tooltip {...tooltipStyle} cursor={{ fill: "rgba(255,255,255,0.03)" }} formatter={(v) => (usd ? fmtUsd(Number(v)) : fmtCount(Number(v)))} />
        {series.map((s, i) => (
          <Bar key={s.name} dataKey={s.name} stackId="v" fill={i === 0 ? NEON : GREYS[(i - 1) % GREYS.length]} radius={i === series.length - 1 ? [2, 2, 0, 0] : 0} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export const seriesColor = (i: number) => (i === 0 ? NEON : GREYS[(i - 1) % GREYS.length]);

/** Ring chart in plain SVG: segments are the given shares, nothing else. */
export function Donut({ items, size = 168, children }: { items: { label: string; share: number }[]; size?: number; children?: React.ReactNode }) {
  const r = size / 2 - 14;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={22} />
        {items.map((it, i) => {
          const len = Math.max(0, it.share) * c;
          const el = (
            <circle
              key={it.label}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={seriesColor(i)}
              strokeWidth={22}
              strokeDasharray={`${Math.max(0, len - 2)} ${c}`}
              strokeDashoffset={-offset}
            />
          );
          offset += len;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}
