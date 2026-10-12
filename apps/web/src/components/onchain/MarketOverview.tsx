"use client";

import { useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { OnchainDashboard as Data } from "@/lib/onchain/dashboard";
import { supplyBreakdown } from "@/lib/onchain/dashboardView";
import { fmtUsd } from "@/components/analytics/format";
import { Card, Change, TipBox } from "./ui";

// ---------------------------------------------------------------------------
// Stablecoin Market Overview: USD-pegged circulating supply from DefiLlama,
// split by asset or by chain. The source lists its largest assets and chains,
// and the remainder is drawn as "Others" so the ring is the whole market.
//
// Velocity and holder counts have no source on this deployment, so there is
// no tab for them. Supply is not volume, and nothing here is presented as
// payment activity.
// ---------------------------------------------------------------------------

const COLORS = ["#347DFF", "#12C9BC", "#19D99A", "#FFD66B", "#A65CF5", "#14B8E8"];
const OTHERS = "#4B5D69";
const usd = (n: number) => fmtUsd(n, { compact: true });

type By = "asset" | "chain";

export function MarketOverview({ data }: { data: Data }) {
  const [by, setBy] = useState<By>("asset");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const M = data.market.status === "ok" ? data.market.data : null;
  const slices = useMemo(() => (M ? supplyBreakdown(M, by) : []), [M, by]);
  const shown = slices.filter((s) => !hidden.has(s.key));
  const color = (key: string, i: number) => (key === "__others" ? OTHERS : COLORS[i % COLORS.length]);
  const toggle = (key: string) =>
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const tab = (id: By, label: string) => (
    <button
      role="tab"
      aria-selected={by === id}
      onClick={() => {
        setBy(id);
        setHidden(new Set());
      }}
      className={`rounded-[5px] border px-2.5 py-1 text-[11.5px] transition-colors ${by === id ? "border-[#347DFF]/50 bg-[#347DFF]/[0.12] text-white" : "border-white/[0.08] text-white/60 hover:text-white"}`}
    >
      {label}
    </button>
  );

  return (
    <Card title="Stablecoin Market Overview" id="market-overview" source={data.market.source} freshness={data.freshness?.market ?? null}>
      <div role="tablist" aria-label="Break down supply by" className="mb-3 flex gap-1.5">
        {tab("asset", "Total Supply")}
        {tab("chain", "Chains")}
      </div>
      {data.market.status === "unavailable" ? (
        <p className="text-[12px] text-white/50">{data.market.reason}</p>
      ) : !M || slices.length === 0 ? (
        <p className="text-[12px] text-white/50">The market source returned no USD-pegged supply.</p>
      ) : (
        <div className="grid flex-1 grid-cols-1 items-center gap-4 sm:grid-cols-[180px_minmax(0,1fr)]">
          <div className="relative mx-auto h-[180px] w-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={shown} dataKey="supplyUsd" nameKey="label" innerRadius={62} outerRadius={84} paddingAngle={1.2} startAngle={90} endAngle={-270} stroke="none" isAnimationActive={false}>
                  {shown.map((s) => (
                    <Cell key={s.key} fill={color(s.key, slices.indexOf(s))} />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }) =>
                    active && payload?.[0] ? (
                      <TipBox
                        title={String(payload[0].name)}
                        rows={[
                          { label: "Supply", value: usd(Number(payload[0].value)) },
                          { label: "Share", value: `${((Number(payload[0].value) / M.totalSupplyUsd) * 100).toFixed(1)}%` },
                        ]}
                      />
                    ) : null
                  }
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-[21px] font-bold tabular-nums text-white">{usd(M.totalSupplyUsd)}</span>
              <span className="text-[10.5px] text-white/55">Total supply</span>
              {M.supplyChange30d !== null && <Change ratio={M.supplyChange30d} className="text-[11px]" />}
            </div>
          </div>
          <ul className="space-y-[7px] text-[12px]" aria-label="Supply breakdown">
            {slices.map((s, i) => {
              const off = hidden.has(s.key);
              return (
                <li key={s.key}>
                  <button
                    onClick={() => toggle(s.key)}
                    aria-pressed={!off}
                    title={off ? "Show in chart" : "Hide from chart"}
                    className={`grid w-full grid-cols-[10px_minmax(0,1fr)_auto_48px] items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-white/[0.04] ${off ? "opacity-40" : ""}`}
                  >
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: color(s.key, i) }} aria-hidden="true" />
                    <span className="truncate text-white/90">{s.label}</span>
                    <span className="tabular-nums text-white">{usd(s.supplyUsd)}</span>
                    <span className="text-right tabular-nums text-white/60">{(s.share * 100).toFixed(1)}%</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <p className="mt-2 text-[10.5px] leading-snug text-white/40">
        USD-pegged circulating supply as published by DefiLlama, which counts a different asset set from other trackers. Supply is not payment volume. Click a row to hide it from the ring.
      </p>
    </Card>
  );
}
