"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bell, ArrowUpRight } from "lucide-react";
import { getJSON } from "@/lib/api";
import { FiatBalance, TokenBalance, Transaction } from "@/lib/types";
import { Spinner, usd } from "@/components/ui";
import { QrIcon, SwapIcon, ArrowDown, InvestIcon } from "@/components/icons";
import TransactionList from "@/components/TransactionList";
import SwapModal from "@/components/SwapModal";
import { CoinLogo, ChainLogo } from "@furlpay/ui";
import FeatureHub from "@/components/FeatureHub";
import PriceChart from "@/components/PriceChart";

interface Overview {
  user: { name: string; tier: string; region: string; safeAddress: string };
  netWorth: number;
  breakdown: { crypto: number; fiat: number; equities: number };
  tokenBalances: TokenBalance[];
  fiatBalances: FiatBalance[];
  recentTransactions: Transaction[];
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default function HomePage() {
  const [data, setData] = useState<Overview | null>(null);
  const [swapOpen, setSwapOpen] = useState(false);

  const load = useCallback(() => {
    getJSON<Overview>("/api/overview").then(setData).catch(console.error);
  }, []);

  useEffect(() => load(), [load]);

  if (!data) return <Spinner />;

  const { breakdown } = data;
  const initial = data.user.name.trim().charAt(0).toUpperCase() || "U";

  return (
    <>
      {/* Top bar */}
      <header className="flex items-center justify-between px-5 pb-3 pt-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accentDeep text-lg font-bold shadow-[0_8px_20px_-8px_rgba(255,59,48,0.7)]">
            {initial}
          </div>
          <div>
            <p className="text-[12px] text-textSecondary">{greeting()}</p>
            <p className="-mt-0.5 text-[15px] font-bold tracking-tight">{data.user.name}</p>
          </div>
        </div>
        <button
          aria-label="Notifications"
          className="tap relative flex h-11 w-11 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04]"
        >
          <Bell className="h-5 w-5 text-textSecondary" />
          <span className="absolute right-3 top-3 h-2 w-2 rounded-full bg-accent ring-2 ring-black" />
        </button>
      </header>

      {/* Balance hero */}
      <section className="px-5">
        <div className="app-hero p-5">
          <div className="flex items-center justify-between">
            <p className="text-[13px] text-white/70">Total net worth</p>
            <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white/80">
              {data.user.tier} · {data.user.region}
            </span>
          </div>
          <p className="mt-2 text-[44px] font-extrabold leading-none tracking-tighter">
            {usd(data.netWorth)}
          </p>

          <div className="mt-5 grid grid-cols-3 gap-2">
            <HeroStat label="On-chain" value={breakdown.crypto} />
            <HeroStat label="Fiat" value={breakdown.fiat} />
            <HeroStat label="Invest" value={breakdown.equities} />
          </div>
        </div>
      </section>

      {/* Portfolio performance chart */}
      <section className="mt-5 px-5">
        <div className="surface-card p-4">
          <PriceChart seed="furlpay-networth" endValue={data.netWorth} height={200} defaultTf="1M" />
        </div>
      </section>

      {/* Quick actions */}
      <section className="mt-5 grid grid-cols-4 gap-3 px-5">
        <QuickAction label="Pay" onClick={() => alert("QR / payment-link pay (demo)")}>
          <QrIcon />
        </QuickAction>
        <Link href="/investing" className="contents">
          <QuickAction label="Buy Stock">
            <InvestIcon />
          </QuickAction>
        </Link>
        <QuickAction label="Swap" onClick={() => setSwapOpen(true)}>
          <SwapIcon />
        </QuickAction>
        <QuickAction
          label="Receive"
          onClick={() => alert(`Deposit to Safe:\n${data.user.safeAddress}`)}
        >
          <ArrowDown />
        </QuickAction>
      </section>

      {/* Super-app feature hub */}
      <FeatureHub />

      {/* Accounts carousel */}
      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between px-5">
          <h2 className="text-[17px] font-bold tracking-tight">Accounts</h2>
          <span className="text-[12px] text-textSecondary">
            {data.fiatBalances.length + data.tokenBalances.length} total
          </span>
        </div>
        <div className="no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-1">
          {data.fiatBalances.map((f) => (
            <div key={f.currency} className="w-[168px] shrink-0 snap-start surface-card p-4">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.06] text-[12px] font-bold">
                  {currencySymbol(f.currency)}
                </span>
                <p className="text-[13px] font-medium text-textSecondary">{f.currency}</p>
              </div>
              <p className="mt-3 text-xl font-bold tracking-tight">
                {f.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}
              </p>
              <p className="mt-2 truncate text-[11px] text-textMuted">
                {f.localDetails?.iban ||
                  f.localDetails?.accountNumber ||
                  f.localDetails?.routingNumber}
              </p>
            </div>
          ))}
          {data.tokenBalances.map((t) => (
            <div key={t.token + t.chain} className="w-[168px] shrink-0 snap-start surface-card p-4">
              <div className="flex items-center gap-2">
                <CoinLogo token={t.token} size={26} />
                <p className="text-[13px] font-medium text-textSecondary">{t.token}</p>
                <span className="ml-auto">
                  <ChainLogo chain={t.chain} size={16} />
                </span>
              </div>
              <p className="mt-3 text-xl font-bold tracking-tight">
                {t.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}
              </p>
              <p className="mt-2 text-[11px] text-textMuted">≈ {usd(t.usdValue)}</p>
            </div>
          ))}
          <button
            aria-label="Add account"
            className="tap flex w-[64px] shrink-0 snap-start flex-col items-center justify-center rounded-[18px] border border-dashed border-white/15 text-textSecondary"
          >
            <span className="text-2xl leading-none">+</span>
          </button>
        </div>
      </section>

      {/* Recent activity */}
      <section className="mt-8 px-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[17px] font-bold tracking-tight">Recent activity</h2>
          <button className="flex items-center gap-0.5 text-[12px] font-semibold text-accent">
            See all <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="surface-card overflow-hidden">
          <TransactionList items={data.recentTransactions} />
        </div>
      </section>

      <SwapModal open={swapOpen} onClose={() => setSwapOpen(false)} onDone={load} />
    </>
  );
}

function HeroStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-white/[0.06] px-3 py-2.5 backdrop-blur-sm">
      <p className="text-[11px] text-white/60">{label}</p>
      <p className="mt-0.5 text-[15px] font-bold tracking-tight">{usd(value)}</p>
    </div>
  );
}

function QuickAction({
  label,
  children,
  onClick,
}: {
  label: string;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button onClick={onClick} className="tap app-tile flex flex-col items-center gap-2 py-3.5">
      <span className="app-tile-icon h-11 w-11">{children}</span>
      <span className="text-[12px] font-semibold tracking-tight">{label}</span>
    </button>
  );
}

function currencySymbol(code: string): string {
  const map: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", INR: "₹", JPY: "¥" };
  return map[code] ?? code.charAt(0);
}
