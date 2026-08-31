"use client";

import { useState } from "react";
import Link from "next/link";
import DonutChart from "@/components/DonutChart";
import MiniSparkline from "@/components/MiniSparkline";
import type { AllocationSlice, RiskProfile } from "@/lib/portfolioMetrics";
import { Card, CardHead, Delta, InfoTip, money } from "./primitives";

// ---------------------------------------------------------------------------
// Allocation, risk and income — the analytics row beneath the chart.
//
// The honesty rule that shapes the risk card: volatility, Sharpe, beta, max
// drawdown and VaR all require a daily return series, and the portfolio API
// serves a position snapshot. Rather than print a plausible 1.32 Sharpe beside
// someone's real money, those rows render an em dash and say what they need.
// A wealth platform that invents a risk metric has done something worse than
// omit it.
// ---------------------------------------------------------------------------

export function AllocationCard({ slices }: { slices: AllocationSlice[] }) {
  const [hover, setHover] = useState<AllocationSlice | null>(null);
  const total = slices.reduce((s, x) => s + x.value, 0);
  const shown = hover ?? null;

  return (
    <Card className="flex flex-col">
      <CardHead
        title="Asset Allocation"
        info="How your portfolio is split across asset classes, including uninvested cash."
      />
      <div className="flex flex-1 items-center gap-4 px-4 py-4">
        <div className="relative shrink-0">
          <DonutChart
            slices={slices.map((s) => ({ label: s.label, value: s.value, color: s.color }))}
            size={132}
            thickness={13}
            centerValue={shown ? `${(shown.weight * 100).toFixed(1)}%` : money(total, { compact: true })}
            centerLabel={shown ? shown.label : "Total"}
          />
        </div>

        <ul className="min-w-0 flex-1 space-y-1.5">
          {slices.map((s) => (
            <li key={s.label}>
              <button
                type="button"
                onMouseEnter={() => setHover(s)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(s)}
                onBlur={() => setHover(null)}
                className="flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-white/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gain"
                aria-label={`${s.label}: ${(s.weight * 100).toFixed(1)} percent, ${money(s.value)}`}
              >
                <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-textSecondary">{s.label}</span>
                <span className="shrink-0 text-[12.5px] font-semibold tabular-nums text-white">
                  {(s.weight * 100).toFixed(0)}%
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* The hovered class, spelled out. Reserves its own height so the card
          does not resize as the pointer moves across the legend. */}
      <div className="min-h-[34px] border-t border-white/[0.06] px-4 py-2 text-[11.5px]">
        {shown ? (
          <span className="text-textSecondary">
            <span className="font-semibold text-white">{money(shown.value)}</span> ·{" "}
            {shown.positions} {shown.positions === 1 ? "position" : "positions"}
            {shown.label !== "Cash" && (
              <>
                {" · today "}
                <Delta value={shown.dayChange} prefix="$" suffix="" />
              </>
            )}
          </span>
        ) : (
          <span className="text-textMuted">Hover a class for value and daily change.</span>
        )}
      </div>
    </Card>
  );
}

export function RiskCard({ risk }: { risk: RiskProfile }) {
  // The band marker sits on a fixed low→high spectrum, so its position is
  // comparable between visits rather than relative to this portfolio alone.
  const pos = Math.max(2, Math.min(98, risk.score));

  return (
    <Card className="flex flex-col">
      <CardHead
        title="Risk Analysis"
        info="Computed from your live positions: how concentrated the book is, and how many equally weighted holdings it behaves like."
        action={
          <span className="rounded-full bg-white/[0.07] px-2.5 py-1 text-[11px] font-semibold text-textSecondary">
            {risk.band}
          </span>
        }
      />

      <div className="px-4 py-4">
        <div className="flex items-baseline justify-between">
          <span className="text-[12px] text-textSecondary">Risk Score</span>
          <span className="text-[15px] font-bold tabular-nums text-white">
            {risk.score}
            <span className="text-[11.5px] font-medium text-textMuted">/100</span>
          </span>
        </div>

        <div className="relative mt-2">
          <div
            role="meter"
            aria-valuenow={risk.score}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Risk score ${risk.score} of 100, ${risk.band}`}
            className="h-2 w-full rounded-full"
            style={{ background: "linear-gradient(90deg,#34C759 0%,#FFD60A 55%,#FF453A 100%)" }}
          />
          <span
            aria-hidden
            className="absolute -top-1 h-4 w-1 -translate-x-1/2 rounded-full bg-white shadow"
            style={{ left: `${pos}%` }}
          />
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-textMuted">
          <span>Conservative</span>
          <span>Moderate</span>
          <span>Aggressive</span>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
          <Stat
            label="Concentration"
            value={`${(risk.concentration * 100).toFixed(1)}%`}
            hint={risk.topSymbol ? `largest: ${risk.topSymbol}` : undefined}
            info="The share of your portfolio held in its single largest position."
          />
          <Stat
            label="Effective holdings"
            value={risk.effectiveHoldings.toFixed(1)}
            hint="1 / Herfindahl index"
            info="How many equally sized positions your portfolio behaves like. Lower means more concentrated."
          />
          <Stat
            label="Volatility (1Y)"
            value="—"
            hint="needs price history"
            info="Standard deviation of daily returns. Requires a daily return series, which this deployment does not serve yet."
          />
          <Stat
            label="Sharpe ratio"
            value="—"
            hint="needs price history"
            info="Return per unit of risk. Requires a daily return series, which this deployment does not serve yet."
          />
        </dl>
      </div>

      <div className="mt-auto border-t border-white/[0.06] p-3">
        <Link
          href="/analytics"
          className="block rounded-lg border border-white/[0.1] py-2 text-center text-[12.5px] font-semibold text-white transition-colors hover:border-white/25 hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gain"
        >
          View risk report
        </Link>
      </div>
    </Card>
  );
}

export function IncomeCard({
  dividendsYtd,
  paidCount,
  upcoming,
  portfolioValue,
}: {
  dividendsYtd: number;
  paidCount: number;
  upcoming: number;
  portfolioValue: number;
}) {
  // Yield on the CURRENT value from dividends actually received — not a
  // forward projection, which would need a per-holding dividend schedule.
  const yieldPct = portfolioValue > 0 ? (dividendsYtd / portfolioValue) * 100 : 0;

  return (
    <Card className="flex flex-col">
      <CardHead
        title="Income Summary"
        info="Dividends actually recorded on your account this year. Not a forward projection."
      />
      <div className="px-4 py-4">
        <p className="text-[11.5px] text-textSecondary">Dividends received (YTD)</p>
        <p className="mt-1 text-[26px] font-extrabold leading-none tracking-tight tabular-nums text-white">
          {money(dividendsYtd)}
        </p>
        <p className="mt-1.5 text-[11.5px] text-textSecondary">
          {paidCount} {paidCount === 1 ? "payment" : "payments"} received
          {upcoming > 0 && <> · {money(upcoming)} scheduled</>}
        </p>

        <div className="mt-4 flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
          <MiniSparkline seed="income-trend" changePct={dividendsYtd > 0 ? 1 : 0} width={64} height={26} />
          <div className="min-w-0">
            <p className="flex items-center gap-1 text-[11px] text-textSecondary">
              Yield on value
              <InfoTip
                label="Yield on value"
                text="Dividends received this year as a percentage of your portfolio's current value. A trailing figure, not a forecast."
              />
            </p>
            <p className="text-[14px] font-bold tabular-nums text-white">{yieldPct.toFixed(2)}%</p>
          </div>
        </div>
      </div>

      <div className="mt-auto border-t border-white/[0.06] p-3">
        <Link
          href="/portfolio"
          className="block rounded-lg border border-white/[0.1] py-2 text-center text-[12.5px] font-semibold text-white transition-colors hover:border-white/25 hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gain"
        >
          View income details
        </Link>
      </div>
    </Card>
  );
}

function Stat({
  label,
  value,
  hint,
  info,
}: {
  label: string;
  value: string;
  hint?: string;
  info?: string;
}) {
  const unavailable = value === "—";
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-[11px] text-textSecondary">
        <span className="truncate">{label}</span>
        {info && <InfoTip label={label} text={info} />}
      </dt>
      <dd
        className={`mt-0.5 text-[14.5px] font-bold tabular-nums ${unavailable ? "text-textMuted" : "text-white"}`}
      >
        {value}
      </dd>
      {hint && <dd className="text-[10px] text-textMuted">{hint}</dd>}
    </div>
  );
}
