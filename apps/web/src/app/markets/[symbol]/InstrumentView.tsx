"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import PriceChart from "@/components/PriceChart";
import BottomNav from "@/components/BottomNav";
import { assetClassLabel, type MarketInstrument } from "@/lib/markets/instruments";
import type { InstrumentQuote } from "@/lib/markets/instrumentQuote";

// The detail view for an instrument that is not a security: gold, an FX pair,
// an index, a yield.
//
// ── THIS IS THE STOCK PAGE'S SHAPE, ON PURPOSE ─────────────────────────────
//
// An earlier version of this file invented its own layout, and the result read
// as a different product bolted onto the same site: no chart, different type
// scale, different spacing from /markets/DELL two clicks away. The page now
// follows the stock page's structure — the same header, the same price block,
// the same PriceChart, the same card surfaces — and differs only where the
// underlying thing genuinely differs.
//
// What it deliberately does NOT borrow is the trade bar and the position line.
// Those are not styling, they are claims: nothing here is tradable through
// FurlPay, and a Buy button on a COMEX futures quote would be a lie told in
// component form.

/** The same frame the stock page uses: one column, phone width, bottom nav.
 *  Defined locally there too — this mirrors it rather than inventing a shell. */
function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-ambient mx-auto min-h-screen w-full max-w-[440px] pb-32">
      {children}
      <BottomNav />
    </div>
  );
}

const fmt = (n: number | null, currency: string): string => {
  if (n === null) return "—";
  // Gold at 4,416 and the euro at 1.1585 need different precision; take it from
  // magnitude rather than fixing one for everything.
  const dp = Math.abs(n) >= 1000 ? 2 : Math.abs(n) >= 10 ? 3 : 4;
  return `${n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })} ${currency}`;
};

const pct = (n: number | null): string =>
  n === null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

export default function InstrumentView({
  instrument,
  quote,
}: {
  instrument: MarketInstrument;
  quote: InstrumentQuote | null;
}) {
  const router = useRouter();
  const up = (quote?.changePercent ?? 0) >= 0;
  const ccy = quote?.currency ?? instrument.currency;

  // Where the last price sits between the 52-week extremes. Null unless all
  // three exist — a bar drawn from two of them is decoration, not information.
  const lo = quote?.low52w ?? null;
  const hi = quote?.high52w ?? null;
  const p = quote?.price ?? null;
  const rangePct =
    lo !== null && hi !== null && p !== null && hi > lo
      ? Math.min(100, Math.max(0, ((p - lo) / (hi - lo)) * 100))
      : null;

  return (
    <PhoneFrame>
      <header className="flex items-center gap-3 px-5 pb-2 pt-3">
        <button
          aria-label="Back"
          onClick={() => router.back()}
          className="tap flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.05]"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        {/* No AssetLogo: an index and a currency pair have no issuer and so no
            mark. A monogram of the ticker stands in rather than a broken image
            or a blank square where every other page has a logo. */}
        <div className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-[11px] font-bold tracking-tight">
          {instrument.symbol.slice(0, 3)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold tracking-tight">{instrument.symbol}</p>
          <p className="truncate text-[12px] text-textSecondary">
            {instrument.displayName}
            <span className="text-textMuted"> · {assetClassLabel(instrument.assetClass)}</span>
          </p>
        </div>
      </header>

      {/* Price block, matching the stock page's hierarchy: price dominant,
          change beside it, range and volume beneath. */}
      <section className="px-5 pt-3">
        <div className="flex items-baseline gap-3">
          <span className="text-[34px] font-extrabold tabular-nums tracking-tight">
            {quote ? fmt(quote.price, ccy) : "—"}
          </span>
          <span className={`text-[15px] font-semibold tabular-nums ${up ? "text-gain" : "text-loss"}`}>
            {pct(quote?.changePercent ?? null)}
          </span>
        </div>
        <p className="mt-1 text-[12px] text-textSecondary">
          {quote?.exchange ?? instrument.exchange}
          {quote?.timestamp && (
            <> · as of {new Date(quote.timestamp).toUTCString().replace("GMT", "UTC")}</>
          )}
        </p>

        {rangePct !== null && (
          <div className="mt-4">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]">
              <div
                className={`h-full rounded-full ${up ? "bg-gain" : "bg-loss"}`}
                style={{ width: `${rangePct}%` }}
              />
            </div>
            <div className="mt-1.5 flex justify-between text-[11px] text-textMuted tabular-nums">
              <span>{fmt(lo, ccy)}</span>
              <span>52-week range</span>
              <span>{fmt(hi, ccy)}</span>
            </div>
          </div>
        )}
      </section>

      {/* The chart, same component and same card as every other market page.
          allowSynthetic={false} for the same reason it is false there: on a page
          quoting a real instrument, an invented history is the one thing this
          must not draw. Where no source has bars, it says so. */}
      <section className="mt-4 px-5">
        <div className="surface-card p-4">
          <PriceChart
            seed={`instrument-${instrument.symbol}`}
            symbol={instrument.symbol}
            endValue={quote?.price ?? 0}
            height={210}
            defaultTf="1M"
            allowSynthetic={false}
          />
        </div>
      </section>

      {/* What this price actually is. For gold the symbol and the contract we
          can quote are different instruments, and that belongs above the
          statistics rather than in a footnote under them. */}
      {instrument.providerNote && (
        <section className="mt-4 px-5">
          <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.06] p-3.5">
            <p className="text-[12px] leading-relaxed text-textSecondary">
              <span className="font-semibold text-amber-400">What this price is. </span>
              {instrument.providerNote}
              {quote && <> Quoted from <span className="font-mono">{quote.providerSymbol}</span>.</>}
            </p>
          </div>
        </section>
      )}

      <section className="mt-4 px-5">
        <div className="surface-card p-4">
          <h2 className="text-[13px] font-bold">Key statistics</h2>
          <dl className="mt-3 grid grid-cols-2 gap-y-3.5 text-[13px]">
            <Cell label="Previous close" value={quote ? fmt(quote.previousClose, ccy) : "—"} />
            <Cell label="Change" value={quote?.change == null ? "—" : fmt(quote.change, ccy)} />
            <Cell label="Day high" value={quote ? fmt(quote.dayHigh, ccy) : "—"} />
            <Cell label="Day low" value={quote ? fmt(quote.dayLow, ccy) : "—"} />
            <Cell label="52-week high" value={quote ? fmt(quote.high52w, ccy) : "—"} />
            <Cell label="52-week low" value={quote ? fmt(quote.low52w, ccy) : "—"} />
            <Cell
              label="Volume"
              value={
                // "Not reported" and "—" are different statements: one says the
                // instrument has no volume concept, the other that we are
                // missing a number it does have.
                !instrument.volumeSupported
                  ? "Not reported"
                  : quote?.volume == null
                    ? "—"
                    : quote.volume.toLocaleString("en-US")
              }
            />
            <Cell
              label="Market cap"
              value={instrument.marketCapSupported ? (quote?.marketCap?.toLocaleString("en-US") ?? "—") : "Not applicable"}
            />
          </dl>
        </div>
      </section>

      {!quote && (
        <section className="mt-4 px-5">
          <div className="surface-card p-4">
            <p className="text-[12px] leading-relaxed text-textSecondary">
              No quote is available for this instrument right now. The page shows
              an em-dash rather than a price: a zero here would be a claim about
              the market rather than about our data.
            </p>
          </div>
        </section>
      )}

      {/* Provenance, in the same place the stock page puts it. */}
      <section className="mt-4 px-5">
        <div className="surface-card p-4">
          <h2 className="text-[13px] font-bold">Where these numbers come from</h2>
          <dl className="mt-3 space-y-2 text-[12px]">
            <Line label="Price" value={`${quote?.providerSymbol ?? instrument.providerSymbol} · Yahoo Finance (delayed)`} />
            <Line label="Instrument" value={`${assetClassLabel(instrument.assetClass)} · quoted in ${ccy}`} />
            {instrument.baseAsset && instrument.quoteAsset && (
              <Line label="Pair" value={`${instrument.baseAsset} / ${instrument.quoteAsset}`} />
            )}
          </dl>
        </div>
      </section>

      <p className="mt-5 px-5 pb-4 text-[11px] leading-relaxed text-textSecondary/70">
        This instrument is not a security. It has no issuer, no CUSIP and no
        institutional ownership filings, and it is not tradable through FurlPay.
        Prices are for information and are not investment advice.
      </p>
    </PhoneFrame>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-textSecondary">{label}</dt>
      <dd className="mt-0.5 font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-textSecondary">{label}</dt>
      <dd className="text-right font-medium text-textMuted">{value}</dd>
    </div>
  );
}
