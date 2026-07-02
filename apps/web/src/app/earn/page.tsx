"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, TrendingUp } from "lucide-react";
import { getJSON } from "@/lib/api";
import { Spinner, usd } from "@/components/ui";
import { CoinLogo } from "@furlpay/ui";

interface EarnData {
  products: { token: string; apy: number; risk: string; protocol: string; min: number }[];
  positions: { token: string; principal: number; apy: number; earnedUsd: number; days: number }[];
  summary: { totalPrincipal: number; totalEarned: number; blendedApy: number; projectedYearly: number };
  idleUsdc: number;
}

export default function EarnPage() {
  const [data, setData] = useState<EarnData | null>(null);
  useEffect(() => {
    getJSON<EarnData>("/api/earn").then(setData).catch(console.error);
  }, []);
  if (!data) return <Spinner />;
  const { summary } = data;

  return (
    <>
      <header className="flex items-center gap-3 px-4 pb-4 pt-3">
        <Link href="/dashboard" aria-label="Back" className="tap rounded-full border border-white/[0.08] bg-white/[0.04] p-2">
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-[22px] font-bold tracking-tight">Earn</h1>
      </header>

      {/* Earnings hero */}
      <section className="px-5">
        <div className="app-hero p-5">
          <div className="flex items-center justify-between">
            <p className="text-[13px] text-white/70">Total earned</p>
            <span className="rounded-full bg-neon/15 px-2.5 py-1 text-[11px] font-bold text-neon">
              Up to 9.5% APY
            </span>
          </div>
          <p className="mt-1 text-[40px] font-extrabold leading-none tracking-tighter text-neon">
            {usd(summary.totalEarned)}
          </p>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <HeroStat label="Deposited" value={usd(summary.totalPrincipal)} />
            <HeroStat label="Blended APY" value={`${summary.blendedApy}%`} />
            <HeroStat label="Est. / year" value={usd(summary.projectedYearly)} />
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-white/60">
            We route reserves into low-risk tokenized T-bills and lending vaults and pass the yield
            through to you — no lock-up, withdraw anytime.
          </p>
        </div>
      </section>

      {data.idleUsdc > 0 && (
        <section className="mt-4 px-5">
          <div className="glow-border flex items-center justify-between p-4">
            <div>
              <p className="text-[13px] font-semibold">You have {usd(data.idleUsdc)} idle USDC</p>
              <p className="text-[12px] text-textSecondary">Put it to work at up to 9.5% APY.</p>
            </div>
            <span className="rounded-pill bg-neon px-4 py-2 text-[13px] font-bold text-black">Deposit</span>
          </div>
        </section>
      )}

      {/* Active positions */}
      {data.positions.length > 0 && (
        <section className="mt-7 px-5">
          <h2 className="mb-3 text-[17px] font-bold tracking-tight">Your positions</h2>
          <div className="space-y-3">
            {data.positions.map((p) => (
              <div key={p.token} className="surface-card flex items-center gap-3 p-4">
                <CoinLogo token={p.token} size={36} />
                <div className="flex-1">
                  <p className="font-semibold">{p.token}</p>
                  <p className="text-[12px] text-textSecondary">
                    {usd(p.principal)} · {p.days} days
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-neon">+{usd(p.earnedUsd)}</p>
                  <p className="text-[12px] text-textSecondary">{p.apy}% APY</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Products */}
      <section className="mt-7 px-5">
        <h2 className="mb-3 text-[17px] font-bold tracking-tight">Yield vaults</h2>
        <div className="space-y-3">
          {data.products.map((p) => (
            <div key={p.token} className="surface-card flex items-center gap-3 p-4">
              <CoinLogo token={p.token} size={36} />
              <div className="flex-1">
                <p className="font-semibold">{p.token}</p>
                <p className="text-[12px] text-textSecondary">{p.protocol}</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="flex items-center gap-1 font-bold text-neon">
                    <TrendingUp className="h-3.5 w-3.5" /> {p.apy}%
                  </p>
                  <p className="text-[11px] text-textSecondary">{p.risk} risk</p>
                </div>
                <span className="rounded-pill border border-neon/40 px-3 py-1.5 text-[12px] font-semibold text-neon">
                  Earn
                </span>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-center text-[11px] text-textMuted">
          Demo rates. Yield involves smart-contract risk; not financial advice.
        </p>
      </section>
    </>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/[0.06] px-3 py-2.5">
      <p className="text-[11px] text-white/60">{label}</p>
      <p className="mt-0.5 text-[15px] font-bold tracking-tight">{value}</p>
    </div>
  );
}
