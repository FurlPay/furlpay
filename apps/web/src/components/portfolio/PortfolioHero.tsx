"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import PriceChart from "@/components/PriceChart";
import { Card, Delta, Metric, money } from "./primitives";

// ---------------------------------------------------------------------------
// The value block and the performance chart — the first thing the eye lands on.
//
// The visibility toggle is not decoration. This is a page people open on a
// train, and hiding the balance while leaving the percentages readable is the
// pattern every serious brokerage ships.
//
// Two of the metrics the brief asked for are NOT rendered here: time-weighted
// and money-weighted return. Both need a dated cash-flow series, and
// /api/investing/portfolio serves a position snapshot — a TWR computed from a
// snapshot would just be the total return wearing a more authoritative name.
// They appear in the Analytics tab as explicitly pending instead.
// ---------------------------------------------------------------------------

export default function PortfolioHero({
  marketValue,
  dayChange,
  dayChangePct,
  totalReturn,
  totalReturnPct,
  costBasis,
  cashUsd,
}: {
  marketValue: number;
  dayChange: number;
  dayChangePct: number;
  totalReturn: number;
  totalReturnPct: number;
  costBasis: number;
  cashUsd: number;
}) {
  const [hidden, setHidden] = useState(false);

  const mask = (v: string) => (hidden ? "••••••" : v);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-4 px-5 pt-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-[12.5px] font-medium text-textSecondary">Total Portfolio Value</h2>
            <button
              type="button"
              onClick={() => setHidden((h) => !h)}
              aria-label={hidden ? "Show portfolio value" : "Hide portfolio value"}
              aria-pressed={hidden}
              className="grid h-6 w-6 place-items-center rounded text-textMuted transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gain"
            >
              {hidden ? <EyeOff className="h-3.5 w-3.5" aria-hidden /> : <Eye className="h-3.5 w-3.5" aria-hidden />}
            </button>
          </div>
          <p className="mt-1 text-[30px] font-extrabold leading-none tracking-tighter tabular-nums text-white sm:text-[38px]">
            {mask(money(marketValue))}
          </p>
          <p className="mt-2 text-[13px]">
            <Delta value={dayChange} prefix="$" suffix="" />{" "}
            <span className="text-textSecondary">
              (<Delta value={dayChangePct} showSign={false} />) today
            </span>
          </p>
        </div>

        {/* The four supporting figures, all derived from the same snapshot. */}
        <div className="grid w-full shrink-0 grid-cols-2 gap-2 sm:w-auto sm:grid-cols-4 xl:w-auto">
          <Metric
            label="Total Gain/Loss"
            value={<span className={totalReturn >= 0 ? "text-gain" : "text-loss"}>{mask(money(totalReturn))}</span>}
            sub={<Delta value={totalReturnPct} className="text-[11.5px]" />}
            info="What your positions are worth now, minus what you paid for them. Unrealised — nothing has been sold."
          />
          <Metric
            label="Cost Basis"
            value={mask(money(costBasis))}
            sub={<span className="text-textMuted">invested</span>}
            info="The total you paid for the shares you currently hold, including every lot."
          />
          <Metric
            label="Cash Balance"
            value={mask(money(cashUsd))}
            sub={<span className="text-textMuted">settled</span>}
            info="Cash available in your account, not currently invested."
          />
          <Metric
            label="Buying Power"
            value={mask(money(cashUsd))}
            sub={<span className="text-textMuted">cash only</span>}
            info="What you can invest right now. This account has no margin, so buying power equals your settled cash."
          />
        </div>
      </div>

      {/* PriceChart is the app's existing chart component — reused rather than
          a second charting stack. It owns its OWN timeframe tabs (1D…ALL) and
          its hover readout, so this does not render a competing range strip:
          two switchers where only one drives the series is a control that lies. */}
      <div className="px-2 pb-3 pt-4">
        <PriceChart seed="furlpay-portfolio" endValue={marketValue} height={248} defaultTf="1M" />
      </div>
    </Card>
  );
}
