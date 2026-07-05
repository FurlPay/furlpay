"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ShieldCheck, TrendingUp, Info } from "lucide-react";
import { getJSON } from "@/lib/api";
import { Spinner, usd } from "@/components/ui";

interface CreditData {
  apr: number;
  totalCollateral: number;
  borrowingPower: number;
  drawn: number;
  available: number;
  utilizationPct: number;
  currentLtvPct: number;
  maxLtvPct: number;
  healthFactor: number | null;
  monthlyInterest: number;
  collateral: { label: string; kind: "stablecoin" | "crypto" | "equity"; value: number; ltv: number; borrowable: number }[];
}

const KIND_LABEL = { stablecoin: "Stablecoin", crypto: "Crypto", equity: "Equity" } as const;

export default function CreditPage() {
  const [data, setData] = useState<CreditData | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    getJSON<CreditData>("/api/credit").then(setData).catch(console.error);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);
  if (!data) return <Spinner />;

  const healthy = data.healthFactor === null || data.healthFactor >= 1.5;

  return (
    <>
      <header className="flex items-center gap-3 px-4 pb-4 pt-3">
        <Link href="/dashboard" aria-label="Back" className="tap rounded-full border border-white/[0.08] bg-white/[0.04] p-2">
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-[22px] font-bold tracking-tight">Credit</h1>
      </header>

      {/* Available-to-borrow hero */}
      <section className="px-5">
        <div className="app-hero p-5">
          <div className="flex items-center justify-between">
            <p className="text-[13px] text-white/70">Available to borrow</p>
            <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white/80">
              {data.apr}% APR
            </span>
          </div>
          <p className="mt-2 text-[44px] font-extrabold leading-none tracking-tighter text-neon">
            {usd(data.available)}
          </p>
          <p className="mt-2 text-[12px] text-white/60">
            Backed by {usd(data.totalCollateral)} in stocks & crypto — spend without selling.
          </p>

          {/* Utilization */}
          <div className="mt-4">
            <div className="mb-1.5 flex justify-between text-[12px] text-white/70">
              <span>Drawn {usd(data.drawn)}</span>
              <span>Limit {usd(data.borrowingPower)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/[0.12]">
              <div className="h-full rounded-full bg-neon" style={{ width: `${data.utilizationPct}%` }} />
            </div>
          </div>

          <div className="mt-4 flex gap-3">
            <button
              onClick={() => setNotice("Draw from credit line (demo) — funds land as USDC instantly.")}
              className="tap flex-1 rounded-pill bg-neon py-3 text-[14px] font-bold text-black"
            >
              Borrow
            </button>
            <button
              onClick={() => setNotice("Repay credit line (demo).")}
              className="tap flex-1 rounded-pill border border-white/20 py-3 text-[14px] font-semibold"
            >
              Repay
            </button>
          </div>
          {notice && (
            <p className="mt-3 rounded-2xl bg-white/10 px-3 py-2 text-center text-[12px] text-white/80" role="status">
              {notice}
            </p>
          )}
        </div>
      </section>

      {/* Health + interest */}
      <section className="mt-4 grid grid-cols-2 gap-3 px-5">
        <div className="surface-card p-4">
          <p className="flex items-center gap-1.5 text-[12px] text-textSecondary">
            <ShieldCheck className={`h-4 w-4 ${healthy ? "text-gain" : "text-loss"}`} /> Health factor
          </p>
          <p className={`mt-1 text-xl font-bold ${healthy ? "text-gain" : "text-loss"}`}>
            {data.healthFactor === null ? "—" : `${data.healthFactor}×`}
          </p>
          <p className="text-[11px] text-textMuted">
            LTV {data.currentLtvPct}% / {data.maxLtvPct}% max
          </p>
        </div>
        <div className="surface-card p-4">
          <p className="text-[12px] text-textSecondary">Interest / month</p>
          <p className="mt-1 text-xl font-bold">{usd(data.monthlyInterest)}</p>
          <p className="text-[11px] text-textMuted">Only on drawn funds</p>
        </div>
      </section>

      {/* Collateral breakdown */}
      <section className="mt-7 px-5">
        <h2 className="mb-3 text-[17px] font-bold tracking-tight">Your collateral</h2>
        <div className="surface-card divide-y divide-white/[0.06]">
          {data.collateral.map((c) => (
            <div key={c.label} className="flex items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium">{c.label}</p>
                <p className="text-[11px] text-textMuted">
                  {KIND_LABEL[c.kind]} · {Math.round(c.ltv * 100)}% LTV
                </p>
              </div>
              <div className="text-right">
                <p className="text-[14px] font-semibold">{usd(c.value)}</p>
                <p className="flex items-center justify-end gap-1 text-[11px] text-neon">
                  <TrendingUp className="h-3 w-3" /> {usd(c.borrowable)} credit
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6 px-5">
        <div className="glow-border p-4">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-neon">
            <Info className="h-4 w-4" /> Why borrow instead of sell?
          </p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-textMuted">
            Selling triggers a taxable event and gives up your upside. A portfolio line lets you keep your
            stocks and crypto working while you spend — the strategy the ultra-wealthy already use.
          </p>
        </div>
        <p className="mt-4 text-center text-[11px] text-textMuted">
          Demo rates. Collateralized lending carries liquidation risk; not financial advice.
        </p>
      </section>
    </>
  );
}
