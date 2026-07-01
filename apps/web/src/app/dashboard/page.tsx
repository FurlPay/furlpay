"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getJSON } from "@/lib/api";
import { FiatBalance, TokenBalance, Transaction } from "@/lib/types";
import { PageHeader, Pill, Spinner, usd } from "@/components/ui";
import { PlusIcon, QrIcon, SwapIcon, ArrowDown, InvestIcon } from "@/components/icons";
import TransactionList from "@/components/TransactionList";
import SwapModal from "@/components/SwapModal";

interface Overview {
  user: { name: string; tier: string; region: string; safeAddress: string };
  netWorth: number;
  breakdown: { crypto: number; fiat: number; equities: number };
  tokenBalances: TokenBalance[];
  fiatBalances: FiatBalance[];
  recentTransactions: Transaction[];
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

  return (
    <>
      <PageHeader
        title={`Hi, ${data.user.name}`}
        right={<Pill tone="accent">{data.user.tier}</Pill>}
      />

      {/* Net worth hero */}
      <section className="px-5">
        <p className="text-[13px] text-textSecondary">Total net worth</p>
        <p className="mt-1 text-5xl font-extrabold tracking-tighter">{usd(data.netWorth)}</p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Stat label="On-chain" value={breakdown.crypto} />
          <Stat label="Fiat banks" value={breakdown.fiat} />
          <Stat label="Investments" value={breakdown.equities} />
        </div>
      </section>

      {/* Quick actions */}
      <section className="mt-6 grid grid-cols-4 gap-2 px-5">
        <QuickAction label="Pay" onClick={() => alert("QR / payment-link pay (demo)")}>
          <QrIcon />
        </QuickAction>
        <Link href="/investing" className="contents">
          <QuickAction label="Buy Stock"><InvestIcon /></QuickAction>
        </Link>
        <QuickAction label="Swap" onClick={() => setSwapOpen(true)}>
          <SwapIcon />
        </QuickAction>
        <QuickAction label="Receive" onClick={() => alert(`Deposit to Safe:\n${data.user.safeAddress}`)}>
          <ArrowDown />
        </QuickAction>
      </section>

      {/* Secondary navigation to platform surfaces */}
      <section className="mt-6 grid grid-cols-2 gap-3 px-5">
        <Link href="/banking" className="surface-card p-4">
          <p className="font-semibold">Banking</p>
          <p className="text-[12px] text-textSecondary">IBAN / routing · Wise FX</p>
        </Link>
        <Link href="/developer" className="surface-card p-4">
          <p className="font-semibold">Developers</p>
          <p className="text-[12px] text-textSecondary">API keys · webhooks · SDKs</p>
        </Link>
      </section>

      {/* Multi-currency balances carousel (Wise-style) */}
      <section className="mt-8">
        <h2 className="mb-3 px-5 text-lg font-bold">Accounts</h2>
        <div className="no-scrollbar flex gap-3 overflow-x-auto px-5 pb-1">
          {data.fiatBalances.map((f) => (
            <div key={f.currency} className="min-w-[150px] shrink-0 surface-card p-4">
              <p className="text-[13px] text-textSecondary">{f.currency}</p>
              <p className="mt-1 text-xl font-bold">
                {f.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}
              </p>
              <p className="mt-2 truncate text-[11px] text-textMuted">
                {f.localDetails?.iban || f.localDetails?.accountNumber || f.localDetails?.routingNumber}
              </p>
            </div>
          ))}
          {data.tokenBalances.map((t) => (
            <div key={t.token + t.chain} className="min-w-[150px] shrink-0 surface-card p-4">
              <div className="flex items-center gap-1">
                <p className="text-[13px] text-textSecondary">{t.token}</p>
                <Pill>{t.chain}</Pill>
              </div>
              <p className="mt-1 text-xl font-bold">{t.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}</p>
              <p className="mt-2 text-[11px] text-textMuted">≈ {usd(t.usdValue)}</p>
            </div>
          ))}
          <button className="min-w-[64px] shrink-0 rounded-card border border-dashed border-white/15 text-textSecondary">
            <PlusIcon className="mx-auto h-6 w-6" />
          </button>
        </div>
      </section>

      {/* Recent activity */}
      <section className="mt-8">
        <h2 className="mb-2 px-5 text-lg font-bold">Recent activity</h2>
        <TransactionList items={data.recentTransactions} />
      </section>

      <SwapModal open={swapOpen} onClose={() => setSwapOpen(false)} onDone={load} />
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="surface-card p-3">
      <p className="text-[11px] text-textSecondary">{label}</p>
      <p className="mt-0.5 text-sm font-bold">{usd(value)}</p>
    </div>
  );
}

function QuickAction({ label, children, onClick }: { label: string; children: React.ReactNode; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-2">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/[0.08] text-white">
        {children}
      </span>
      <span className="action-label">{label}</span>
    </button>
  );
}
