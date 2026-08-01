"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { MapPin, TrendingDown, TrendingUp } from "lucide-react";
import { NoData, Panel } from "./Panel";
import type { PeriodSummary, TravelSummary, Period } from "@/lib/expenses/periods";

// Expense surfaces — the actual purpose of this dashboard.
//
// Every number here comes from lib/expenses/periods.ts, which sums in integer
// cents and is unit-tested against float drift, bucket-boundary and
// declined-transaction cases. Nothing on this screen is estimated.

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usdExact = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

/** Recharts types tooltip values as `ValueType | undefined`. Coerce once, here,
 *  rather than casting at each call site — a bad cast in a money tooltip shows
 *  "NaN" or "$undefined" to a user checking their own spending. */
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

// Category colours. FurlPay neon leads; the rest are distinguishable at small
// size and in the two most common colour-vision deficiencies.
const SLICE_COLORS = ["#00E599", "#38BDF8", "#A78BFA", "#F59E0B", "#FB7185", "#2DD4BF", "#94A3B8"];

export const PERIOD_LABEL: Record<Period, string> = {
  week: "This week",
  month: "This month",
  year: "This year",
};

export function PeriodToggle({
  value,
  onChange,
}: {
  value: Period;
  onChange: (p: Period) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Reporting period"
      className="flex items-center gap-0.5 rounded-pill border border-term-border bg-term-bg p-0.5"
    >
      {(["week", "month", "year"] as Period[]).map((p) => {
        const active = p === value;
        return (
          <button
            key={p}
            role="radio"
            aria-checked={active}
            onClick={() => onChange(p)}
            className={`rounded-pill px-3 py-1 text-[11px] font-medium capitalize transition-colors ${
              active
                ? "bg-neon text-black"
                : "text-textSecondary hover:bg-term-raised hover:text-textPrimary"
            }`}
          >
            {p}
          </button>
        );
      })}
    </div>
  );
}

/** Spend over the period. Daily bars for week/month, monthly for year. */
export function SpendTrend({
  summary,
  index = 0,
}: {
  summary: PeriodSummary;
  index?: number;
}) {
  const data = summary.buckets.map((b) => ({ label: b.label, spent: b.spentUsd, count: b.count }));
  const empty = summary.totalSpentUsd === 0;

  return (
    <Panel
      title="Spend"
      subtitle={`${usdExact(summary.totalSpentUsd)} · ${usdExact(summary.dailyAverageUsd)}/day average`}
      index={index}
      actions={<ChangeBadge pct={summary.changePct} invert />}
      className="min-h-[260px]"
    >
      {empty ? (
        <NoData label="No spending recorded in this period" />
      ) : (
        <ResponsiveContainer width="100%" height={190}>
          <BarChart data={data} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
            <XAxis
              dataKey="label"
              tick={{ fill: "#8E8E93", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fill: "#8E8E93", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => (v === 0 ? "" : usd(Number(v)))}
              width={54}
            />
            <Tooltip
              cursor={{ fill: "#ffffff08" }}
              contentStyle={TOOLTIP_STYLE}
              labelStyle={{ color: "#fff", fontSize: 11, fontWeight: 600 }}
              formatter={(v, _n, item) => [
                `${usdExact(num(v))} · ${num(item?.payload?.count)} tx`,
                "Spent",
              ]}
            />
            <Bar dataKey="spent" radius={[3, 3, 0, 0]} fill="#00E599" maxBarSize={26} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Panel>
  );
}

/** Where the money went. Donut + ranked list. */
export function CategoryBreakdown({
  summary,
  title = "By category",
  index = 0,
}: {
  summary: PeriodSummary;
  title?: string;
  index?: number;
}) {
  const data = useMemo(
    () => summary.categories.slice(0, 7).map((c) => ({ name: c.category, value: c.amountUsd, pct: c.percentage })),
    [summary.categories]
  );

  return (
    <Panel title={title} subtitle={`${summary.transactionCount} transactions`} index={index} className="min-h-[260px]">
      {data.length === 0 ? (
        <NoData label="Nothing to break down yet" />
      ) : (
        <div className="flex items-center gap-4">
          <ResponsiveContainer width="45%" height={150}>
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                innerRadius="58%"
                outerRadius="92%"
                paddingAngle={2}
                stroke="none"
                animationDuration={550}
              >
                {data.map((_, i) => (
                  <Cell key={i} fill={SLICE_COLORS[i % SLICE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(v, n) => [usdExact(num(v)), String(n ?? "")]}
              />
            </PieChart>
          </ResponsiveContainer>

          <ul className="flex min-w-0 flex-1 flex-col gap-1.5">
            {data.map((c, i) => (
              <li key={c.name} className="flex items-center gap-2 text-[12px]">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: SLICE_COLORS[i % SLICE_COLORS.length] }}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate capitalize text-textPrimary">{c.name}</span>
                <span className="font-mono tabular-nums text-textSecondary">{c.pct}%</span>
                <span className="w-16 text-right font-mono tabular-nums text-textPrimary">
                  {usd(c.value)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

/** Travel expenses — cities, cashback, trend. */
export function TravelExpenses({
  travel,
  index = 0,
}: {
  travel: TravelSummary;
  index?: number;
}) {
  const data = travel.buckets.map((b) => ({ label: b.label, spent: b.spentUsd }));

  return (
    <Panel
      title="Travel expenses"
      subtitle={`${travel.tripCount} ${travel.tripCount === 1 ? "trip" : "trips"} · ${usdExact(travel.totalSpentUsd)}`}
      index={index}
      actions={<ChangeBadge pct={travel.changePct} invert />}
      className="min-h-[260px]"
    >
      {travel.tripCount === 0 ? (
        <NoData
          label="No trips booked in this period"
          hint="Bookings made through FurlPay Travel appear here automatically, tagged for expense reconciliation."
        />
      ) : (
        <div className="flex flex-col gap-3">
          <ResponsiveContainer width="100%" height={110}>
            <AreaChart data={data} margin={{ top: 4, right: 4, left: -30, bottom: 0 }}>
              <defs>
                <linearGradient id="travelFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#38BDF8" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#38BDF8" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="label" tick={{ fill: "#8E8E93", fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fill: "#8E8E93", fontSize: 10 }} axisLine={false} tickLine={false} width={50} tickFormatter={(v) => (v === 0 ? "" : usd(Number(v)))} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [usdExact(num(v)), "Travel"]} />
              <Area type="monotone" dataKey="spent" stroke="#38BDF8" strokeWidth={2} fill="url(#travelFill)" animationDuration={550} />
            </AreaChart>
          </ResponsiveContainer>

          <div className="grid grid-cols-2 gap-3 border-t border-term-border/70 pt-3">
            <div>
              <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-textSecondary">
                Top cities
              </p>
              <ul className="flex flex-col gap-1">
                {travel.topCities.map((c) => (
                  <li key={c.city} className="flex items-center gap-1.5 text-[12px]">
                    <MapPin size={11} className="shrink-0 text-textMuted" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-textPrimary">{c.city}</span>
                    <span className="font-mono tabular-nums text-textSecondary">{usd(c.amountUsd)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-textSecondary">
                Cashback earned
              </p>
              <p className="font-mono text-[19px] font-semibold tabular-nums text-neon">
                {usdExact(travel.cashbackUsd)}
              </p>
              {/* Stated explicitly: the expense total is gross, so it reconciles
                  against the card statement a finance team checks it against. */}
              <p className="mt-1 text-[10px] leading-snug text-textMuted">
                Reported separately — not deducted from the expense total above.
              </p>
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}

function ChangeBadge({ pct, invert = false }: { pct: number | null; invert?: boolean }) {
  if (pct === null) {
    return (
      <span className="text-[10px] text-textMuted" title="No spending in the previous period to compare against">
        no prior data
      </span>
    );
  }
  const up = pct > 0;
  const bad = invert ? up : !up;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span
      className={`flex items-center gap-1 rounded-pill px-1.5 py-0.5 text-[10px] font-medium ${
        bad ? "bg-loss/10 text-loss" : "bg-gain/10 text-gain"
      }`}
      title="Versus the previous period of equal length"
    >
      <Icon size={11} aria-hidden="true" />
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

const TOOLTIP_STYLE = {
  background: "#141C26",
  border: "1px solid #243141",
  borderRadius: 10,
  fontSize: 11,
  color: "#fff",
} as const;
