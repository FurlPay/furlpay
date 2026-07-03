"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Sparkles, ArrowLeftRight, FileText } from "lucide-react";
import { getJSON, postJSON } from "@/lib/api";
import { Spinner, pct, usd } from "@/components/ui";
import { AssetLogo } from "@furlpay/ui";
import PriceChart from "@/components/PriceChart";
import StatsGrid, { fmtCompact, StatItem } from "@/components/StatsGrid";
import AssetRow, { fmtPrice } from "@/components/AssetRow";
import SignalBadge from "@/components/insights/SignalBadge";
import Modal from "@/components/Modal";

// Asset detail — full quote, chart, Furl AI digest, key stats, position,
// related research and one-tap trading (equities) / swap routing (crypto).

interface Detail {
  asset: {
    symbol: string;
    name: string;
    kind: "stock" | "etf" | "crypto";
    sector: string | null;
    industry: string | null;
    cap: string;
    chain: string | null;
    logo: string | null;
  };
  quote: { price: number; changePct: number; live: boolean };
  stats: {
    marketCap: number;
    peRatio: number | null;
    eps: number | null;
    dividendYieldPct: number | null;
    beta: number | null;
    high52w: number;
    low52w: number;
    volume: number;
    avgVolume: number;
    circulatingSupply: number | null;
    athPrice: number | null;
  };
  digest: string;
  position: { shares: number; marketValue: number } | null;
  related: { symbol: string; name: string; logo: string | null; price: number; changePct: number }[];
  insights: { slug: string; title: string; category: string; date: string; readMins: number; signal: "bullish" | "bearish" | "neutral" | null }[];
}

export default function AssetDetailPage() {
  const { symbol } = useParams<{ symbol: string }>();
  const router = useRouter();
  const [data, setData] = useState<Detail | null>(null);
  const [missing, setMissing] = useState(false);
  const [trade, setTrade] = useState<"buy" | "sell" | null>(null);

  const load = useCallback(() => {
    getJSON<Detail>(`/api/markets/${symbol}`)
      .then(setData)
      .catch(() => setMissing(true));
  }, [symbol]);
  useEffect(() => load(), [load]);

  if (missing) {
    return (
      <div className="px-5 py-16 text-center">
        <p className="font-semibold">Asset not found</p>
        <Link href="/markets" className="mt-2 inline-block text-[13px] text-accent">Back to markets</Link>
      </div>
    );
  }
  if (!data) return <Spinner />;

  const { asset, quote, stats, position } = data;
  const up = quote.changePct >= 0;
  const isEquity = asset.kind !== "crypto";

  const statItems: StatItem[] = [
    { label: "Market cap", value: "$" + fmtCompact(stats.marketCap) },
    { label: "Volume (24h)", value: fmtCompact(stats.volume) },
    { label: "52-wk high", value: fmtPrice(stats.high52w) },
    { label: "52-wk low", value: fmtPrice(stats.low52w) },
    ...(isEquity
      ? ([
          { label: "P/E ratio", value: stats.peRatio ? String(stats.peRatio) : "—" },
          { label: "EPS", value: stats.eps ? `$${stats.eps}` : "—" },
          { label: "Dividend yield", value: stats.dividendYieldPct ? `${stats.dividendYieldPct}%` : "—" },
          { label: "Beta", value: stats.beta ? String(stats.beta) : "—" },
        ] as StatItem[])
      : ([
          { label: "Circulating supply", value: fmtCompact(stats.circulatingSupply ?? 0) },
          { label: "All-time high", value: fmtPrice(stats.athPrice ?? 0) },
          { label: "Network", value: asset.chain === "own" ? "Native L1" : asset.chain ? asset.chain[0].toUpperCase() + asset.chain.slice(1) : "—" },
          { label: "Category", value: asset.industry ?? "—" },
        ] as StatItem[])),
  ];

  return (
    <>
      {/* Header */}
      <header className="flex items-center gap-3 px-5 pb-2 pt-3">
        <button aria-label="Back" onClick={() => router.back()} className="tap flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.05]">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <AssetLogo src={asset.logo} label={asset.symbol} size={34} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold tracking-tight">{asset.symbol}</p>
          <p className="truncate text-[12px] text-textSecondary">{asset.name}</p>
        </div>
        {quote.live && (
          <span className="flex items-center gap-1 rounded-full bg-gain/10 px-2 py-0.5 text-[10px] font-semibold text-gain">
            <span className="h-1 w-1 animate-pulse rounded-full bg-gain" /> LIVE
          </span>
        )}
      </header>

      {/* Price */}
      <section className="px-5">
        <p className="text-[34px] font-extrabold leading-none tracking-tighter">{fmtPrice(quote.price)}</p>
        <p className={`mt-1 text-[14px] font-semibold ${up ? "text-gain" : "text-loss"}`}>
          {pct(quote.changePct)} today
        </p>
      </section>

      {/* Chart */}
      <section className="mt-4 px-5">
        <div className="surface-card p-4">
          <PriceChart seed={`asset-${asset.symbol}`} endValue={quote.price} height={210} defaultTf="1M" />
        </div>
      </section>

      {/* Trade bar */}
      <section className="mt-4 px-5">
        {isEquity ? (
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setTrade("buy")} className="tap rounded-pill bg-accent py-3 font-semibold">
              Buy
            </button>
            <button
              onClick={() => setTrade("sell")}
              disabled={!position?.shares}
              className="tap rounded-pill bg-white/[0.08] py-3 font-semibold disabled:opacity-40"
            >
              Sell
            </button>
          </div>
        ) : (
          <Link href="/dashboard" className="tap flex items-center justify-center gap-2 rounded-pill bg-accent py-3 font-semibold">
            <ArrowLeftRight className="h-4 w-4" /> Trade via stablecoin swap
          </Link>
        )}
        {position && position.shares > 0 && (
          <div className="mt-2.5 flex items-center justify-between surface-card px-4 py-3">
            <div>
              <p className="text-[12px] text-textSecondary">Your position</p>
              <p className="font-semibold">{position.shares.toFixed(4)} shares</p>
            </div>
            <p className="font-semibold">{usd(position.marketValue)}</p>
          </div>
        )}
      </section>

      {/* Furl AI digest */}
      <section className="mt-5 px-5">
        <div className="rounded-2xl border border-white/[0.07] bg-gradient-to-br from-white/[0.05] to-transparent p-4">
          <p className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wider text-accent">
            <Sparkles className="h-3.5 w-3.5" /> Furl AI digest
          </p>
          <p className="mt-2 text-[13.5px] leading-relaxed text-textSecondary">{data.digest}</p>
          <p className="mt-2 text-[10px] text-textMuted">AI-generated summary. Not investment advice.</p>
        </div>
      </section>

      {/* Key stats */}
      <section className="mt-6 px-5">
        <h2 className="mb-1 text-[15px] font-bold tracking-tight">Key stats</h2>
        <StatsGrid items={statItems} />
      </section>

      {/* Research insights */}
      {data.insights.length > 0 && (
        <section className="mt-6 px-5">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[15px] font-bold tracking-tight">FurlPay Research</h2>
            <Link href="/investing/insights" className="text-[12px] font-semibold text-accent">All insights →</Link>
          </div>
          <div className="space-y-2">
            {data.insights.map((i) => (
              <Link key={i.slug} href={`/investing/insights/${i.slug}`} className="flex items-center gap-3 surface-card px-4 py-3">
                <FileText className="h-4 w-4 shrink-0 text-textMuted" />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-[13px] font-semibold leading-snug">{i.title}</p>
                  <p className="mt-0.5 text-[11px] text-textMuted">{i.readMins} min read</p>
                </div>
                {i.signal && <SignalBadge signal={i.signal} compact />}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Related assets */}
      {data.related.length > 0 && (
        <section className="mt-6 px-2 pb-8">
          <h2 className="mb-1 px-3 text-[15px] font-bold tracking-tight">Related</h2>
          {data.related.map((r) => (
            <AssetRow key={r.symbol} item={r} href={`/markets/${r.symbol}`} size="sm" sparkline={false} />
          ))}
        </section>
      )}

      {trade && (
        <TradeSheet
          symbol={asset.symbol}
          price={quote.price}
          side={trade}
          maxShares={position?.shares ?? 0}
          onClose={() => setTrade(null)}
          onDone={load}
        />
      )}
    </>
  );
}

function TradeSheet({
  symbol,
  price,
  side,
  maxShares,
  onClose,
  onDone,
}: {
  symbol: string;
  price: number;
  side: "buy" | "sell";
  maxShares: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState("100");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await postJSON<{ error?: string }>("/api/investing/order", {
        symbol,
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
    <Modal open title={`${side === "buy" ? "Buy" : "Sell"} ${symbol} · ${usd(price)}`} onClose={onClose}>
      {placed ? (
        <div className="rounded-2xl bg-gain/10 p-4 text-center">
          <p className="font-semibold text-gain">Order filled</p>
          <p className="mt-1 text-[13px] text-textSecondary">
            {side === "buy" ? "Bought" : "Sold"} {usd(Number(amount))} of {symbol}
          </p>
          <button onClick={onClose} className="tap mt-4 w-full rounded-pill bg-accent py-3 font-semibold">Done</button>
        </div>
      ) : (
        <>
          <label className="mb-1 block text-[12px] text-textSecondary">Amount (USD)</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            autoFocus
            className="mb-2 w-full rounded-2xl bg-surface px-4 py-3 text-lg font-semibold outline-none"
          />
          <p className="mb-4 text-[13px] text-textSecondary">
            ≈ {(Number(amount) / price).toFixed(4)} shares
            {side === "sell" && maxShares > 0 && ` · you hold ${maxShares.toFixed(4)}`}
          </p>
          {error && <div className="mb-3 rounded-2xl bg-loss/15 p-3 text-[13px] text-loss">{error}</div>}
          <button onClick={submit} disabled={busy || !(Number(amount) > 0)} className="tap w-full rounded-pill bg-accent py-3.5 font-semibold capitalize disabled:opacity-50">
            {busy ? "Placing…" : `${side} ${symbol}`}
          </button>
        </>
      )}
    </Modal>
  );
}
