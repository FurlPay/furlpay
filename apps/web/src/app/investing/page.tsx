"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  TrendingUp, Repeat, ArrowLeftRight, Newspaper, ChevronRight, Landmark, Bitcoin, Blocks, LineChart,
} from "lucide-react";
import { getJSON, postJSON } from "@/lib/api";
import { Holding } from "@/lib/types";
import { PageHeader, Pill, Spinner, pct, usd } from "@/components/ui";
import Modal from "@/components/Modal";
import PriceChart from "@/components/PriceChart";
import MiniSparkline from "@/components/MiniSparkline";
import MarketIndices from "@/components/MarketIndices";
import DonutChart, { DonutSlice } from "@/components/DonutChart";
import CollectionCard from "@/components/CollectionCard";
import AssetRow, { fmtPrice } from "@/components/AssetRow";
import SignalBadge from "@/components/insights/SignalBadge";
import { AssetLogo } from "@furlpay/ui";
import { COLLECTIONS } from "@/lib/markets/collections";
import { bySymbol, assetLogoPath } from "@/lib/markets/catalog";
import { categoryById } from "@/lib/insights/categories";

// Investing hub — portfolio summary, market pulse, holdings & allocation,
// FurlPay Research insights, and discovery (movers, collections, categories).

function marketOpen(): boolean {
  const d = new Date();
  const day = d.getUTCDay();
  if (day === 0 || day === 6) return false;
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  return mins >= 13 * 60 + 30 && mins < 20 * 60;
}

interface Dividend { symbol: string; amount: number; status: string; exDate: string }
interface InvestData {
  holdings: Holding[];
  dividends: Dividend[];
  performance: { marketValue: number; dayChange: number; dayChangePct: number };
}
interface InsightMeta {
  slug: string; title: string; category: string; date: string; readMins: number;
  signal: "bullish" | "bearish" | "neutral" | null; tickers: string[];
}
interface Mover { symbol: string; name: string; logo: string | null; price: number; changePct: number }

const KIND_COLORS: Record<string, string> = { stock: "#FF3B30", etf: "#0A84FF", crypto: "#BF5AF2" };

export default function InvestPage() {
  const [data, setData] = useState<InvestData | null>(null);
  const [insights, setInsights] = useState<InsightMeta[]>([]);
  const [movers, setMovers] = useState<Mover[]>([]);
  const [sipOpen, setSipOpen] = useState(false);

  const load = useCallback(() => {
    getJSON<InvestData>("/api/investing/portfolio").then(setData).catch(console.error);
    getJSON<{ items: InsightMeta[] }>("/api/insights?limit=4").then((r) => setInsights(r.items)).catch(() => {});
    getJSON<{ gainers: Mover[] }>("/api/markets/movers?limit=6").then((r) => setMovers(r.gainers)).catch(() => {});
  }, []);
  useEffect(() => load(), [load]);

  if (!data) return <Spinner />;
  const { performance: perf } = data;
  const open = marketOpen();
  const dayUp = perf.dayChange >= 0;
  // Demo cost basis → stable all-time return figure.
  const costBasis = perf.marketValue / 1.152;
  const totalReturn = perf.marketValue - costBasis;

  // Allocation by asset kind (via catalog lookup).
  const alloc = new Map<string, number>();
  for (const h of data.holdings) {
    const kind = bySymbol.get(h.symbol)?.kind ?? "stock";
    alloc.set(kind, (alloc.get(kind) ?? 0) + h.marketValue);
  }
  const slices: DonutSlice[] = [...alloc.entries()].map(([kind, value]) => ({
    label: kind === "etf" ? "ETFs" : kind === "crypto" ? "Crypto" : "Stocks",
    value,
    color: KIND_COLORS[kind],
  }));

  const divYtd = data.dividends.filter((d) => d.status === "paid").reduce((s, d) => s + d.amount, 0);

  return (
    <>
      <PageHeader
        title="Investing"
        right={
          <span className="flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] font-semibold text-textSecondary">
            <span className={`h-1.5 w-1.5 rounded-full ${open ? "bg-gain" : "bg-textMuted"}`} />
            {open ? "Market open" : "Market closed"}
          </span>
        }
      />

      {/* Portfolio summary */}
      <section className="px-5">
        <div className="app-hero p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[13px] text-white/70">Portfolio value</p>
              <p className="mt-1.5 text-[36px] font-extrabold leading-none tracking-tighter">{usd(perf.marketValue)}</p>
            </div>
            <MiniSparkline seed="invest-hero" changePct={perf.dayChangePct} width={72} height={30} strokeWidth={2} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-2xl bg-white/[0.08] px-3 py-2.5">
              <p className="text-[11px] text-white/60">Today</p>
              <p className={`text-[15px] font-bold tracking-tight ${dayUp ? "text-gain" : "text-loss"}`}>
                {dayUp ? "+" : "−"}{usd(Math.abs(perf.dayChange))} ({pct(perf.dayChangePct)})
              </p>
            </div>
            <div className="rounded-2xl bg-white/[0.08] px-3 py-2.5">
              <p className="text-[11px] text-white/60">Total return</p>
              <p className="text-[15px] font-bold tracking-tight text-gain">+{usd(totalReturn)} (+15.2%)</p>
            </div>
          </div>
        </div>
      </section>

      {/* Quick actions */}
      <section className="mt-4 grid grid-cols-4 gap-3 px-5">
        <Link href="/markets" className="contents">
          <QuickAction label="Buy"><TrendingUp className="h-5 w-5" /></QuickAction>
        </Link>
        <QuickAction label="Recurring" onClick={() => setSipOpen(true)}><Repeat className="h-5 w-5" /></QuickAction>
        <Link href="/dashboard" className="contents">
          <QuickAction label="Transfer"><ArrowLeftRight className="h-5 w-5" /></QuickAction>
        </Link>
        <Link href="/investing/insights" className="contents">
          <QuickAction label="Insights"><Newspaper className="h-5 w-5" /></QuickAction>
        </Link>
      </section>

      {/* Market pulse */}
      <section className="mt-6">
        <h2 className="mb-2 px-5 text-[15px] font-bold tracking-tight">Market pulse</h2>
        <MarketIndices />
      </section>

      {/* Portfolio chart */}
      <section className="mt-5 px-5">
        <div className="surface-card p-4">
          <PriceChart seed="furlpay-portfolio" endValue={perf.marketValue} height={200} defaultTf="1M" />
        </div>
      </section>

      {/* Holdings + allocation */}
      <section className="mt-6">
        <div className="mb-2 flex items-center justify-between px-5">
          <h2 className="text-[15px] font-bold tracking-tight">Your holdings</h2>
          <Link href="/markets" className="text-[12px] font-semibold text-accent">Explore markets →</Link>
        </div>

        {slices.length > 1 && (
          <div className="mx-5 mb-3 flex items-center gap-5 surface-card p-4">
            <DonutChart slices={slices} size={110} thickness={12} centerValue={usd(perf.marketValue)} centerLabel="allocated" />
            <div className="flex-1 space-y-2">
              {slices.map((s) => (
                <div key={s.label} className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                  <span className="flex-1 text-[12px] text-textSecondary">{s.label}</span>
                  <span className="text-[12px] font-semibold">{((s.value / Math.max(perf.marketValue, 1)) * 100).toFixed(0)}%</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <ul className="space-y-1 px-2">
          {[...data.holdings]
            .sort((a, b) => b.marketValue - a.marketValue)
            .map((h) => {
              const asset = bySymbol.get(h.symbol);
              return (
                <li key={h.symbol}>
                  <AssetRow
                    item={{
                      symbol: h.symbol,
                      name: h.name,
                      logo: asset ? assetLogoPath(asset) : null,
                      price: h.marketValue,
                      changePct: h.changePct,
                      sub: `${h.shares.toFixed(3)} sh · ${fmtPrice(h.price)}`,
                    }}
                    href={`/markets/${h.symbol}`}
                  />
                </li>
              );
            })}
        </ul>
      </section>

      {/* FurlPay Research */}
      {insights.length > 0 && (
        <section className="mt-7">
          <div className="mb-2 flex items-center justify-between px-5">
            <h2 className="text-[15px] font-bold tracking-tight">Latest from FurlPay Research</h2>
            <Link href="/investing/insights" className="text-[12px] font-semibold text-accent">View all →</Link>
          </div>
          <div className="no-scrollbar flex snap-x gap-2.5 overflow-x-auto px-5">
            {insights.map((i) => {
              const cat = categoryById(i.category);
              return (
                <Link
                  key={i.slug}
                  href={`/investing/insights/${i.slug}`}
                  className="w-[230px] shrink-0 snap-start overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.03]"
                >
                  <div className="h-1.5 w-full" style={{ background: cat?.color ?? "#666" }} />
                  <div className="p-3.5">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full border px-2 py-0.5 text-[9.5px] font-semibold" style={{ color: cat?.color, borderColor: cat?.color }}>
                        {cat?.label ?? i.category}
                      </span>
                      {i.signal && <SignalBadge signal={i.signal} compact />}
                    </div>
                    <p className="mt-2 line-clamp-3 text-[13px] font-semibold leading-snug">{i.title}</p>
                    <p className="mt-2 text-[10.5px] text-textMuted">{i.readMins} min read · {i.tickers.slice(0, 3).join(" · ")}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Discover */}
      {movers.length > 0 && (
        <section className="mt-7">
          <h2 className="mb-2 px-5 text-[15px] font-bold tracking-tight">Trending today</h2>
          <div className="no-scrollbar flex snap-x gap-2.5 overflow-x-auto px-5">
            {movers.map((m) => (
              <Link key={m.symbol} href={`/markets/${m.symbol}`} className="w-[118px] shrink-0 snap-start surface-card p-3">
                <AssetLogo src={m.logo} label={m.symbol} size={26} />
                <p className="mt-2 truncate text-[13px] font-bold">{m.symbol}</p>
                <p className="truncate text-[11px] text-textMuted">{fmtPrice(m.price)}</p>
                <p className={`text-[12px] font-semibold ${m.changePct >= 0 ? "text-gain" : "text-loss"}`}>{pct(m.changePct)}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="mt-7">
        <h2 className="mb-2 px-5 text-[15px] font-bold tracking-tight">Collections for you</h2>
        <div className="no-scrollbar flex snap-x gap-2.5 overflow-x-auto px-5">
          {COLLECTIONS.filter((col) => ["ai-robotics", "crypto-blue-chips", "dividend-kings", "semiconductors", "defi-blue-chips"].includes(col.slug)).map((col) => (
            <CollectionCard key={col.slug} slug={col.slug} title={col.title} blurb={col.blurb} gradient={col.gradient} icon={col.icon} count={col.symbols.length} />
          ))}
        </div>
      </section>

      {/* Explore by category */}
      <section className="mt-7 grid grid-cols-2 gap-2.5 px-5">
        {[
          { label: "US Stocks", sub: "200+ listed", href: "/markets?tab=stock", Icon: LineChart },
          { label: "ETFs", sub: "68 funds", href: "/markets?tab=etf", Icon: Landmark },
          { label: "Crypto", sub: "100+ assets", href: "/markets?tab=crypto", Icon: Bitcoin },
          { label: "Blockchains", sub: "25 networks", href: "/markets/chains", Icon: Blocks },
        ].map(({ label, sub, href, Icon }) => (
          <Link key={label} href={href} className="flex items-center gap-3 surface-card p-3.5 transition-colors hover:bg-white/[0.05]">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.06]">
              <Icon className="h-5 w-5 text-textSecondary" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-bold">{label}</span>
              <span className="block text-[11px] text-textMuted">{sub}</span>
            </span>
            <ChevronRight className="h-4 w-4 text-textMuted" />
          </Link>
        ))}
      </section>

      {/* Dividends */}
      {data.dividends.length > 0 && (
        <section className="mt-7 px-5 pb-8">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[15px] font-bold tracking-tight">Dividends</h2>
            <span className="text-[12px] text-textSecondary">{usd(divYtd)} received YTD</span>
          </div>
          <div className="space-y-2">
            {data.dividends.map((d) => {
              const asset = bySymbol.get(d.symbol);
              return (
                <div key={d.symbol + d.exDate} className="flex items-center justify-between surface-card px-4 py-3">
                  <div className="flex items-center gap-3">
                    <AssetLogo src={asset ? assetLogoPath(asset) : null} label={d.symbol} size={28} className="shrink-0" />
                    <div>
                      <p className="font-semibold">{d.symbol}</p>
                      <p className="text-[12px] text-textSecondary">ex-date {d.exDate}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">{usd(d.amount)}</p>
                    <Pill tone={d.status === "paid" ? "gain" : "accent"}>{d.status}</Pill>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <SipModal open={sipOpen} onClose={() => setSipOpen(false)} onDone={load} />
    </>
  );
}

function QuickAction({ label, children, onClick }: { label: string; children: React.ReactNode; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="tap app-tile flex flex-col items-center gap-2 py-3.5">
      <span className="app-tile-icon h-11 w-11">{children}</span>
      <span className="text-[12px] font-semibold tracking-tight">{label}</span>
    </button>
  );
}

// Recurring investment (SIP) — INDmoney-style weekly/monthly auto-buy.
function SipModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [symbol, setSymbol] = useState("VOO");
  const [amount, setAmount] = useState("100");
  const [cadence, setCadence] = useState<"weekly" | "monthly">("monthly");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      // First installment executes immediately; the schedule is demo-local.
      const res = await postJSON<{ error?: string }>("/api/investing/order", {
        symbol: symbol.toUpperCase(), side: "buy", notional: Number(amount), type: "market", time_in_force: "day",
      });
      if (!res.ok) throw new Error(res.data.error || "Order rejected");
      setDone(true);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={() => { setDone(false); onClose(); }} title="Recurring investment">
      {done ? (
        <div className="rounded-2xl bg-gain/10 p-4 text-center">
          <p className="font-semibold text-gain">SIP active</p>
          <p className="mt-1 text-[13px] text-textSecondary">
            ${amount} of {symbol.toUpperCase()} every {cadence === "weekly" ? "week" : "month"} — first installment filled.
          </p>
        </div>
      ) : (
        <>
          <label className="mb-1 block text-[12px] text-textSecondary">Symbol</label>
          <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} className="mb-3 w-full rounded-2xl bg-surface px-4 py-3 font-semibold uppercase outline-none" />
          <label className="mb-1 block text-[12px] text-textSecondary">Amount (USD)</label>
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="mb-3 w-full rounded-2xl bg-surface px-4 py-3 text-lg font-semibold outline-none" />
          <div className="mb-4 grid grid-cols-2 gap-2 rounded-pill bg-surface p-1">
            {(["weekly", "monthly"] as const).map((cd) => (
              <button key={cd} onClick={() => setCadence(cd)} className={`rounded-pill py-2 text-sm font-semibold capitalize ${cadence === cd ? "bg-accent" : "text-textSecondary"}`}>
                {cd}
              </button>
            ))}
          </div>
          {error && <div className="mb-3 rounded-2xl bg-loss/15 p-3 text-[13px] text-loss">{error}</div>}
          <button onClick={start} disabled={busy || !(Number(amount) > 0)} className="tap w-full rounded-pill bg-accent py-3.5 font-semibold disabled:opacity-50">
            {busy ? "Starting…" : "Start SIP"}
          </button>
        </>
      )}
    </Modal>
  );
}
