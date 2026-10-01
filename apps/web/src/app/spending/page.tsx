"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getJSON } from "@/lib/api";
import { Spinner, usd } from "@/components/ui";

interface AnalyticsData {
  period: string;
  totalSpent: number;
  transactionCount: number;
  categories: { label: string; amount: number; count: number; pct: number }[];
  topMerchants: { name: string; amount: number }[];
}

// Deterministic accent per category for the bars / dots.
const COLORS = ["#00E599", "#FF3B30", "#6366F1", "#F59E0B", "#22D3EE", "#A78BFA"];

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  useEffect(() => {
    getJSON<AnalyticsData>("/api/analytics").then(setData).catch(console.error);
  }, []);
  if (!data) return <Spinner />;

  return (
    <>
      <header className="flex items-center gap-3 px-4 pb-4 pt-3">
        <Link href="/dashboard" aria-label="Back" className="tap rounded-full border border-white/[0.08] bg-white/[0.04] p-2">
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-[22px] font-bold tracking-tight">Analytics</h1>
      </header>

      {/* Spend hero */}
      <section className="px-5">
        <div className="app-hero p-5">
          <p className="text-[13px] text-white/70">Spent · {data.period}</p>
          <p className="mt-1 text-[40px] font-extrabold leading-none tracking-tighter">
            {usd(data.totalSpent)}
          </p>
          <p className="mt-2 text-[12px] text-white/60">{data.transactionCount} transactions</p>

          {/* Stacked proportion bar */}
          <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-white/10">
            {data.categories.map((c, i) => (
              <div
                key={c.label}
                style={{ width: `${c.pct}%`, background: COLORS[i % COLORS.length] }}
                title={`${c.label} ${c.pct}%`}
              />
            ))}
          </div>
        </div>
      </section>

      {/* By category */}
      <section className="mt-7 px-5">
        <h2 className="mb-3 text-[17px] font-bold tracking-tight">By category</h2>
        <div className="surface-card divide-y divide-white/[0.06]">
          {data.categories.map((c, i) => (
            <div key={c.label} className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                  <span className="text-[14px] font-medium">{c.label}</span>
                  <span className="text-[12px] text-textSecondary">· {c.count}</span>
                </div>
                <span className="text-[14px] font-bold">{usd(c.amount)}</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${c.pct}%`, background: COLORS[i % COLORS.length] }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Top merchants */}
      {data.topMerchants.length > 0 && (
        <section className="mt-7 px-5">
          <h2 className="mb-3 text-[17px] font-bold tracking-tight">Top merchants</h2>
          <div className="surface-card divide-y divide-white/[0.06]">
            {data.topMerchants.map((mch) => (
              <div key={mch.name} className="flex items-center justify-between p-4">
                <span className="text-[14px]">{mch.name}</span>
                <span className="text-[14px] font-bold">{usd(mch.amount)}</span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-center text-[11px] text-textMuted">
            Categorized from merchant data (MCC) — demo dataset.
          </p>
        </section>
      )}
    </>
  );
}
