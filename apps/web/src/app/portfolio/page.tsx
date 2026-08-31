"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getJSON } from "@/lib/api";
import type { Holding } from "@/lib/types";
import {
  toAllocation,
  toHealth,
  toInsights,
  toPositions,
  toRisk,
  type PositionRow,
} from "@/lib/portfolioMetrics";
import AppSidebar from "@/components/AppSidebar";
import TopBar, { type TabId } from "@/components/portfolio/TopBar";
import PortfolioHero from "@/components/portfolio/PortfolioHero";
import { AllocationCard, IncomeCard, RiskCard } from "@/components/portfolio/AnalyticsCards";
import HoldingsTable from "@/components/portfolio/HoldingsTable";
import AssetDrawer from "@/components/portfolio/AssetDrawer";
import {
  ActivityCard,
  HealthCard,
  IntelligenceCard,
} from "@/components/portfolio/IntelligenceCards";
import {
  MajorIndices,
  MarketInsights,
  QuickActions,
  WatchlistRail,
  type IndexItem,
  type InsightItem,
  type MoverItem,
} from "@/components/portfolio/RightRail";
import { Card, Skeleton } from "@/components/portfolio/primitives";
import BottomNav from "@/components/BottomNav";
import WalletConnectModal from "@/components/wallet/WalletConnectModal";

// ---------------------------------------------------------------------------
// /portfolio — the institutional portfolio workstation.
//
// A NEW route rather than a rewrite of /investing. The two surfaces answer
// different questions: /investing is the consumer hub (discovery, collections,
// recurring buys) and stays exactly as it is, while this is the analyst view of
// the same positions. Both read /api/investing/portfolio, so there is one
// source of truth and no data contract changed.
//
// Every figure on this page is derived from the live account:
//   holdings, cost basis, P&L    /api/investing/portfolio
//   cash and buying power        /api/account/balance
//   indices, movers, research    /api/markets/indices, /movers, /api/insights
//
// Nothing is seeded with invented positions. Where a metric genuinely needs
// data the API does not serve — volatility, Sharpe, beta, drawdown, VaR,
// time- and money-weighted return — the UI says so rather than printing a
// number that would look authoritative and be fiction. See RiskCard.
// ---------------------------------------------------------------------------

interface Dividend {
  symbol: string;
  amount: number;
  status: string;
  exDate: string;
}

interface PortfolioResponse {
  holdings: Holding[];
  dividends: Dividend[];
  performance: {
    marketValue: number;
    dayChange: number;
    dayChangePct: number;
    totalReturn: number;
    totalReturnPct: number;
    costBasis: number;
  };
}

export default function PortfolioPage() {
  const [data, setData] = useState<PortfolioResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [cash, setCash] = useState(0);
  const [insights, setInsights] = useState<InsightItem[] | null>(null);
  const [indices, setIndices] = useState<IndexItem[] | null>(null);
  const [movers, setMovers] = useState<MoverItem[] | null>(null);
  const [tab, setTab] = useState<TabId>("overview");
  const [selected, setSelected] = useState<PositionRow | null>(null);
  const [depositOpen, setDepositOpen] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    getJSON<PortfolioResponse>("/api/investing/portfolio")
      .then(setData)
      .catch(() => setFailed(true));
    // The rail's feeds are independent: one failing must not blank the page,
    // so each settles its own state and renders its own empty case.
    // balanceUsd arrives as a STRING ("0.00") from this route — the account
    // layer serialises money to fixed-precision text. Coercing here rather than
    // at each use site: string arithmetic would silently produce "0.001063.96"
    // in the allocation totals, and `"0.00" > 0` is true, which would render a
    // phantom Cash slice on an empty balance.
    getJSON<{ balanceUsd: number | string }>("/api/account/balance")
      .then((r) => {
        const n = typeof r.balanceUsd === "number" ? r.balanceUsd : Number.parseFloat(r.balanceUsd);
        setCash(Number.isFinite(n) ? n : 0);
      })
      .catch(() => setCash(0));
    getJSON<{ items: InsightItem[] }>("/api/insights?limit=4")
      .then((r) => setInsights(r.items))
      .catch(() => setInsights([]));
    getJSON<{ items: IndexItem[] }>("/api/markets/indices")
      .then((r) => setIndices(r.items))
      .catch(() => setIndices([]));
    getJSON<{ gainers: MoverItem[] }>("/api/markets/movers?limit=6")
      .then((r) => setMovers(r.gainers))
      .catch(() => setMovers([]));
  }, []);

  useEffect(() => load(), [load]);

  const positions = useMemo(() => (data ? toPositions(data.holdings) : []), [data]);
  const allocation = useMemo(() => toAllocation(positions, cash), [positions, cash]);
  const risk = useMemo(() => toRisk(positions, cash), [positions, cash]);
  const health = useMemo(
    () => toHealth(positions, cash, risk, data?.performance.totalReturnPct ?? 0),
    [positions, cash, risk, data]
  );
  const intelligence = useMemo(
    () =>
      data
        ? toInsights(positions, allocation, risk, {
            totalReturnPct: data.performance.totalReturnPct,
            dayChangePct: data.performance.dayChangePct,
          })
        : [],
    [positions, allocation, risk, data]
  );

  const dividendsYtd = useMemo(
    () => (data?.dividends ?? []).filter((d) => d.status === "paid").reduce((s, d) => s + d.amount, 0),
    [data]
  );
  const upcoming = useMemo(
    () => (data?.dividends ?? []).filter((d) => d.status !== "paid").reduce((s, d) => s + d.amount, 0),
    [data]
  );

  const activity = useMemo(
    () =>
      (data?.dividends ?? []).slice(0, 5).map((d) => ({
        symbol: d.symbol,
        amount: d.amount,
        date: d.exDate,
        status: d.status,
        kind: "Dividend",
      })),
    [data]
  );

  return (
    <div className="flex min-h-screen bg-oled">
      <AppSidebar />

      <div className="min-w-0 flex-1">
        <TopBar tab={tab} onTab={setTab} unread={0} onDeposit={() => setDepositOpen(true)} />

        <main className="px-5 pb-28 pt-5 lg:px-7 lg:pb-10">
          {failed ? (
            <LoadFailed onRetry={load} />
          ) : !data ? (
            <LoadingGrid />
          ) : (
            <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-start">
              {/* Main column */}
              <div className="flex min-w-0 flex-1 flex-col gap-4">
                <PortfolioHero
                  marketValue={data.performance.marketValue}
                  dayChange={data.performance.dayChange}
                  dayChangePct={data.performance.dayChangePct}
                  totalReturn={data.performance.totalReturn}
                  totalReturnPct={data.performance.totalReturnPct}
                  costBasis={data.performance.costBasis}
                  cashUsd={cash}
                />

                <div className="grid gap-4 lg:grid-cols-3">
                  <AllocationCard slices={allocation} />
                  <RiskCard risk={risk} />
                  <IncomeCard
                    dividendsYtd={dividendsYtd}
                    paidCount={(data.dividends ?? []).filter((d) => d.status === "paid").length}
                    upcoming={upcoming}
                    portfolioValue={data.performance.marketValue}
                  />
                </div>

                <HoldingsTable positions={positions} onSelect={setSelected} />

                <div className="grid gap-4 lg:grid-cols-2">
                  <IntelligenceCard lines={intelligence} />
                  <ActivityCard items={activity} />
                </div>
              </div>

              {/* Research rail — a column at 2xl, a two-up grid below it so the
                  modules do not become a long tail of single cards on a laptop. */}
              <div className="grid gap-4 sm:grid-cols-2 2xl:w-[320px] 2xl:shrink-0 2xl:grid-cols-1">
                <MarketInsights items={insights} />
                <MajorIndices items={indices} />
                <WatchlistRail items={movers} />
                <HealthCard health={health} />
                <QuickActions />
              </div>
            </div>
          )}
        </main>

        <div className="lg:hidden">
          <BottomNav />
        </div>
      </div>

      <AssetDrawer position={selected} onClose={() => setSelected(null)} />
      <WalletConnectModal open={depositOpen} onClose={() => setDepositOpen(false)} />
    </div>
  );
}

function LoadingGrid() {
  return (
    <div className="flex flex-col gap-4 2xl:flex-row" aria-busy="true" aria-label="Loading your portfolio">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <Card className="p-5">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="mt-3 h-10 w-64" />
          <Skeleton className="mt-6 h-[248px] w-full" />
        </Card>
        <div className="grid gap-4 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="p-4">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="mt-4 h-[132px] w-full" />
            </Card>
          ))}
        </div>
        <Card className="p-4">
          <Skeleton className="h-3.5 w-24" />
          <div className="mt-4 space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        </Card>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 2xl:w-[320px] 2xl:shrink-0 2xl:grid-cols-1">
        {[0, 1, 2].map((i) => (
          <Card key={i} className="p-4">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="mt-3 h-24 w-full" />
          </Card>
        ))}
      </div>
    </div>
  );
}

function LoadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <Card className="max-w-[520px] p-6">
      <h2 className="text-[15px] font-bold text-white">We could not load your portfolio</h2>
      <p className="mt-1.5 text-[13px] leading-relaxed text-textSecondary">
        The request did not come back. Your positions are unchanged — check your connection and try
        again.
      </p>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg bg-gain px-4 py-2 text-[13px] font-bold text-[#04220F] transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gain"
        >
          Try again
        </button>
        <Link
          href="/portfolio"
          className="rounded-lg border border-white/[0.14] px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:border-white/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gain"
        >
          Go to Investing
        </Link>
      </div>
    </Card>
  );
}
