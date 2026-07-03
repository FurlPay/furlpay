"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { getJSON, postJSON } from "@/lib/api";
import { PageHeader, Spinner, pct, usd } from "@/components/ui";
import Modal from "@/components/Modal";
import PriceChart from "@/components/PriceChart";
import { AssetLogo } from "@furlpay/ui";

// Markets — the full tradable catalog (top US stocks, major ETFs, top-cap
// crypto) with the latest prices. Prices refresh every 60s from /api/markets.

interface MarketItem {
  symbol: string;
  name: string;
  kind: "stock" | "etf" | "crypto";
  logo: string | null;
  price: number;
  changePct: number;
  live: boolean;
}

const TABS = [
  { id: "all", label: "All" },
  { id: "stock", label: "Stocks" },
  { id: "etf", label: "ETFs" },
  { id: "crypto", label: "Crypto" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function fmtPrice(p: number): string {
  if (p >= 1) return usd(p);
  return "$" + p.toPrecision(3);
}

export default function MarketsPage() {
  const [items, setItems] = useState<MarketItem[] | null>(null);
  const [tab, setTab] = useState<TabId>("all");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<MarketItem | null>(null);

  const load = useCallback(() => {
    getJSON<{ items: MarketItem[] }>("/api/markets").then((r) => setItems(r.items)).catch(console.error);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const filtered = useMemo(() => {
    if (!items) return [];
    const needle = q.trim().toLowerCase();
    return items.filter(
      (i) =>
        (tab === "all" || i.kind === tab) &&
        (!needle || i.symbol.toLowerCase().includes(needle) || i.name.toLowerCase().includes(needle))
    );
  }, [items, tab, q]);

  if (!items) return <Spinner />;
  const anyLive = items.some((i) => i.live);

  return (
    <>
      <PageHeader
        title="Markets"
        right={
          <span className="flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] font-semibold text-textSecondary">
            <span className={`h-1.5 w-1.5 rounded-full ${anyLive ? "bg-gain animate-pulse" : "bg-textMuted"}`} />
            {anyLive ? "Live prices" : "Delayed"}
          </span>
        }
      />

      {/* Search */}
      <div className="px-5">
        <div className="flex items-center gap-2 rounded-2xl bg-surface px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-textMuted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search 100+ stocks, ETFs & crypto"
            className="w-full bg-transparent text-[14px] outline-none placeholder:text-textMuted"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-3 flex gap-2 px-5">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold ${
              tab === t.id ? "bg-white text-black" : "bg-white/[0.06] text-textSecondary"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Asset list */}
      <ul className="mt-3 space-y-0.5 px-2 pb-6">
        {filtered.map((i) => {
          const up = i.changePct >= 0;
          return (
            <li key={i.symbol}>
              <button
                onClick={() => setSelected(i)}
                className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left hover:bg-white/[0.03]"
              >
                <AssetLogo src={i.logo} label={i.symbol} size={38} className="shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{i.symbol}</p>
                  <p className="truncate text-[12px] text-textSecondary">{i.name}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold">{fmtPrice(i.price)}</p>
                  <p className={`text-[12px] font-medium ${up ? "text-gain" : "text-loss"}`}>{pct(i.changePct)}</p>
                </div>
              </button>
            </li>
          );
        })}
        {filtered.length === 0 && (
          <p className="px-4 py-10 text-center text-[13px] text-textSecondary">No assets match “{q}”.</p>
        )}
      </ul>

      {selected && <AssetModal item={selected} onClose={() => setSelected(null)} onDone={load} />}
    </>
  );
}

// Detail sheet — price chart plus buy/sell for equities.
function AssetModal({ item, onClose, onDone }: { item: MarketItem; onClose: () => void; onDone: () => void }) {
  const tradable = item.kind !== "crypto";
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("100");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState(false);
  const up = item.changePct >= 0;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await postJSON<{ error?: string }>("/api/investing/order", {
        symbol: item.symbol,
        side,
        notional: Number(amount),
        type: "market",
        time_in_force: "day",
      });
      if (!res.ok) throw new Error(res.data.error || `Order rejected (${res.status})`);
      setPlaced(true);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={`${item.symbol} · ${fmtPrice(item.price)}`} onClose={onClose}>
      <div className="mb-3 flex items-center gap-3">
        <AssetLogo src={item.logo} label={item.symbol} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] text-textSecondary">{item.name}</p>
          <p className={`text-[13px] font-semibold ${up ? "text-gain" : "text-loss"}`}>{pct(item.changePct)} today</p>
        </div>
        {item.live && (
          <span className="flex items-center gap-1 rounded-full bg-gain/10 px-2 py-0.5 text-[10px] font-semibold text-gain">
            <span className="h-1 w-1 rounded-full bg-gain" /> LIVE
          </span>
        )}
      </div>

      <div className="mb-4 rounded-2xl bg-white/[0.03] p-3">
        <PriceChart seed={`mkt-${item.symbol}`} endValue={item.price} height={160} defaultTf="1M" />
      </div>

      {placed ? (
        <div className="rounded-2xl bg-gain/10 p-4 text-center">
          <p className="font-semibold text-gain">Order filled</p>
          <p className="mt-1 text-[13px] text-textSecondary">
            {side === "buy" ? "Bought" : "Sold"} {usd(Number(amount))} of {item.symbol}
          </p>
        </div>
      ) : tradable ? (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2 rounded-pill bg-surface p-1">
            {(["buy", "sell"] as const).map((sv) => (
              <button
                key={sv}
                onClick={() => setSide(sv)}
                className={`rounded-pill py-2 text-sm font-semibold capitalize ${side === sv ? "bg-accent" : "text-textSecondary"}`}
              >
                {sv}
              </button>
            ))}
          </div>
          <label className="mb-1 block text-[12px] text-textSecondary">Amount (USD)</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="mb-2 w-full rounded-2xl bg-surface px-4 py-3 text-lg font-semibold outline-none"
          />
          <p className="mb-4 text-[13px] text-textSecondary">≈ {(Number(amount) / item.price).toFixed(4)} shares</p>
          {error && <div className="mb-3 rounded-2xl bg-loss/15 p-3 text-[13px] text-loss">{error}</div>}
          <button
            onClick={submit}
            disabled={busy || !(Number(amount) > 0)}
            className="w-full rounded-pill bg-accent py-3.5 font-semibold capitalize disabled:opacity-50"
          >
            {busy ? "Placing…" : `${side} ${item.symbol}`}
          </button>
        </>
      ) : (
        <p className="rounded-2xl bg-white/[0.04] p-4 text-center text-[13px] text-textSecondary">
          Spot crypto trading runs through stablecoin swaps — use Swap on the dashboard. Live price shown for reference.
        </p>
      )}
    </Modal>
  );
}
