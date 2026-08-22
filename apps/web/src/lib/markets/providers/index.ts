// ---------------------------------------------------------------------------
// Provider aggregation: one real snapshot of a symbol.
//
// What this replaces matters more than what it adds. `keyStatsFor` in
// ../stats.ts derives every "statistic" from a hash of the ticker string:
//
//     const u = (salt) => unit(a.symbol + ":" + salt);
//     peRatio = (growthSector ? 24 : 10) + (...) * u("pe");
//
// so the P/E shown for AAPL was a function of the letters A-A-P-L, the
// 52-week range was the current price times a hashed multiplier, and market
// cap was a draw inside the cap tier. Stable across reloads, plausible on
// screen, and unrelated to the company. On a surface where people size
// positions, that is the worst kind of wrong: confident and unfalsifiable.
//
// Everything here is either fetched or arithmetic over fetched inputs. A value
// that cannot be computed is null, and null must render as an em-dash. There is
// no branch in this file that invents a number.
// ---------------------------------------------------------------------------

import { cryptoStatsFor, type CryptoStats } from "./coingecko";
import { fundamentalsFor, type Fundamentals } from "./sec";
import { averageVolume, bars, quote as yahooQuote, type YahooQuote } from "./yahoo";

/** Where a snapshot's numbers came from, so the UI can attribute them and a
 * reader can tell a filed figure from a derived one. */
export interface Provenance {
  price: "yahoo" | null;
  fundamentals: "sec-edgar" | null;
  /** Supply and market cap for a coin, which has no filings to read. */
  crypto: "coingecko" | null;
  /** Period end the filed figures cover, e.g. "2025-09-27". */
  fiscalAsOf: string | null;
  /** Whether income figures are a true trailing twelve months or a fiscal year. */
  incomeBasis: "ttm" | "annual" | null;
  /** SEC CIK, for a direct link to the filings behind the numbers. */
  cik: string | null;
}

export interface RealStats {
  // --- market ---
  price: number | null;
  previousClose: number | null;
  change: number | null;
  changePct: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  high52w: number | null;
  low52w: number | null;
  volume: number | null;
  avgVolume: number | null;
  marketTime: number | null;
  currency: string | null;
  exchange: string | null;
  name: string | null;

  // --- size ---
  marketCap: number | null;
  enterpriseValue: number | null;
  sharesOutstanding: number | null;

  // --- valuation ---
  peRatio: number | null;
  priceToSales: number | null;
  priceToBook: number | null;
  epsTtm: number | null;

  // --- profitability ---
  revenueTtm: number | null;
  netIncomeTtm: number | null;
  grossMarginPct: number | null;
  operatingMarginPct: number | null;
  profitMarginPct: number | null;
  roePct: number | null;
  roaPct: number | null;
  /** Against SPY, one year of daily returns. Null for crypto. */
  beta: number | null;

  // --- crypto supply (null for equities, which report shares instead) ---
  circulatingSupply: number | null;
  totalSupply: number | null;
  maxSupply: number | null;
  fullyDilutedValuation: number | null;
  athPrice: number | null;
  athDate: string | null;
  atlPrice: number | null;
  atlDate: string | null;
  marketCapRank: number | null;

  // --- balance sheet ---
  currentRatio: number | null;
  debtToEquity: number | null;
  cash: number | null;
  totalAssets: number | null;
  totalLiabilities: number | null;

  // --- income ---
  dividendPerShareTtm: number | null;
  dividendYieldPct: number | null;
  payoutRatioPct: number | null;

  provenance: Provenance;
}

/** How this symbol is spelled on Yahoo.
 *
 * Alpaca and Yahoo disagree about punctuation, and every disagreement is a
 * silent 404 rather than an error — the page renders with an em-dash where the
 * price should be, which looks like an asset that does not trade.
 *
 * - Crypto is quoted as a pair. A bare BTC resolves to an unrelated equity or
 *   to nothing at all; BTC-USD is the coin.
 * - Share classes use a dash: BRK.B is not a symbol Yahoo knows, BRK-B is.
 * - Preferred series, warrants and units each have their own spelling, and the
 *   plain dot-to-dash rewrite gets all three wrong. `ALL.PRB` becomes
 *   `ALL-PRB`, which does not exist; the security is `ALL-PB`. That pattern
 *   covers 368 preferred series, 66 warrants and 49 units in the tradable
 *   universe — every one of them previously priceless and chartless.
 *
 * Rights (`.RT`, 16 symbols) are deliberately not mapped. They are short-lived
 * instruments and no Yahoo spelling was found that resolves them, so they fall
 * through to the generic rewrite and miss honestly. */
export function yahooSymbolFor(symbol: string, kind: string): string {
  const upper = symbol.toUpperCase();
  if (kind === "crypto") return `${upper}-USD`;

  // Preferred series: ABR.PRD -> ABR-PD. The series letter is optional, since
  // a single-series issuer tags it plain `.PR`.
  const preferred = /^(.+)\.PR([A-Z]?)$/.exec(upper);
  if (preferred) return `${preferred[1]}-P${preferred[2]}`;

  // Warrants: AMPX.WS and AMPX.WSA both quote as AMPX-WT.
  const warrant = /^(.+)\.WS[A-Z]?$/.exec(upper);
  if (warrant) return `${warrant[1]}-WT`;

  // SPAC units: ALUB.U -> ALUB-UN.
  const unit = /^(.+)\.U$/.exec(upper);
  if (unit) return `${unit[1]}-UN`;

  return upper.replace(/\./g, "-");
}

/** Beta against SPY from one year of daily returns.
 *
 * This is the only headline statistic neither provider publishes, and it is the
 * one the old code faked most confidently (`0.55 + 1.3 * hash(symbol)`). It is
 * however ordinary arithmetic over data we already fetch, so it is computed
 * rather than either invented or dropped:
 *
 *     beta = cov(stock daily returns, SPY daily returns) / var(SPY)
 *
 * Dates are intersected before pairing. Returning bars from two symbols and
 * zipping them by index silently misaligns the series whenever one had a halt
 * or a listing gap, and a misaligned beta is not obviously wrong on screen.
 *
 * SPY stands in for the market portfolio. That is the usual convention for a
 * US-listed name and wrong for anything else, so this is only requested for
 * equities and ETFs. */
async function betaVsMarket(symbol: string): Promise<number | null> {
  if (symbol.toUpperCase() === "SPY") return 1;

  const [self, spy] = await Promise.all([
    bars(symbol, "1Y").catch(() => null),
    bars("SPY", "1Y").catch(() => null),
  ]);
  if (!self?.length || !spy?.length) return null;

  // Bucket by UTC day so the two series pair on date, not on position.
  const day = (t: number) => Math.floor(t / 86_400);
  const spyByDay = new Map(spy.map((b) => [day(b.t), b.c]));

  const pairs: Array<[number, number]> = [];
  for (const b of self) {
    const m = spyByDay.get(day(b.t));
    if (m !== undefined) pairs.push([b.c, m]);
  }
  if (pairs.length < 60) return null; // too short a history to mean anything

  const rSelf: number[] = [];
  const rMkt: number[] = [];
  for (let i = 1; i < pairs.length; i++) {
    const [c0, m0] = pairs[i - 1]!;
    const [c1, m1] = pairs[i]!;
    if (c0 <= 0 || m0 <= 0) continue;
    rSelf.push(c1 / c0 - 1);
    rMkt.push(m1 / m0 - 1);
  }
  if (rMkt.length < 60) return null;

  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const mSelf = mean(rSelf);
  const mMkt = mean(rMkt);

  let cov = 0;
  let varMkt = 0;
  for (let i = 0; i < rMkt.length; i++) {
    cov += (rSelf[i]! - mSelf) * (rMkt[i]! - mMkt);
    varMkt += (rMkt[i]! - mMkt) ** 2;
  }
  if (varMkt <= 0) return null;
  return cov / varMkt;
}

/** Divide, but only when the result would mean something.
 *
 * Guards three separate ways a ratio goes wrong: a missing input, a zero
 * denominator, and a negative denominator. The last one is the subtle case —
 * P/E against negative earnings produces a negative "ratio" that sorts and
 * renders like a very cheap stock, when the company is in fact losing money.
 * Loss-makers have no P/E, and null says exactly that. */
function ratio(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null) return null;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator <= 0) return null;
  const r = numerator / denominator;
  return Number.isFinite(r) ? r : null;
}

/** Percentage form of a ratio, where a negative numerator is meaningful.
 *
 * Margins and returns differ from valuation multiples: a negative net margin is
 * a real, reportable fact about a loss-making quarter, so only the denominator
 * is sign-checked. */
function pct(numerator: number | null, denominator: number | null): number | null {
  const r = ratio(numerator, denominator);
  return r === null ? null : r * 100;
}

/** A margin: a share of revenue, so it cannot exceed all of it.
 *
 * The ceiling is a backstop against inputs that came from different places
 * without either of them looking wrong on its own. American Tower tags
 * revenue-from-contracts at $0.94B and total revenues at $10.64B for the same
 * year; dividing a company-wide operating income by the first produced a 522%
 * operating margin, and both numbers were real, filed, and current.
 *
 * `sec.ts` now picks the broader tag, so this should not fire. It is kept
 * because the failure it catches is silent — a margin over 100% is arithmetic
 * nonsense that renders as an impressive statistic — and because the next
 * filer to nest its revenue tags differently will not announce itself.
 *
 * Losses have no such floor: a pre-revenue company really can post a margin of
 * several hundred percent negative, and that is a fact about the company. */
function marginPct(numerator: number | null, denominator: number | null): number | null {
  const p = pct(numerator, denominator);
  if (p === null) return null;
  return p > 100.5 ? null : p;
}

/** Combine live price with filed fundamentals into one snapshot.
 *
 * The two halves are fetched concurrently and independently: SEC has nothing to
 * say about an ETF or a coin, and Yahoo occasionally drops a symbol. Either
 * side returning null degrades the sections that depend on it and leaves the
 * rest intact. */
export async function realStatsFor(
  symbol: string,
  kind: "stock" | "etf" | "crypto" = "stock",
  /** CoinGecko id from the catalog. Required to resolve a coin's supply —
   * CoinGecko is keyed by slug, and a ticker alone is ambiguous across the
   * several thousand coins that share one. */
  cgId?: string | null
): Promise<RealStats> {
  const y = yahooSymbolFor(symbol, kind);
  const isCrypto = kind === "crypto";

  // A coin has no filings and no meaningful beta against SPY, and asking EDGAR
  // for a crypto ticker resolves against whichever registrant happens to share
  // the letters. Price, range and volume still apply, so those are fetched —
  // and supply comes from CoinGecko, which is the coin equivalent of the share
  // count on a cover page.
  const [q, fRaw, avgVol, beta, crypto] = await Promise.all([
    yahooQuote(y).catch(() => null),
    isCrypto ? Promise.resolve(null) : fundamentalsFor(symbol).catch(() => null),
    averageVolume(y).catch(() => null),
    isCrypto ? Promise.resolve(null) : betaVsMarket(y).catch(() => null),
    isCrypto && cgId ? cryptoStatsFor(cgId).catch(() => null) : Promise.resolve(null),
  ]);
  return combine(q, fRaw, avgVol, beta, crypto);
}

function combine(
  q: YahooQuote | null,
  f: Fundamentals | null,
  avgVol: number | null,
  beta: number | null = null,
  crypto: CryptoStats | null = null
): RealStats {
  const price = q?.price ?? null;

  // Market cap is computed, not fetched: shares outstanding come from the
  // cover page of the latest filing and the price from the tape. That makes it
  // as current as the share count, which moves on buybacks and issuance — so
  // the filing date travels with it in `provenance`.
  const marketCap =
    price !== null && f?.sharesOutstanding
      ? price * f.sharesOutstanding
      : // A coin's market cap is reported rather than derived: circulating
        // supply is the moving part, and CoinGecko tracks it directly.
        (crypto?.marketCap ?? null);

  // EV = market cap + debt - cash. Total liabilities overstates debt (it sweeps
  // in payables and deferred revenue), so this is an approximation and is
  // labelled as one wherever it is shown.
  const enterpriseValue =
    marketCap !== null && f?.liabilities != null && f?.cash != null
      ? marketCap + f.liabilities - f.cash
      : null;

  const equity = f?.equity ?? null;
  const dividend = f?.dividendPerShareTtm ?? null;

  return {
    price,
    previousClose: q?.previousClose ?? null,
    change: q?.change ?? null,
    changePct: q?.changePct ?? null,
    dayHigh: q?.dayHigh ?? null,
    dayLow: q?.dayLow ?? null,
    high52w: q?.high52w ?? null,
    low52w: q?.low52w ?? null,
    volume: q?.volume ?? null,
    avgVolume: avgVol,
    marketTime: q?.marketTime ?? null,
    currency: q?.currency ?? null,
    exchange: q?.exchange ?? null,
    name: q?.name ?? f?.entityName ?? null,

    marketCap,
    enterpriseValue,
    sharesOutstanding: f?.sharesOutstanding ?? null,

    peRatio: ratio(price, f?.epsTtm ?? null),
    priceToSales: ratio(marketCap, f?.revenueTtm ?? null),
    priceToBook: ratio(marketCap, equity),
    epsTtm: f?.epsTtm ?? null,

    revenueTtm: f?.revenueTtm ?? null,
    netIncomeTtm: f?.netIncomeTtm ?? null,
    grossMarginPct: marginPct(f?.grossProfitTtm ?? null, f?.revenueTtm ?? null),
    operatingMarginPct: marginPct(f?.operatingIncomeTtm ?? null, f?.revenueTtm ?? null),
    profitMarginPct: marginPct(f?.netIncomeTtm ?? null, f?.revenueTtm ?? null),
    roePct: pct(f?.netIncomeTtm ?? null, equity),
    roaPct: pct(f?.netIncomeTtm ?? null, f?.assets ?? null),
    beta,

    circulatingSupply: crypto?.circulatingSupply ?? null,
    totalSupply: crypto?.totalSupply ?? null,
    maxSupply: crypto?.maxSupply ?? null,
    fullyDilutedValuation: crypto?.fullyDilutedValuation ?? null,
    athPrice: crypto?.athPrice ?? null,
    athDate: crypto?.athDate ?? null,
    atlPrice: crypto?.atlPrice ?? null,
    atlDate: crypto?.atlDate ?? null,
    marketCapRank: crypto?.marketCapRank ?? null,

    currentRatio: ratio(f?.assetsCurrent ?? null, f?.liabilitiesCurrent ?? null),
    debtToEquity: ratio(f?.liabilities ?? null, equity),
    cash: f?.cash ?? null,
    totalAssets: f?.assets ?? null,
    totalLiabilities: f?.liabilities ?? null,

    dividendPerShareTtm: dividend,
    dividendYieldPct: pct(dividend, price),
    payoutRatioPct: pct(dividend, f?.epsTtm ?? null),

    provenance: {
      price: q ? "yahoo" : null,
      fundamentals: f ? "sec-edgar" : null,
      crypto: crypto ? "coingecko" : null,
      fiscalAsOf: f?.asOf ?? null,
      incomeBasis: f?.incomeBasis ?? null,
      cik: f?.cik ?? null,
    },
  };
}

/** Exposed for tests: the pure half, with no network. */
export const __test = { combine, ratio, pct, marginPct };
