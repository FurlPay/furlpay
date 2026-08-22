"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AssetLogo } from "@furlpay/ui";
import { fmtPctSigned, fmtCountCompact, DASH } from "./format";
import type { TableRow } from "@/lib/markets/table";

// ---------------------------------------------------------------------------
// Market Movers — the top of the right-hand intelligence rail.
//
// Derived from the SAME rows the table is built from, not a second endpoint.
// Two sources for "the biggest gainers" is two chances to disagree, and a rail
// that contradicts the table three inches to its left destroys trust in both.
//
// The three tabs are three orderings of one list:
//   Gainers  24h change, descending — nulls excluded, never sorted as 0
//   Losers   24h change, ascending
//   Volume   24h volume, descending
//
// Stablecoins are excluded from Gainers and Losers. A coin engineered to hold
// $1.00 moving 0.02% is not a market mover, and letting it occupy a slot pushes
// out something that is.
// ---------------------------------------------------------------------------

type Tab = "gainers" | "losers" | "volume";

const TABS: { id: Tab; label: string }[] = [
  { id: "gainers", label: "Gainers" },
  { id: "losers", label: "Losers" },
  { id: "volume", label: "Volume" },
];

export default function MarketMovers({
  rows,
  loading,
  onViewAll,
}: {
  rows: TableRow[] | null;
  loading: boolean;
  /** Applies the equivalent filter + sort to the main table. */
  onViewAll: (tab: Tab) => void;
}) {
  const [tab, setTab] = useState<Tab>("gainers");

  const list = useMemo(() => {
    if (!rows?.length) return [];
    if (tab === "volume") {
      return rows
        .filter((r) => r.volume24h != null)
        .sort((a, b) => (b.volume24h as number) - (a.volume24h as number))
        .slice(0, 5);
    }
    const movable = rows.filter((r) => r.changePct != null && r.category !== "Stablecoin");
    const sorted = movable.sort((a, b) => (b.changePct as number) - (a.changePct as number));
    return (tab === "gainers" ? sorted : [...sorted].reverse()).slice(0, 5);
  }, [rows, tab]);

  return (
    <section className="surface-card p-3.5" aria-labelledby="movers-heading">
      <h2 id="movers-heading" className="text-[13.5px] font-bold text-white">
        Market Movers
      </h2>

      <div
        role="tablist"
        aria-label="Market movers view"
        className="mt-2.5 flex gap-1 rounded-lg bg-white/[0.04] p-0.5"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 rounded-md py-1 text-[11px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
              tab === t.id ? "bg-white/[0.1] text-white" : "text-textSecondary hover:text-white/75"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-2" role="tabpanel">
        {loading && !rows ? (
          <div className="space-y-1.5 py-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-8 animate-pulse rounded-lg bg-white/[0.04]" aria-hidden />
            ))}
          </div>
        ) : list.length === 0 ? (
          <p className="px-1 py-5 text-center text-[11.5px] text-textMuted">
            No movers to show right now.
          </p>
        ) : (
          <ol className="space-y-0.5">
            {list.map((row, i) => {
              const up = row.changePct != null && row.changePct >= 0;
              return (
                <li key={row.symbol}>
                  <Link
                    href={`/markets/${encodeURIComponent(row.symbol)}`}
                    className="flex items-center gap-2 rounded-lg px-1 py-1.5 transition-colors hover:bg-white/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                  >
                    <span className="w-3 shrink-0 text-[11px] font-semibold text-textMuted font-mono">
                      {i + 1}
                    </span>
                    <AssetLogo src={row.logo} label={row.symbol} size={20} className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-white">
                      {row.symbol}
                    </span>
                    {tab === "volume" ? (
                      <span className="shrink-0 text-[11.5px] font-semibold text-textSecondary font-mono">
                        {row.volume24h == null ? DASH : fmtCountCompact(row.volume24h)}
                      </span>
                    ) : (
                      <span
                        className={`shrink-0 text-[11.5px] font-bold font-mono ${
                          up ? "text-gain" : "text-loss"
                        }`}
                      >
                        {fmtPctSigned(row.changePct)}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <button
        type="button"
        onClick={() => onViewAll(tab)}
        className="mt-2 w-full rounded-lg border border-white/[0.08] py-1.5 text-[11.5px] font-semibold text-textSecondary transition-colors hover:border-white/20 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        View all →
      </button>
    </section>
  );
}
