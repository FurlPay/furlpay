"use client";

import { useMemo, useState } from "react";
import type { UsdcHistory } from "@/lib/onchain/usdcHistory";
import type { UsdcNetwork } from "@/lib/onchain/usdcNetwork";
import { BrandLogo, chainName } from "../BrandLogo";
import { CHAIN_COLOR, CHAIN_ORDER, Def, dur, int, pctStr, Segmented, usdc } from "./parts";

// History (stored, finalized-only index) and cross-chain rankings. Server-side
// aggregates only; nothing here sums raw events. Chains without data in the
// range are listed as not ranked, with the reason — never drawn as zero.

type Metric = "volume" | "transfers" | "mintburn" | "supply";

function useBars(h: UsdcHistory, metric: Metric) {
  return useMemo(() => {
    const buckets = [...new Set((metric === "supply" ? h.supplySeries : h.series).map((r) => r.bucket))].sort();
    const chains = CHAIN_ORDER.filter((c) => (metric === "supply" ? h.supplySeries.some((s) => s.chain === c) : h.chains.some((x) => x.chain === c && x.activity)));
    const last: Record<string, number> = {};
    const rows = buckets.map((b) => {
      const parts: { chain: string; v: number; sub?: number }[] = [];
      for (const c of chains) {
        if (metric === "supply") {
          const s = h.supplySeries.find((x) => x.bucket === b && x.chain === c);
          if (s) last[c] = Number(s.supply);
          if (last[c] !== undefined) parts.push({ chain: c, v: last[c] }); // carried forward until the next snapshot
        } else {
          const r = h.series.find((x) => x.bucket === b && x.chain === c);
          if (!r) continue;
          if (metric === "volume") parts.push({ chain: c, v: Number(r.volume) });
          else if (metric === "transfers") parts.push({ chain: c, v: r.transfers });
          else parts.push({ chain: c, v: Number(r.minted), sub: Number(r.burned) });
        }
      }
      return { bucket: b, parts, total: parts.reduce((a, p) => a + p.v, 0), totalSub: parts.reduce((a, p) => a + (p.sub ?? 0), 0) };
    });
    const max = Math.max(1e-9, ...rows.map((r) => Math.max(r.total, r.totalSub)));
    return { rows, chains, max };
  }, [h, metric]);
}

const label = (iso: string, bucket: UsdcHistory["bucket"]) =>
  bucket === "day" ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });

export function HistoryChart({ h }: { h: UsdcHistory }) {
  const [metric, setMetric] = useState<Metric>("volume");
  const [hover, setHover] = useState<number | null>(null);
  const { rows, chains, max } = useBars(h, metric);
  const fmtV = (v: number) => (metric === "transfers" ? int(v) : usdc(String(v)));
  const W = 100;
  const bw = rows.length ? W / rows.length : W;
  const hv = hover !== null ? rows[hover] : null;
  return (
    <div className="min-w-0">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Segmented
          label="History metric"
          value={metric}
          onChange={setMetric}
          options={[
            { v: "volume", l: "Volume" },
            { v: "transfers", l: "Transfers" },
            { v: "mintburn", l: "Mint / burn" },
            { v: "supply", l: "Supply" },
          ]}
        />
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-white/70" aria-label="Legend">
          {chains.map((c) => (
            <li key={c} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm" style={{ background: CHAIN_COLOR[c] }} aria-hidden="true" />
              {chainName(c)}
            </li>
          ))}
          {metric === "mintburn" && <li className="text-white/45">bars above axis = minted, below = burned</li>}
        </ul>
      </div>
      {rows.length === 0 ? (
        <p className="flex h-[150px] items-center justify-center rounded-lg border border-dashed border-white/[0.09] text-center text-[12px] text-white/45">
          {h.chains.length === 0 ? h.reason ?? "Nothing indexed in this range yet." : metric === "supply" ? "No supply snapshots in this range yet." : "No indexed USDC activity matched this range."}
        </p>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} 60`} preserveAspectRatio="none" className="h-[150px] w-full" role="img" aria-label={`USDC ${metric} per ${h.bucket}, stacked by chain, ${rows.length} buckets`} onMouseLeave={() => setHover(null)}>
            <line x1="0" x2={W} y1={metric === "mintburn" ? 30 : 60} y2={metric === "mintburn" ? 30 : 60} stroke="rgba(255,255,255,0.12)" strokeWidth="0.2" />
            {rows.map((r, i) => {
              let y = metric === "mintburn" ? 30 : 60;
              let yd = 30;
              const scale = metric === "mintburn" ? 30 : 60;
              return (
                <g key={r.bucket} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={-1}>
                  <rect x={i * bw} y={0} width={bw} height={60} fill="transparent" />
                  {r.parts.map((p) => {
                    const hgt = (p.v / max) * scale;
                    y -= hgt;
                    const down = metric === "mintburn" ? ((p.sub ?? 0) / max) * scale : 0;
                    const el = (
                      <g key={p.chain}>
                        <rect x={i * bw + bw * 0.12} y={y} width={bw * 0.76} height={Math.max(hgt, 0)} fill={CHAIN_COLOR[p.chain]} opacity={hover === null || hover === i ? 0.95 : 0.45} />
                        {down > 0 && <rect x={i * bw + bw * 0.12} y={yd} width={bw * 0.76} height={down} fill={CHAIN_COLOR[p.chain]} opacity={0.45} />}
                      </g>
                    );
                    yd += down;
                    return el;
                  })}
                </g>
              );
            })}
          </svg>
          <div className="mt-1 flex justify-between text-[10px] text-white/40" aria-hidden="true">
            <span>{label(rows[0].bucket, h.bucket)}</span>
            {rows.length > 2 && <span>{label(rows[Math.floor(rows.length / 2)].bucket, h.bucket)}</span>}
            <span>{label(rows[rows.length - 1].bucket, h.bucket)} UTC</span>
          </div>
          {hv && (
            <div className="pointer-events-none absolute right-0 top-0 z-10 min-w-[180px] rounded-md border border-white/[0.12] bg-[#0D1415]/95 px-2.5 py-2 text-[11px] shadow-xl shadow-black/60" role="status">
              <p className="mb-1 font-semibold text-white">{new Date(hv.bucket).toLocaleString("en-US", { timeZone: "UTC", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })} UTC</p>
              {hv.parts.map((p) => (
                <p key={p.chain} className="flex justify-between gap-3">
                  <span className="flex items-center gap-1.5 text-white/70">
                    <span className="h-1.5 w-1.5 rounded-sm" style={{ background: CHAIN_COLOR[p.chain] }} />
                    {chainName(p.chain)}
                  </span>
                  <span className="tabular-nums text-white">
                    {fmtV(p.v)}
                    {metric === "mintburn" && ` / −${usdc(String(p.sub ?? 0))}`}
                  </span>
                </p>
              ))}
              {metric !== "supply" && <p className="mt-1 border-t border-white/10 pt-1 text-right tabular-nums text-white">{fmtV(hv.total)}</p>}
            </div>
          )}
        </div>
      )}
      <ul className="mt-2 space-y-0.5 text-[10.5px] text-white/45">
        {h.chains.map((c) => (
          <li key={c.chain}>
            {chainName(c.chain)}: {c.activity ? "transfers + supply" : "supply only"} indexed from {c.coveredFrom ? new Date(c.coveredFrom).toLocaleString("en-US", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" }) : "—"} UTC
            {c.coveredTo ? ` to ${new Date(c.coveredTo).toLocaleTimeString("en-US", { timeZone: "UTC", hour12: false })} UTC (finalized)` : ""}
            {c.partial && <span className="text-[#F5B83D]"> · partial for this range</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Bars({ title, def, items }: { title: string; def: string; items: { chain: string; v: number; text: string }[] }) {
  const max = Math.max(1e-9, ...items.map((i) => Math.abs(i.v)));
  return (
    <div className="min-w-0">
      <h4 className="mb-1.5 text-[11.5px] font-semibold text-white/80">
        <Def k={def}>{title}</Def>
      </h4>
      {items.length === 0 ? (
        <p className="text-[11px] text-white/40">No chain has data for this yet.</p>
      ) : (
        <ol className="space-y-1">
          {items.map((i, n) => (
            <li key={i.chain} className="grid grid-cols-[14px_96px_1fr_auto] items-center gap-1.5 text-[11px]">
              <span className="text-white/40 tabular-nums">{n + 1}</span>
              <span className="flex min-w-0 items-center gap-1 truncate">
                <BrandLogo kind="chain" id={i.chain} size={12} />
                {chainName(i.chain)}
              </span>
              <span className="h-1.5 rounded-full bg-white/[0.06]">
                <span className="block h-1.5 rounded-full" style={{ width: `${(Math.abs(i.v) / max) * 100}%`, background: i.v < 0 ? "#FF4D6D" : CHAIN_COLOR[i.chain] }} />
              </span>
              <span className="tabular-nums text-white/85">{i.text}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function Rankings({ h, live }: { h: UsdcHistory | null; live: UsdcNetwork | null }) {
  const lagging = live
    ? live.chains
        .filter((c) => c.chain !== "solana" && live.health[c.chain]?.lagSeconds != null)
        .map((c) => ({ chain: c.chain, v: live.health[c.chain].lagSeconds!, text: dur(live.health[c.chain].lagSeconds) }))
        .sort((a, b) => b.v - a.v)
    : [];
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Bars title="Most transfer volume" def="volume" items={(h?.rankings.volume ?? []).map((r) => ({ chain: r.chain, v: Number(r.value), text: usdc(r.value) }))} />
      <Bars title="Fastest supply growth" def="netSupply" items={(h?.rankings.supplyGrowth ?? []).map((r) => ({ chain: r.chain, v: r.value, text: pctStr(r.value) }))} />
      <Bars title="Supply concentration" def="supply" items={(h?.rankings.supplyShare ?? []).map((r) => ({ chain: r.chain, v: r.value, text: pctStr(r.value, 1).replace("+", "") }))} />
      <Bars title="Index lag (most behind first)" def="lag" items={lagging} />
      {h && h.rankings.notRanked.length > 0 && (
        <p className="text-[10.5px] text-white/45 sm:col-span-2 xl:col-span-4">
          Not ranked: {h.rankings.notRanked.map((n) => `${chainName(n.chain)} (${n.reason})`).join("; ")}
        </p>
      )}
    </div>
  );
}
