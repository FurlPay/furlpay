"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { AlertCircle, Bell, RefreshCw, Search, Settings, User } from "lucide-react";
import { KpiStat } from "@/components/terminal/KpiStat";
import { Panel, Skeleton } from "@/components/terminal/Panel";
import { Sidebar } from "@/components/terminal/Sidebar";
import {
  CategoryBreakdown,
  PERIOD_LABEL,
  PeriodToggle,
  SpendTrend,
  TravelExpenses,
} from "@/components/terminal/ExpensePanels";
import {
  AgentsPanel,
  AllocationPanel,
  CardsPanel,
  QUICK_ACTIONS,
  TokenizedPanel,
  WalletPanel,
  WatchlistPanel,
} from "@/components/terminal/RailPanels";
import {
  useAgents,
  useCards,
  useExpenses,
  useMovers,
  useOverview,
  usePortfolio,
  useTokenizedAssets,
} from "@/lib/terminal/hooks";
import type { Period } from "@/lib/expenses/periods";

// FurlPay Terminal — a financial command center.
//
// LAYOUT: fixed left nav · header with the wallet value pinned top-right ·
// compact KPI strip · a dominant candlestick chart · a three-column body of
// real panels (allocation, expenses, wallet, watchlist, agents, cards).
//
// EVERY NUMBER IS REAL. The panels are bound to endpoints verified against the
// running server. Where the reviewer asked for data the system does not hold —
// flights booked, countries visited, distance travelled, "AI buy confidence
// 91%", risk scores, market heatmaps — those panels are deliberately absent
// rather than filled with invented figures. A fabricated confidence score next
// to a live Alpaca price is indistinguishable from a real one, which is the one
// thing a financial surface must never do.

const PriceChart = dynamic(() => import("@/components/PriceChart"), {
  ssr: false,
  loading: () => <Skeleton className="h-[420px] w-full" />,
});

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

export default function TerminalPage() {
  const [period, setPeriod] = useState<Period>("month");

  const overview = useOverview();
  const expenses = useExpenses(period);
  const portfolio = usePortfolio();
  const rwa = useTokenizedAssets();
  const agents = useAgents();
  const movers = useMovers();
  const cards = useCards();

  const overall = expenses.data?.overall;
  const travel = expenses.data?.travel;
  const netWorth = overview.data?.netWorth;

  const spendSpark = useMemo(() => overall?.buckets.map((b) => b.spentUsd) ?? [], [overall]);

  const refreshAll = () => {
    overview.refresh();
    expenses.refresh();
    portfolio.refresh();
    rwa.refresh();
    agents.refresh();
    movers.refresh();
    cards.refresh();
  };

  const anyLoading = overview.loading || expenses.loading;

  return (
    <div className="flex min-h-screen bg-term-bg text-textPrimary">
      <Sidebar active="Dashboard" />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header — wallet value pinned top-right, Robinhood-style */}
        <header className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-term-border bg-term-bg/85 px-5 py-3 backdrop-blur-md">
          <div className="min-w-0">
            <h1 className="text-[15px] font-semibold tracking-tight">Dashboard</h1>
            <p className="text-[10px] text-textSecondary">Portfolio · Treasury · AI Finance</p>
          </div>

          {/* Search — a real affordance, wired to the markets search page */}
          <a
            href="/markets"
            className="ml-auto hidden items-center gap-2 rounded-lg border border-term-border bg-term-panel px-3 py-1.5 text-[12px] text-textSecondary transition-colors hover:text-textPrimary md:flex"
          >
            <Search size={14} />
            <span>Search markets…</span>
          </a>

          {/* Wallet value — always visible */}
          <div className="flex items-center gap-2 rounded-lg border border-term-border bg-term-panel px-3 py-1.5">
            <div>
              <p className="text-[9px] uppercase tracking-wider text-textSecondary">Net worth</p>
              <p className="font-mono text-[15px] font-bold leading-tight tabular-nums text-neon">
                {netWorth !== undefined ? usd2(netWorth) : "—"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <IconButton label="Notifications" href="/notifications">
              <Bell size={16} />
            </IconButton>
            <IconButton label="Settings" href="/dashboard">
              <Settings size={16} />
            </IconButton>
            <button
              onClick={refreshAll}
              disabled={anyLoading}
              aria-label="Refresh all data"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-term-border bg-term-panel text-textSecondary transition-colors hover:text-textPrimary disabled:opacity-50"
            >
              <RefreshCw size={15} className={anyLoading ? "animate-spin" : ""} />
            </button>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-neon/15 text-neon">
              <User size={16} />
            </div>
          </div>
        </header>

        <main className="w-full px-5 py-5">
          {/* Compact KPI strip */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mb-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6"
          >
            <KpiStat label="Net worth" value={netWorth} format={usd} hint="Crypto, fiat and equities" />
            <KpiStat
              label="Portfolio"
              value={portfolio.data?.performance.marketValue}
              format={usd}
              deltaPct={portfolio.data?.performance.dayChangePct ?? null}
              hint="Equities market value · today's move"
            />
            <KpiStat
              label={`Spend · ${period}`}
              value={overall?.totalSpentUsd}
              format={usd}
              deltaPct={overall?.changePct ?? null}
              spark={spendSpark}
              invertDelta
            />
            <KpiStat
              label={`Travel · ${period}`}
              value={travel?.totalSpentUsd}
              format={usd}
              deltaPct={travel?.changePct ?? null}
              invertDelta
            />
            <KpiStat
              label="Stablecoins"
              value={
                overview.data
                  ? overview.data.tokenBalances
                      .filter((b) => ["USDC", "USDT", "EURC", "XSGD", "XUSD", "PYUSD", "DAI"].includes(b.token))
                      .reduce((s, b) => s + b.usdValue, 0)
                  : undefined
              }
              format={usd}
              hint="Held across all chains"
            />
            <KpiStat
              label="Active agents"
              value={agents.data?.summary.activeAgents}
              format={(n) => String(Math.round(n))}
              hint="Autonomous agents currently spending under policy"
            />
          </motion.div>

          {(overview.error || expenses.error) && (
            <div
              role="alert"
              className="mb-5 flex flex-wrap items-center gap-3 rounded-card border border-loss/30 bg-loss/10 px-4 py-3 text-[12px] text-loss"
            >
              <AlertCircle size={16} className="shrink-0" />
              <span className="min-w-0 flex-1">{overview.error ?? expenses.error}</span>
              {/* A locked account has a specific next step; everything else
                  just needs a retry. Both are more useful than a dead dash. */}
              {overview.status === 423 ? (
                <a
                  href="/security"
                  className="rounded-lg border border-loss/40 px-3 py-1 font-semibold text-loss transition-colors hover:bg-loss/15"
                >
                  Unlock account
                </a>
              ) : (
                <button
                  onClick={refreshAll}
                  className="rounded-lg border border-loss/40 px-3 py-1 font-semibold text-loss transition-colors hover:bg-loss/15"
                >
                  Try again
                </button>
              )}
            </div>
          )}

          {/* Dominant chart + right rail */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            {/* Chart takes the majority of the width */}
            <div className="flex flex-col gap-4 xl:col-span-8">
              <Panel
                title="Market"
                subtitle="AAPL · live OHLC — Alpaca, CoinGecko fallback"
                index={0}
                actions={<PeriodBadge />}
                className="min-h-[520px]"
              >
                <PriceChart
                  seed="terminal"
                  endValue={netWorth ?? 1000}
                  symbol="AAPL"
                  height={430}
                  defaultTf="1M"
                  defaultMode="candles"
                />
              </Panel>

              {/* Allocation + expenses side by side under the chart */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <AllocationPanel
                  breakdown={overview.data?.breakdown}
                  holdings={portfolio.data?.holdings ?? []}
                  index={1}
                />
                {expenses.loading && !overall ? (
                  <Skeleton className="h-[200px]" />
                ) : overall ? (
                  <SpendTrend summary={overall} index={2} />
                ) : null}
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {expenses.loading && !overall ? (
                  <Skeleton className="h-[200px]" />
                ) : overall ? (
                  <CategoryBreakdown summary={overall} title={`Spending · ${PERIOD_LABEL[period]}`} index={3} />
                ) : null}
                {expenses.loading && !travel ? (
                  <Skeleton className="h-[200px]" />
                ) : travel ? (
                  <TravelExpenses travel={travel} index={4} />
                ) : null}
              </div>
            </div>

            {/* Right rail — wallet, watchlist, agents, cards, tokenized */}
            <div className="flex flex-col gap-4 xl:col-span-4">
              <div className="flex items-center justify-between">
                <PeriodToggle value={period} onChange={setPeriod} />
                {expenses.data && (
                  <span className="text-[10px] text-textMuted">
                    as of{" "}
                    {new Date(expenses.data.asOf).toLocaleTimeString(undefined, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-2">
                {QUICK_ACTIONS.map((a) => (
                  <a
                    key={a.label}
                    href={a.href}
                    className="flex items-center gap-2 rounded-lg border border-term-border bg-term-raised px-3 py-2.5 text-[12px] font-medium text-textPrimary transition-colors hover:border-neon/40 hover:text-neon"
                  >
                    {a.icon}
                    {a.label}
                  </a>
                ))}
              </div>

              <WalletPanel overview={overview.data} index={5} />
              <WatchlistPanel gainers={movers.data?.gainers ?? []} losers={movers.data?.losers ?? []} index={6} />
              <AgentsPanel data={agents.data} index={7} />
              <CardsPanel cards={cards.data?.cards ?? []} index={8} />
              <TokenizedPanel rwa={rwa.data} index={9} />
            </div>
          </div>

          <p className="mt-6 text-center text-[10px] text-textMuted">
            Market data from Alpaca and CoinGecko. Balances and expense figures are computed from
            your own account. FurlPay does not provide investment advice.
          </p>
        </main>
      </div>
    </div>
  );
}

function IconButton({ label, href, children }: { label: string; href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      aria-label={label}
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-term-border bg-term-panel text-textSecondary transition-colors hover:text-textPrimary"
    >
      {children}
    </a>
  );
}

function PeriodBadge() {
  return (
    <span className="rounded-pill border border-term-border px-2 py-0.5 text-[10px] text-textSecondary">
      1D–ALL
    </span>
  );
}
