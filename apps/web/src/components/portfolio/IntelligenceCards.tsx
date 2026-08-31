"use client";

import Link from "next/link";
import { Sparkles } from "lucide-react";
import type { HealthBreakdown } from "@/lib/portfolioMetrics";
import { Card, CardHead, ScoreBar } from "./primitives";

// ---------------------------------------------------------------------------
// Portfolio intelligence and health.
//
// Both are computed in lib/portfolioMetrics.ts from the live position set, and
// every line names a figure that came from there. That constraint is what keeps
// this from being the "AI insights" filler the brief explicitly rejected: if a
// sentence cannot cite a number the page also shows, it is not emitted.
// ---------------------------------------------------------------------------

export function IntelligenceCard({ lines }: { lines: string[] }) {
  return (
    <Card>
      <CardHead
        title="Portfolio Intelligence"
        info="Observations derived from your current positions — not forecasts or advice."
      />
      <ul className="space-y-2.5 px-4 py-4">
        {lines.length === 0 ? (
          <li className="text-[12px] text-textMuted">
            Add a position to see observations about your allocation and concentration.
          </li>
        ) : (
          lines.map((l) => (
            <li key={l} className="flex gap-2.5">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gain" aria-hidden />
              <span className="text-[12.5px] leading-relaxed text-textSecondary">{l}</span>
            </li>
          ))
        )}
      </ul>
    </Card>
  );
}

export function HealthCard({ health }: { health: HealthBreakdown }) {
  return (
    <Card>
      <CardHead
        title="Portfolio Health"
        info="An average of five snapshot measures: diversification, concentration, risk balance, performance and liquidity."
      />
      <div className="px-4 py-4">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[30px] font-extrabold leading-none tracking-tighter tabular-nums text-white">
            {health.score}
          </span>
          <span className="text-[13px] font-medium text-textMuted">/ 100</span>
        </div>

        <ul className="mt-4 space-y-3">
          {health.parts.map((p) => (
            <li key={p.label}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[12px] text-textSecondary">{p.label}</span>
                <span className="shrink-0 text-[12px] font-semibold tabular-nums text-white">{p.score}</span>
              </div>
              <div className="mt-1.5">
                <ScoreBar score={p.score} ariaLabel={`${p.label}: ${p.score} of 100. ${p.detail}`} />
              </div>
              <p className="mt-1 truncate text-[10.5px] text-textMuted">{p.detail}</p>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

export function ActivityCard({
  items,
}: {
  items: { symbol: string; amount: number; date: string; status: string; kind: string }[];
}) {
  return (
    <Card>
      <CardHead
        title="Recent Activity"
        action={
          <Link
            href="/transactions"
            className="rounded text-[11.5px] font-semibold text-textSecondary transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gain"
          >
            View all
          </Link>
        }
      />
      <ul className="divide-y divide-white/[0.05] px-4 py-2">
        {items.length === 0 ? (
          <li className="py-4 text-[12px] text-textMuted">No recent portfolio activity.</li>
        ) : (
          items.slice(0, 5).map((t, i) => (
            <li key={`${t.symbol}-${t.date}-${i}`} className="flex items-center gap-3 py-2.5">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/[0.06] text-[10px] font-bold uppercase text-textSecondary">
                {t.kind.slice(0, 3)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-semibold text-white">
                  {t.kind} · {t.symbol}
                </span>
                <span className="block truncate text-[10.5px] text-textMuted">{t.date}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-[12.5px] font-semibold tabular-nums text-white">
                  ${t.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span
                  className={`block text-[10px] font-semibold uppercase ${
                    t.status === "paid" || t.status === "settled" ? "text-gain" : "text-textMuted"
                  }`}
                >
                  {t.status}
                </span>
              </span>
            </li>
          ))
        )}
      </ul>
    </Card>
  );
}
