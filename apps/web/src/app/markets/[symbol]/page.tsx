"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Sparkles, ArrowLeftRight, FileText } from "lucide-react";
import { getJSON, postJSON } from "@/lib/api";
import { Spinner, usd } from "@/components/ui";
import { AssetLogo } from "@furlpay/ui";
import PriceChart from "@/components/PriceChart";
import AssetRow from "@/components/AssetRow";
import SignalBadge from "@/components/insights/SignalBadge";
import Modal from "@/components/Modal";
import StockHeader from "@/components/markets/StockHeader";
import StockDesktop from "@/components/markets/StockDesktop";
import BottomNav from "@/components/BottomNav";
import { useMediaQuery, DESKTOP_QUERY } from "@/lib/useMediaQuery";
import KeyStatsGrid from "@/components/markets/KeyStatsGrid";
import Provenance from "@/components/markets/Provenance";
import type { SymbolDetail } from "@/components/markets/types";

// Asset detail — full quote, real OHLC chart, key statistics, provenance,
// position, related research and one-tap trading (equities) / swap routing
// (crypto).
//
// The response shape lives in components/markets/types.ts. It is imported
// rather than redeclared here because the copy that used to live in this file
// had drifted from the route: it declared statistics non-nullable that the
// route returns as null, and still declared `circulatingSupply` and `athPrice`
// after the route stopped sending them. Both arrived undefined, both were
// coalesced to 0, and the page printed a $0.00 all-time high for every coin.

/**
 * The phone column, supplied by this page rather than by Shell.
 *
 * Ticker pages opt out of the global app frame (see lib/shellRoutes.ts) so the
 * desktop layout can use the full viewport. That opt-out is all-or-nothing, so
 * below `lg` the page re-creates what it gave up: the 440px column, the red
 * ambient wash and the floating tab bar.
 */
function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-ambient mx-auto min-h-screen w-full max-w-[440px] pb-32">
      {children}
      <BottomNav />
    </div>
  );
}

export default function AssetDetailPage() {
  const { symbol } = useParams<{ symbol: string }>();
  const router = useRouter();
  // One tree, not two. Rendering both and hiding one with `lg:hidden` would
  // mount two PriceCharts — two chart canvases, two OHLC fetches — to show one.
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const [data, setData] = useState<SymbolDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [trade, setTrade] = useState<"buy" | "sell" | null>(null);

  const load = useCallback(() => {
    getJSON<SymbolDetail>(`/api/markets/${symbol}`)
      .then(setData)
      .catch(() => setMissing(true));
  }, [symbol]);
  useEffect(() => load(), [load]);

  // Loading and not-found commit to NEITHER layout.
  //
  // The media query only resolves after mount, so a phone-framed spinner would
  // render on a desktop too — 440px column, floating tab bar and all — and then
  // snap to the full-width terminal the moment the quote landed. Centring on
  // the shared ambient ground is correct at every width and reflows into
  // neither layout.
  if (missing) {
    return (
      <div className="app-ambient flex min-h-screen flex-col items-center justify-center px-5 text-center">
        <p className="font-semibold">Asset not found</p>
        <p className="mt-1 text-[13px] text-textSecondary">
          No exchange lists {String(symbol).toUpperCase()}.
        </p>
        <Link href="/markets" className="mt-3 text-[13px] text-accent hover:underline">
          Back to markets
        </Link>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="app-ambient flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const { asset, quote, stats, position } = data;
  const isEquity = asset.kind !== "crypto";
  // Everything above the trade bar is published market data and renders for
  // anyone. Only the actions below need a session.
  const signInHref = `/login?next=${encodeURIComponent(`/markets/${asset.symbol}`)}`;

  if (isDesktop) {
    return (
      <>
        <StockDesktop
          data={data}
          signInHref={signInHref}
          onBuy={() => setTrade("buy")}
          onSell={() => setTrade("sell")}
        />
        {trade && quote.price !== null && (
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

  return (
    <PhoneFrame>
      {/* Header */}
      <header className="flex items-center gap-3 px-5 pb-2 pt-3">
        <button aria-label="Back" onClick={() => router.back()} className="tap flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.05]">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <AssetLogo src={asset.logo} label={asset.symbol} size={34} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold tracking-tight">{asset.symbol}</p>
          {/* Sector for a curated asset, listing venue for the rest. The
              uncurated majority have no sector at all, and a blank line under
              the name reads as a page that failed to load rather than one
              that simply has less to say. */}
          <p className="truncate text-[12px] text-textSecondary">
            {asset.name}
            {(asset.sector ?? asset.exchange) && (
              <span className="text-textMuted"> · {asset.sector ?? asset.exchange}</span>
            )}
          </p>
        </div>
      </header>

      {/* Price, ranges, volume */}
      <StockHeader price={quote.price} changePct={quote.changePct} stats={stats} />


      {/* Chart. allowSynthetic={false}: on a page that quotes a real ticker,
          an invented price history is the one thing this chart must not draw.
          Where no source has bars, it says so. */}
      <section className="mt-4 px-5">
        <div className="surface-card p-4">
          <PriceChart
            seed={`asset-${asset.symbol}`}
            symbol={asset.symbol}
            // Seeds the synthetic series only, and that path is disabled
            // below — no invented history is drawn from this number.
            endValue={quote.price ?? 0}
            height={210}
            defaultTf="1M"
            allowSynthetic={false}
          />
        </div>
      </section>

      {/* Trade bar */}
      <section className="mt-4 px-5">
        {!data.authenticated ? (
          // An anonymous reader gets the invitation, not a button that opens a
          // sheet and fails on POST. The `next` param returns them to this
          // exact symbol rather than the dashboard.
          <Link
            href={signInHref}
            className="tap flex items-center justify-center gap-2 rounded-pill bg-accent py-3 font-semibold"
          >
            Sign in to trade {asset.symbol}
          </Link>
        ) : isEquity ? (
          <div className="grid grid-cols-2 gap-2">
            {/* An order is sized against the price. With no quote there is
                nothing to size against, so the sheet cannot be opened rather
                than opening against a zero. */}
            <button
              onClick={() => setTrade("buy")}
              disabled={quote.price === null}
              className="tap rounded-pill bg-accent py-3 font-semibold disabled:opacity-40"
            >
              Buy
            </button>
            <button
              onClick={() => setTrade("sell")}
              disabled={!position?.shares || quote.price === null}
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
        {!data.authenticated && (
          <p className="mt-2.5 text-center text-[12px] text-textMuted">
            Prices, statistics and filings above are public.
          </p>
        )}
        {position && position.shares > 0 && (
          <div className="mt-2.5 flex items-center justify-between surface-card px-4 py-3">
            <div>
              <p className="text-[12px] text-textSecondary">Your position</p>
              <p className="font-semibold">{position.shares.toFixed(4)} shares</p>
            </div>
            <p className="font-semibold">
              {position.marketValue === null ? "—" : usd(position.marketValue)}
            </p>
          </div>
        )}
      </section>

      {/* Furl AI digest. The route omits it when the 52-week range it narrates
          is unknown, so the whole card is conditional — a digest that has lost
          its numbers would still read like a confident summary. */}
      {data.digest && (
        <section className="mt-5 px-5">
          <div className="rounded-2xl border border-white/[0.07] bg-gradient-to-br from-white/[0.05] to-transparent p-4">
            <p className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wider text-accent">
              <Sparkles className="h-3.5 w-3.5" /> Furl AI digest
            </p>
            <p className="mt-2 text-[13.5px] leading-relaxed text-textSecondary">{data.digest}</p>
            <p className="mt-2 text-[10px] text-textMuted">AI-generated summary. Not investment advice.</p>
          </div>
        </section>
      )}

      {/* Key stats */}
      <section className="mt-6 px-5">
        <h2 className="mb-2 text-[15px] font-bold tracking-tight">Key stats</h2>
        <KeyStatsGrid stats={stats} kind={asset.kind} />
      </section>

      {/* Attribution for everything above. */}
      <section className="mt-5 px-5">
        <Provenance data={data.provenance} />
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

      {trade && quote.price !== null && (
        <TradeSheet
          symbol={asset.symbol}
          price={quote.price}
          side={trade}
          maxShares={position?.shares ?? 0}
          onClose={() => setTrade(null)}
          onDone={load}
        />
      )}
    </PhoneFrame>
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
