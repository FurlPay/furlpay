"use client";

import Link from "next/link";
import { AssetLogo } from "@furlpay/ui";
import Sparkline from "./Sparkline";
import { DASH, fmtPctSigned } from "./format";

// ---------------------------------------------------------------------------
// The index strip: six equal cards across the top of the workspace.
//
// Equal-width grid rather than a scrolling rail, because these six are a fixed
// set that a reader scans as a row — the moment one card is wider than another
// the eye stops comparing them and starts reading them one at a time.
//
// Values are index PROXIES (SPY for the S&P 500, QQQ for the NASDAQ 100) and
// the card says so in its title attribute. The proxy trades near a tenth of the
// index level, so presenting SPY's price as "S&P 500" without that note would
// be a number that is real and still wrong.
// ---------------------------------------------------------------------------

export interface IndexItem {
  id: string;
  label: string;
  proxy: string;
  price: number | null;
  changePct: number | null;
  spark: number[] | null;
  live: boolean;
}

export default function MarketOverview({
  items,
  loading,
}: {
  items: IndexItem[] | null;
  loading: boolean;
}) {
  if (loading && !items) {
    return (
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="surface-card h-[124px] animate-pulse" aria-hidden />
        ))}
      </div>
    );
  }
  if (!items?.length) return null;

  return (
    <section aria-label="Market overview">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
        {items.map((ix) => {
          const up = ix.changePct != null && ix.changePct >= 0;
          return (
            <Link
              key={ix.id}
              href={`/markets/${ix.proxy}`}
              title={`${ix.label} — tracked via ${ix.proxy}`}
              // `overflow-hidden` clips to the card's own 18px radius, so no
              // child can paint over the rounded corners or the border.
              // `min-w-0` lets the card shrink inside the grid track instead of
              // being held open by its content, which is what pushed the chart
              // past the edge at narrow widths.
              className="surface-card surface-card-interactive flex min-w-0 flex-col overflow-hidden p-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <div className="flex items-center gap-1.5">
                <AssetLogo src={null} label={ix.proxy} size={16} className="shrink-0 opacity-80" />
                <span className="truncate text-[11px] font-semibold text-textSecondary">{ix.label}</span>
              </div>

              <p className="mt-2 text-[17px] font-bold tracking-tight text-white font-mono">
                {ix.price == null
                  ? DASH
                  : ix.price.toLocaleString("en-US", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
              </p>

              <p
                className={`mt-0.5 text-[11.5px] font-semibold font-mono ${
                  ix.changePct == null ? "text-textMuted" : up ? "text-gain" : "text-loss"
                }`}
              >
                {ix.changePct != null && (
                  <span aria-hidden className="mr-0.5">
                    {up ? "▲" : "▼"}
                  </span>
                )}
                {fmtPctSigned(ix.changePct)}
              </p>

              {/* Pushed to the bottom so every card's chart baseline aligns
                  even when one price string wraps to two lines. */}
              <div className="mt-auto min-w-0 pt-2">
                {/* `fluid`: the chart takes the card's width rather than a
                    fixed 132px that a narrow card cannot hold. */}
                <Sparkline points={ix.spark} width={132} height={34} fluid />
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
