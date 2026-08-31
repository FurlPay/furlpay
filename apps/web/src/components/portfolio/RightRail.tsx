"use client";

import Link from "next/link";
import { ArrowLeftRight, Plus, Repeat, TrendingUp } from "lucide-react";
import { AssetLogo } from "@furlpay/ui";
import MiniSparkline from "@/components/MiniSparkline";
import { assetLogoPath, bySymbol } from "@/lib/markets/catalog";
import { Card, CardHead, Delta, Skeleton, money } from "./primitives";

// ---------------------------------------------------------------------------
// The research rail: insights, indices, watchlist, quick actions.
//
// Every module here is fed by an endpoint that exists (/api/insights,
// /api/markets/indices, /api/markets/movers) and each renders three distinct
// states — loading, empty, and loaded. The empty state matters: a rail that
// silently collapses when a feed is down looks like a layout bug, and one that
// shows stale placeholders is worse.
// ---------------------------------------------------------------------------

export interface InsightItem {
  slug: string;
  title: string;
  category: string;
  date: string;
  readMins: number;
  signal: "bullish" | "bearish" | "neutral" | null;
  tickers: string[];
}

export interface IndexItem {
  id: string;
  label: string;
  proxy: string;
  price: number;
  changePct: number;
  live: boolean;
}

export interface MoverItem {
  symbol: string;
  name: string;
  price: number;
  changePct: number;
}

export function MarketInsights({ items }: { items: InsightItem[] | null }) {
  return (
    <Card>
      <CardHead
        title="Market Insights"
        action={
          <Link
            href="/investing/insights"
            className="rounded text-[11.5px] font-semibold text-textSecondary transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gain"
          >
            View all
          </Link>
        }
      />
      <div className="divide-y divide-white/[0.05] px-4 pb-2 pt-3">
        {items === null ? (
          <div className="space-y-3 pb-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3.5 w-full" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="py-4 text-[12px] text-textMuted">No research published yet.</p>
        ) : (
          items.slice(0, 3).map((i) => (
            <Link
              key={i.slug}
              href={`/investing/insights/${i.slug}`}
              className="block py-3 first:pt-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gain"
            >
              <div className="flex items-center gap-2">
                <span className="truncate rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-textSecondary">
                  {i.category}
                </span>
                {i.signal && (
                  <span
                    className={`text-[10px] font-bold uppercase ${
                      i.signal === "bullish" ? "text-gain" : i.signal === "bearish" ? "text-loss" : "text-textMuted"
                    }`}
                  >
                    {i.signal}
                  </span>
                )}
                <span className="ml-auto shrink-0 text-[10.5px] text-textMuted">{i.readMins} min</span>
              </div>
              <p className="mt-1.5 line-clamp-2 text-[12.5px] font-semibold leading-snug text-white">
                {i.title}
              </p>
              {i.tickers.length > 0 && (
                <p className="mt-1 truncate text-[10.5px] text-textMuted">{i.tickers.slice(0, 4).join(" · ")}</p>
              )}
            </Link>
          ))
        )}
      </div>
    </Card>
  );
}

export function MajorIndices({ items }: { items: IndexItem[] | null }) {
  return (
    <Card>
      <CardHead title="Major Indices" />
      <div className="px-2 pb-2 pt-2">
        {items === null ? (
          <div className="space-y-2 px-2 py-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="px-2 py-4 text-[12px] text-textMuted">Index data is unavailable right now.</p>
        ) : (
          <ul>
            {items.slice(0, 5).map((x) => (
              <li key={x.id}>
                <Link
                  href={`/markets/${x.proxy}`}
                  className="flex items-center gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-white/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-gain"
                >
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-white">{x.label}</span>
                  <MiniSparkline seed={`idx-${x.id}`} changePct={x.changePct} width={44} height={18} />
                  <span className="w-[68px] shrink-0 text-right text-[12px] tabular-nums text-textSecondary">
                    {x.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </span>
                  <span className="w-[54px] shrink-0 text-right text-[12px]">
                    <Delta value={x.changePct} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

export function WatchlistRail({ items }: { items: MoverItem[] | null }) {
  return (
    <Card>
      <CardHead
        title="Watchlist"
        action={
          <Link
            href="/markets?panel=watchlist"
            className="rounded text-[11.5px] font-semibold text-textSecondary transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gain"
          >
            View all
          </Link>
        }
      />
      <div className="px-2 pb-2 pt-2">
        {items === null ? (
          <div className="space-y-2 px-2 py-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="px-2 py-4 text-[12px] text-textMuted">Nothing on your watchlist yet.</p>
        ) : (
          <ul>
            {items.slice(0, 6).map((m) => {
              const asset = bySymbol.get(m.symbol);
              return (
                <li key={m.symbol}>
                  <Link
                    href={`/markets/${m.symbol}`}
                    className="flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-white/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-gain"
                  >
                    <AssetLogo src={asset ? assetLogoPath(asset) : null} label={m.symbol} size={24} className="shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-semibold text-white">{m.symbol}</span>
                      <span className="block truncate text-[10.5px] text-textMuted">{m.name}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-[12px] tabular-nums text-white">{money(m.price)}</span>
                      <span className="block text-[11px]">
                        <Delta value={m.changePct} />
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}

const ACTIONS = [
  { label: "Buy / Sell", href: "/markets", Icon: TrendingUp },
  { label: "Transfer", href: "/dashboard", Icon: ArrowLeftRight },
  { label: "Add Funds", href: "/dashboard", Icon: Plus },
  { label: "Recurring", href: "/portfolio", Icon: Repeat },
] as const;

export function QuickActions() {
  return (
    <Card>
      <CardHead title="Quick Actions" />
      <div className="grid grid-cols-4 gap-1.5 p-3">
        {ACTIONS.map(({ label, href, Icon }) => (
          <Link
            key={label}
            href={href}
            className="flex flex-col items-center gap-1.5 rounded-xl border border-white/[0.06] px-1 py-2.5 transition-colors hover:border-white/20 hover:bg-white/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gain"
          >
            <Icon className="h-4 w-4 text-textSecondary" aria-hidden />
            <span className="text-center text-[10px] font-semibold leading-tight text-textSecondary">
              {label}
            </span>
          </Link>
        ))}
      </div>
    </Card>
  );
}
