"use client";

import { useCallback, useEffect, useState } from "react";
import { getJSON, sendJSON } from "@/lib/api";
import { Holding } from "@/lib/types";
import { PageHeader, Pill, Spinner, pct, usd } from "@/components/ui";
import Modal from "@/components/Modal";

interface Dividend {
  symbol: string;
  amount: number;
  status: string;
  exDate: string;
}

interface InvestData {
  holdings: Holding[];
  dividends: Dividend[];
  performance: { marketValue: number; dayChange: number; dayChangePct: number };
}

export default function InvestPage() {
  const [data, setData] = useState<InvestData | null>(null);
  const [trade, setTrade] = useState<Holding | null>(null);

  const load = useCallback(() => {
    getJSON<InvestData>("/api/investing/portfolio").then(setData).catch(console.error);
  }, []);
  useEffect(() => load(), [load]);

  if (!data) return <Spinner />;
  const summary = data.performance;
  const up = summary.dayChange >= 0;

  return (
    <>
      <PageHeader title="Investing" right={<Pill tone="accent">Alpaca</Pill>} />

      <section className="px-5">
        <p className="text-[13px] text-textSecondary">Portfolio value</p>
        <p className="mt-1 text-5xl font-extrabold tracking-tighter">{usd(summary.marketValue)}</p>
        <p className={`mt-1 font-semibold ${up ? "text-gain" : "text-loss"}`}>
          {usd(summary.dayChange, { sign: true })} ({pct(summary.dayChangePct)}) today
        </p>

        {/* Simple sparkline-ish performance bar */}
        <div className="mt-4 flex h-24 items-end gap-1">
          {sampleSeries(up).map((h, i) => (
            <div key={i} className={`flex-1 rounded-t ${up ? "bg-gain/70" : "bg-loss/70"}`} style={{ height: `${h}%` }} />
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-2 px-5 text-lg font-bold">Holdings</h2>
        <ul className="space-y-1 px-2">
          {data.holdings.map((h) => {
            const hp = h.changePct >= 0;
            return (
              <li key={h.symbol}>
                <button onClick={() => setTrade(h)} className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left hover:bg-white/[0.03]">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.06] text-[13px] font-bold">
                    {h.symbol.slice(0, 2)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{h.symbol}</p>
                    <p className="truncate text-[13px] text-textSecondary">{h.shares.toFixed(3)} sh · {h.name}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">{usd(h.marketValue)}</p>
                    <p className={`text-[13px] font-medium ${hp ? "text-gain" : "text-loss"}`}>{pct(h.changePct)}</p>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {data.dividends.length > 0 && (
        <section className="mt-8 px-5">
          <h2 className="mb-2 text-lg font-bold">Dividends</h2>
          <div className="space-y-2">
            {data.dividends.map((d) => (
              <div key={d.symbol + d.exDate} className="flex items-center justify-between surface-card px-4 py-3">
                <div>
                  <p className="font-semibold">{d.symbol}</p>
                  <p className="text-[12px] text-textSecondary">ex-date {d.exDate}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold">{usd(d.amount)}</p>
                  <Pill tone={d.status === "paid" ? "gain" : "accent"}>{d.status}</Pill>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {trade && <TradeModal holding={trade} onClose={() => setTrade(null)} onDone={load} />}
    </>
  );
}

function TradeModal({ holding, onClose, onDone }: { holding: Holding; onClose: () => void; onDone: () => void }) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [mode, setMode] = useState<"notional" | "qty">("notional");
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [amount, setAmount] = useState("100");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      // Alpaca semantics: send EITHER notional OR qty, never both.
      const body: Record<string, unknown> = { symbol: holding.symbol, side, type: orderType, time_in_force: "day" };
      if (mode === "notional") body.notional = Number(amount);
      else body.qty = Number(amount);
      const res = await fetch("/api/investing/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Order rejected (${res.status})`);
      }
      onDone(); onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  const shares = mode === "notional" ? Number(amount) / holding.price : Number(amount);
  const est = mode === "notional" ? Number(amount) : Number(amount) * holding.price;

  return (
    <Modal open title={`${holding.symbol} · ${usd(holding.price)}`} onClose={onClose}>
      <div className="mb-3 grid grid-cols-2 gap-2 rounded-pill bg-surface p-1">
        {(["buy", "sell"] as const).map((s) => (
          <button key={s} onClick={() => setSide(s)} className={`rounded-pill py-2 text-sm font-semibold capitalize ${side === s ? "bg-accent" : "text-textSecondary"}`}>
            {s}
          </button>
        ))}
      </div>

      <div className="mb-3 flex gap-2">
        <select value={mode} onChange={(e) => setMode(e.target.value as "notional" | "qty")} className="flex-1 rounded-2xl bg-surface px-3 py-2.5 text-sm font-semibold outline-none">
          <option value="notional">In dollars</option>
          <option value="qty">In shares</option>
        </select>
        <select value={orderType} onChange={(e) => setOrderType(e.target.value as "market" | "limit")} className="flex-1 rounded-2xl bg-surface px-3 py-2.5 text-sm font-semibold outline-none">
          <option value="market">Market</option>
          <option value="limit">Limit</option>
        </select>
      </div>

      <label className="mb-1 block text-[12px] text-textSecondary">{mode === "notional" ? "Amount (USD)" : "Shares"}</label>
      <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="mb-2 w-full rounded-2xl bg-surface px-4 py-3 text-lg font-semibold outline-none" />
      <p className="mb-4 text-[13px] text-textSecondary">
        ≈ {mode === "notional" ? `${shares.toFixed(4)} shares` : usd(est)}
      </p>

      {error && <div className="mb-3 rounded-2xl bg-loss/15 p-3 text-[13px] text-loss">{error}</div>}

      <button onClick={submit} disabled={busy} className="w-full rounded-pill bg-accent py-3.5 font-semibold capitalize disabled:opacity-50">
        {busy ? "Placing…" : `${side} ${holding.symbol}`}
      </button>
    </Modal>
  );
}

// Deterministic pseudo-series for the perf chart.
function sampleSeries(up: boolean): number[] {
  const base = [40, 45, 42, 50, 48, 55, 53, 60, 58, 66, 62, up ? 78 : 44];
  return base;
}
