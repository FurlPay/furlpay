import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { assetClassLabel, type MarketInstrument } from "@/lib/markets/instruments";
import type { InstrumentQuote } from "@/lib/markets/instrumentQuote";

// The detail view for an instrument that is not a security: gold, an FX pair,
// an index, a yield. Rendered by /markets/[symbol] when the segment resolves to
// the instrument registry rather than to the securities catalog.
//
// Deliberately not the equity page. There is no market cap, no sector, no
// issuer and no trade sheet, because none of those exist for XAUUSD, and
// reusing a layout built around them would leave a row of em-dashes implying
// the data is merely missing rather than inapplicable.

function fmt(n: number | null, currency: string): string {
  if (n === null) return "—";
  // Gold at 4,380 and the euro at 1.1585 need different precision; pick it
  // from magnitude rather than hardcoding one for everything.
  const dp = Math.abs(n) >= 1000 ? 2 : Math.abs(n) >= 10 ? 3 : 4;
  return `${n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })} ${currency}`;
}

const pct = (n: number | null): string =>
  n === null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

export default function InstrumentView({
  instrument,
  quote,
}: {
  instrument: MarketInstrument;
  quote: InstrumentQuote | null;
}) {
  const up = (quote?.changePercent ?? 0) >= 0;

  return (
    <div className="pb-16">
      <header className="flex items-center gap-3 px-5 pb-2 pt-3">
        <Link
          href="/markets"
          aria-label="Back to markets"
          className="tap flex h-10 w-10 items-center justify-center rounded-full bg-white/5"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
      </header>

      <div className="px-5">
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-white/12 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-textSecondary">
            {assetClassLabel(instrument.assetClass)}
          </span>
          {instrument.baseAsset && instrument.quoteAsset && (
            <span className="text-[11px] text-textSecondary">
              {instrument.baseAsset} / {instrument.quoteAsset}
            </span>
          )}
        </div>

        <h1 className="mt-2 text-[26px] font-extrabold tracking-tighter">{instrument.symbol}</h1>
        <p className="mt-0.5 text-[13px] text-textSecondary">{instrument.displayName}</p>

        <div className="mt-5 flex items-baseline gap-3">
          <span className="text-[34px] font-extrabold tabular-nums tracking-tight">
            {quote ? fmt(quote.price, quote.currency) : "—"}
          </span>
          <span className={`text-[15px] font-semibold tabular-nums ${up ? "text-gain" : "text-loss"}`}>
            {pct(quote?.changePercent ?? null)}
          </span>
        </div>
        {quote?.timestamp && (
          <p className="mt-1 text-[11px] text-textSecondary">
            {quote.exchange ?? instrument.exchange} · as of{" "}
            {new Date(quote.timestamp).toUTCString().replace("GMT", "UTC")}
          </p>
        )}
      </div>

      {/* The provider note is the most important thing on this page for gold.
          Our symbol and what the provider serves are not the same instrument,
          and a reader comparing this against a spot quote elsewhere needs to
          know why the numbers differ. */}
      {instrument.providerNote && (
        <div className="mx-5 mt-5 rounded-xl border border-amber-400/30 bg-amber-400/[0.07] p-4">
          <p className="text-[12px] leading-relaxed text-textSecondary">
            <span className="font-semibold text-amber-400">What this price is. </span>
            {instrument.providerNote}
            {quote && (
              <>
                {" "}
                Quoted here from <span className="font-mono">{quote.providerSymbol}</span>.
              </>
            )}
          </p>
        </div>
      )}

      <div className="mx-5 mt-5 rounded-xl border border-white/8 bg-white/[0.03] p-4">
        <dl className="grid grid-cols-2 gap-y-3.5 text-[13px]">
          <Cell label="Previous close" value={quote ? fmt(quote.previousClose, quote.currency) : "—"} />
          <Cell label="Change" value={quote?.change === null || !quote ? "—" : fmt(quote.change, quote.currency)} />
          <Cell label="Day high" value={quote ? fmt(quote.dayHigh, quote.currency) : "—"} />
          <Cell label="Day low" value={quote ? fmt(quote.dayLow, quote.currency) : "—"} />
          <Cell label="52-week high" value={quote ? fmt(quote.high52w, quote.currency) : "—"} />
          <Cell label="52-week low" value={quote ? fmt(quote.low52w, quote.currency) : "—"} />
          <Cell
            label="Volume"
            value={
              // Not supported is different from zero. An FX pair has no volume
              // concept at all, and a 0 would read as "nothing traded".
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

      {!quote && (
        <div className="mx-5 mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <p className="text-[12px] leading-relaxed text-textSecondary">
            No quote is available for this instrument right now. The page shows
            an em-dash rather than a price, because a zero here would be a claim
            about the market rather than about our data.
          </p>
        </div>
      )}

      <p className="mt-7 px-5 text-[11px] leading-relaxed text-textSecondary/70">
        {instrument.assetClass === "fx" || instrument.assetClass === "commodity" || instrument.assetClass === "index"
          ? "This instrument is not a security. It has no issuer, no CUSIP and no institutional ownership filings, and it is not tradable through FurlPay."
          : "Market data only."}{" "}
        Prices are provided for information and are not investment advice.
      </p>
    </div>
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
