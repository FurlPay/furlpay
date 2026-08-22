"use client";

import Link from "next/link";
import { Star } from "lucide-react";
import { usd } from "@/components/ui";
import RangeBar from "./RangeBar";
import {
  DASH,
  fmtCountCompact,
  fmtMoneyCompact,
  fmtMultiple,
  fmtPct,
  fmtPerShare,
} from "./format";
import type { SymbolDetail } from "./types";

// The desktop trading rail — the panel a terminal keeps pinned while the chart
// changes underneath it.
//
// Every figure here is nullable and renders as an em-dash when unknown. That is
// the whole point of the markets rewrite: a P/E derived from the letters in the
// ticker looked exactly like a real one, and the only defence is that "we do
// not know" has its own glyph.

export default function TradePanel({
  data,
  signInHref,
  onBuy,
  onSell,
}: {
  data: SymbolDetail;
  signInHref: string;
  onBuy: () => void;
  onSell: () => void;
}) {
  const { asset, quote, stats, position } = data;
  const isEquity = asset.kind !== "crypto";
  const canTrade = data.authenticated && quote.price !== null;

  return (
    <div className="flex flex-col gap-4">
      {/* ── Order ticket ─────────────────────────────────────────────── */}
      <section className="surface-card p-5" aria-labelledby="trade-heading">
        <h2 id="trade-heading" className="sr-only">
          Trade {asset.symbol}
        </h2>

        <div className="flex items-baseline justify-between">
          <span className="text-[12px] text-textSecondary">Current price</span>
          <span className="text-[22px] font-bold tracking-tight tabular-nums">
            {quote.price === null ? DASH : usd(quote.price)}
          </span>
        </div>

        {!data.authenticated ? (
          <Link
            href={signInHref}
            className="tap mt-4 flex w-full items-center justify-center rounded-pill bg-accent py-3 font-semibold transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Sign in to trade
          </Link>
        ) : isEquity ? (
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            <button
              onClick={onBuy}
              disabled={!canTrade}
              className="tap rounded-pill bg-accent py-3 font-semibold transition-opacity hover:opacity-90 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Buy
            </button>
            <button
              onClick={onSell}
              disabled={!canTrade || !position?.shares}
              className="tap rounded-pill bg-white/[0.08] py-3 font-semibold transition-colors hover:bg-white/[0.12] disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40"
            >
              Sell
            </button>
          </div>
        ) : (
          <Link
            href="/dashboard"
            className="tap mt-4 flex w-full items-center justify-center rounded-pill bg-accent py-3 font-semibold transition-opacity hover:opacity-90"
          >
            Trade via stablecoin swap
          </Link>
        )}

        <button
          type="button"
          className="tap mt-2.5 flex w-full items-center justify-center gap-2 rounded-pill border border-white/[0.08] py-2.5 text-[13px] font-semibold text-textSecondary transition-colors hover:border-white/20 hover:text-textPrimary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40"
        >
          <Star className="h-4 w-4" /> Add to watchlist
        </button>

        {/* Position. Absent rather than zeroed when there is no holding — a
            "0.0000 shares" row reads as a position that was closed. */}
        {position && position.shares > 0 && (
          <div className="mt-4 border-t border-white/[0.07] pt-4">
            <p className="text-[12px] text-textSecondary">Your position</p>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="font-semibold tabular-nums">
                {position.shares.toFixed(4)} shares
              </span>
              <span className="font-semibold tabular-nums">
                {position.marketValue === null ? DASH : usd(position.marketValue)}
              </span>
            </div>
          </div>
        )}
      </section>

      {/* ── Key statistics ───────────────────────────────────────────── */}
      <section className="surface-card p-5" aria-labelledby="stats-heading">
        <h2 id="stats-heading" className="text-[14px] font-bold tracking-tight">
          Key statistics
        </h2>

        <dl className="mt-3.5 divide-y divide-white/[0.05]">
          <Stat label="Market cap" value={fmtMoneyCompact(stats.marketCap)} />
          <Stat label="P/E ratio" value={fmtMultiple(stats.peRatio)} />
          <Stat label="EPS (TTM)" value={fmtPerShare(stats.eps)} />
          <Stat
            label="Dividend yield"
            value={stats.dividendYieldPct === null ? DASH : fmtPct(stats.dividendYieldPct)}
          />
          <Stat label="Dividend / share" value={fmtPerShare(stats.dividendPerShareTtm)} />
          <Stat label="52-week high" value={stats.high52w === null ? DASH : usd(stats.high52w)} />
          <Stat label="52-week low" value={stats.low52w === null ? DASH : usd(stats.low52w)} />
          <Stat label="Volume" value={fmtCountCompact(stats.volume)} />
          <Stat label="Avg volume" value={fmtCountCompact(stats.avgVolume)} />
          <Stat label="Beta" value={fmtMultiple(stats.beta)} />
        </dl>

        <div className="mt-4 border-t border-white/[0.07] pt-4">
          <RangeBar
            label="52-week range"
            low={stats.low52w}
            high={stats.high52w}
            value={quote.price}
          />
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between py-2.5">
      <dt className="text-[13px] text-textSecondary">{label}</dt>
      <dd className="text-[13.5px] font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
