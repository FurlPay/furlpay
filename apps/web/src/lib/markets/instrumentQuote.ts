// ---------------------------------------------------------------------------
// One normalized quote shape for every asset class.
//
// The rule this file exists to enforce: a field that does not apply to an
// instrument is null, and null is different from zero. FX pairs have no volume,
// so EURUSD returns volume null — not 0, which on a markets surface reads as
// "nothing traded today". Nothing here has a market cap except an equity or a
// coin, and neither is computed in this file.
//
// The provider symbol is resolved by `instruments.ts` and used only here.
// ---------------------------------------------------------------------------

import { cachedJson, TTL, BROWSER_UA } from "./providers/cache";
import type { MarketInstrument, MarketAssetClass } from "./instruments";

const CHART = "https://query1.finance.yahoo.com/v8/finance/chart";

/**
 * The requested range decides what "previous close" MEANS.
 *
 * `chartPreviousClose` is the close before the start of the requested window,
 * not yesterday's close. Asking for a year and reading that field gives the
 * price twelve months ago, so a "daily change" computed from it is an annual
 * return wearing a daily label — NVIDIA at +24.84% instead of +2.06%, the S&P
 * at +18.13% instead of -0.60%. Both look like plausible numbers, which is
 * exactly what makes the error survive review.
 *
 * Five days is the shortest window that reliably contains a prior session
 * across weekends and holidays, and the 52-week high and low arrive in the
 * metadata regardless of range, so nothing is lost by not asking for a year.
 */
const RANGE = "5d";

export interface InstrumentQuote {
  symbol: string;
  assetClass: MarketAssetClass;
  displayName: string;
  price: number | null;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  /** Null when the instrument has no volume series — not zero. */
  volume: number | null;
  /** Never computed here. Null for everything this layer serves. */
  marketCap: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  high52w: number | null;
  low52w: number | null;
  currency: string;
  exchange: string | null;
  /** Exchange timestamp of the quote, ISO. Null when the provider omits it. */
  timestamp: string | null;
  /** Carried through so a reader can see when our symbol and the provider's
   *  instrument are not the same thing — gold priced from a future, for one. */
  providerNote: string | null;
  /** What actually answered, for attribution. */
  providerSymbol: string;
}

interface ChartMeta {
  regularMarketPrice?: number;
  chartPreviousClose?: number;
  previousClose?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  regularMarketVolume?: number;
  currency?: string;
  fullExchangeName?: string;
  exchangeName?: string;
  regularMarketTime?: number;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * Fetch and normalize a quote for any instrument class.
 *
 * Returns null on a provider failure rather than a zeroed quote. A section that
 * cannot price its instrument should render an em-dash; it should not render a
 * price of zero, which is a claim.
 */
export async function instrumentQuote(
  inst: MarketInstrument
): Promise<InstrumentQuote | null> {
  // A perpetual cannot be priced from the chart provider below: it has no
  // symbol there, and its defining fields — mark price, index price, funding —
  // have no equivalent in that response. Dispatched on the instrument's own
  // declared source rather than guessed from the asset class, because two of
  // these perps are commodity-class and the rest are crypto.
  if (inst.quoteSource === "binance-perp") return perpInstrumentQuote(inst);

  const data = await cachedJson<ChartMeta>(
    `inst:v1:${inst.providerSymbol}`,
    TTL.quote,
    async () => {
      try {
        const res = await fetch(
          `${CHART}/${encodeURIComponent(inst.providerSymbol)}?range=${RANGE}&interval=1d`,
          { headers: BROWSER_UA, signal: AbortSignal.timeout(8_000), cache: "no-store" }
        );
        if (!res.ok) return null;
        const j = (await res.json()) as {
          chart?: { result?: { meta?: ChartMeta }[] };
        };
        return j.chart?.result?.[0]?.meta ?? null;
      } catch {
        return null;
      }
    }
  );
  if (!data) return null;

  const price = num(data.regularMarketPrice);
  // Correct only because RANGE is short. See the note on RANGE.
  const prev = num(data.chartPreviousClose) ?? num(data.previousClose);
  const change = price !== null && prev !== null ? price - prev : null;

  return {
    symbol: inst.symbol,
    assetClass: inst.assetClass,
    displayName: inst.displayName,
    price,
    previousClose: prev,
    change,
    // A percentage needs a non-zero base. Dividing by a zero prior close
    // produces Infinity, which renders as a very confident nonsense.
    changePercent:
      change !== null && prev !== null && prev !== 0 ? (change / prev) * 100 : null,
    // The flag decides, not the payload: the provider sometimes returns 0 for
    // an instrument that has no volume concept at all, and 0 is a claim.
    volume: inst.volumeSupported ? num(data.regularMarketVolume) : null,
    // Nothing in this layer computes a market cap. An equity's comes from a
    // filed share count and a coin's from circulating supply, both elsewhere.
    marketCap: null,
    dayHigh: num(data.regularMarketDayHigh),
    dayLow: num(data.regularMarketDayLow),
    high52w: num(data.fiftyTwoWeekHigh),
    low52w: num(data.fiftyTwoWeekLow),
    currency: data.currency ?? inst.currency,
    exchange: data.fullExchangeName ?? data.exchangeName ?? inst.exchange ?? null,
    timestamp:
      typeof data.regularMarketTime === "number"
        ? new Date(data.regularMarketTime * 1000).toISOString()
        : null,
    providerNote: inst.providerNote ?? null,
    providerSymbol: inst.providerSymbol,
  };
}

// ---------------------------------------------------------------------------
// Perpetual futures, from Binance.
//
// Kept at the bottom rather than inline so the chart-provider path above reads
// unchanged. The mapping is deliberately lossy in one direction: an
// InstrumentQuote has no field for a funding rate or a mark price, and this
// adapter does NOT invent one. Those live on /api/markets/perps, which serves
// the full contract shape; this exists so /markets/[symbol] can render a perp
// with the same header, chart and statistics as every other instrument.
//
// `high52w` / `low52w` are null, not the 24h values. A 24-hour high is not a
// 52-week high, and copying one into the other would put a wrong number under
// a correct label — the single easiest way to make a market page lie.
// ---------------------------------------------------------------------------

import { getPerpQuotes } from "@/lib/markets/perps/binance";

async function perpInstrumentQuote(inst: MarketInstrument): Promise<InstrumentQuote | null> {
  const [q] = await getPerpQuotes([inst.providerSymbol]);
  // No quote means the contract could not be priced. Null, never a zeroed row.
  if (!q) return null;

  // The provider gives a percentage; the absolute change is derived from it
  // rather than from a separate field, so the two can never disagree.
  const previousClose = q.changePct !== 0 ? q.price / (1 + q.changePct / 100) : q.price;
  const change = q.price - previousClose;

  return {
    symbol: inst.symbol,
    assetClass: inst.assetClass,
    displayName: inst.displayName,
    price: q.price,
    previousClose,
    change,
    changePercent: q.changePct,
    // Quote volume (USDT) rather than base volume: it is the figure the
    // exchange screen shows and the only one comparable across contracts
    // priced eight orders of magnitude apart.
    volume: q.quoteVolume24h,
    marketCap: null,
    dayHigh: q.high24h,
    dayLow: q.low24h,
    high52w: null,
    low52w: null,
    currency: inst.currency,
    exchange: inst.exchange ?? "Binance Futures",
    timestamp: new Date().toISOString(),
    providerNote: inst.providerNote ?? null,
    providerSymbol: q.symbol,
  };
}
