"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Flame } from "lucide-react";
import { AssetLogo } from "@furlpay/ui";
import { fmtPrice } from "@/components/AssetRow";
import { fmtPctSigned } from "./format";
import type { TableRow } from "@/lib/markets/table";

// ---------------------------------------------------------------------------
// "Trending Today" — the six biggest movers, ranked.
//
// A NOTE ON THE BADGES, because this is where a design like this usually starts
// lying. The reference composition shows badges reading "Most Viewed" and
// "Trending", which are claims about READER BEHAVIOUR — page views, watchlist
// adds, search volume. This app measures none of those, so those two badges
// cannot be earned and are not used.
//
// Every badge here is derived from a number on the row itself:
//
//   Top Gainer   rank 1 by 24h change
//   High Volume  the largest 24h volume in this set
//   Gaining      up on the day
//   Falling      down on the day
//   <category>   the asset's own catalog category (DeFi, L1, AI, …)
//
// so a reader who asks "trending by what measure?" has an answer.
// ---------------------------------------------------------------------------

interface Badge {
  label: string;
  className: string;
}

function badgeFor(row: TableRow, index: number, topVolumeSymbol: string | null): Badge {
  if (index === 0) {
    return { label: "Top Gainer", className: "bg-mkt-up/15 text-mkt-up border-mkt-up/25" };
  }
  if (row.symbol === topVolumeSymbol) {
    return { label: "High Volume", className: "bg-amber-400/15 text-amber-300 border-amber-400/25" };
  }
  // A category badge says something specific and permanent about the asset,
  // which is more useful than a third synonym for "it went up".
  if (row.category) {
    return {
      label: row.category,
      className: "bg-mkt-violet/15 text-violet-300 border-mkt-violet/25",
    };
  }
  const up = (row.changePct ?? 0) >= 0;
  return up
    ? { label: "Gaining", className: "bg-mkt-up/15 text-mkt-up border-mkt-up/25" }
    : { label: "Falling", className: "bg-mkt-down/15 text-mkt-down border-mkt-down/25" };
}

export default function TrendingToday({
  rows,
  loading,
  onSeeAll,
}: {
  /** Already sorted by 24h change, descending, by the caller. */
  rows: TableRow[] | null;
  loading: boolean;
  onSeeAll: () => void;
}) {
  const topVolumeSymbol = useMemo(() => {
    if (!rows?.length) return null;
    let best: TableRow | null = null;
    for (const r of rows) {
      if (r.volume24h == null) continue;
      if (!best || r.volume24h > (best.volume24h as number)) best = r;
    }
    return best?.symbol ?? null;
  }, [rows]);

  if (loading && !rows) {
    return (
      <section className="mt-6">
        <h2 className="mb-2.5 text-[15px] font-bold tracking-tight text-white">Trending Today</h2>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="mkt-panel h-[150px] animate-pulse" aria-hidden />
          ))}
        </div>
      </section>
    );
  }
  if (!rows?.length) return null;

  return (
    <section className="mt-6" aria-labelledby="trending-heading">
      <div className="mb-2.5 flex items-center justify-between">
        <h2 id="trending-heading" className="flex items-center gap-1.5 text-[15px] font-bold tracking-tight text-white">
          <Flame className="h-4 w-4 text-amber-400" aria-hidden />
          Trending Today
        </h2>
        <button
          type="button"
          onClick={onSeeAll}
          className="text-[12px] font-semibold text-mkt-cyan transition-opacity hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mkt-cyan"
        >
          See all →
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
        {rows.slice(0, 6).map((row, i) => {
          const badge = badgeFor(row, i, topVolumeSymbol);
          const up = row.changePct != null && row.changePct >= 0;
          return (
            <Link
              key={row.symbol}
              href={`/markets/${encodeURIComponent(row.symbol)}`}
              className="mkt-panel mkt-panel-interactive flex flex-col p-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mkt-cyan"
            >
              <div className="flex items-start justify-between gap-1.5">
                <span
                  className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-white/[0.07] text-[10.5px] font-bold text-white/70 mkt-num"
                  aria-label={`Rank ${i + 1}`}
                >
                  {i + 1}
                </span>
                <span
                  className={`truncate rounded-full border px-1.5 py-0.5 text-[9.5px] font-bold leading-tight ${badge.className}`}
                >
                  {badge.label}
                </span>
              </div>

              <div className="mt-2.5 flex items-center gap-2">
                <AssetLogo src={row.logo} label={row.symbol} size={26} className="shrink-0" />
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-bold text-white">{row.symbol}</span>
                  <span className="block truncate text-[10.5px] text-white/40">{row.name}</span>
                </span>
              </div>

              <p
                className={`mt-2.5 text-[17px] font-bold tracking-tight mkt-num ${
                  row.changePct == null ? "text-white/30" : up ? "text-mkt-up" : "text-mkt-down"
                }`}
              >
                {fmtPctSigned(row.changePct)}
              </p>
              <p className="mt-auto pt-1.5 text-[12px] font-semibold text-white/60 mkt-num">
                {fmtPrice(row.price)}
              </p>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
