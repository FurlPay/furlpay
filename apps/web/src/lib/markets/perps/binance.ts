// ---------------------------------------------------------------------------
// Live quotes for the USDT-M perpetuals, from Binance's public futures API.
//
// ── KEYLESS, AND ONE REQUEST FOR EVERYTHING ────────────────────────────────
//
// /fapi/v1/ticker/24hr with no symbol returns every contract in one response,
// so twelve pairs cost one call rather than twelve. Same for premiumIndex
// (mark, index, funding) and openInterest — except openInterest is per-symbol,
// which is why it is optional here and fetched only when asked for.
//
// No key is required for any of this. Alpaca — which the request suggested —
// cannot serve it: its crypto feed covers BTC/USD and ETH/USD out of these
// twelve and offers spot bars, not perpetual contracts with funding and open
// interest. That was checked rather than assumed.
//
// ── SANITY BOUNDS, PER THE REPO'S ORACLE RULE ──────────────────────────────
//
// A quote is only returned when it parses to a FINITE, POSITIVE number. A
// contract that answers 0, NaN or a negative price is dropped rather than
// rendered: "$0.00" on a market screen reads as "this is worthless", which is a
// far stronger claim than "we could not price this". Percentages are allowed to
// be negative — that is a direction, not a price.
//
// The upper bound is deliberately loose (1e12). These are alt-coin perps whose
// prices span eight orders of magnitude, from BTC at ~80,000 to tokens at
// 0.0045, so a tight clamp would reject real data. The bound exists to catch a
// provider returning garbage, not to second-guess the market.
// ---------------------------------------------------------------------------

import { cachedJson, BROWSER_UA } from "@/lib/markets/providers/cache";
import { PERPS, perpBySymbol, contractAgeDays, type PerpSpec } from "./registry";

const FAPI = "https://fapi.binance.com/fapi/v1";

/** Perp prices move constantly; a quote reused within the window is fine. */
const TTL_TICKER = 10;
/** Funding and mark move far more slowly than last price. */
const TTL_PREMIUM = 30;

/** Loose upper bound — see the header on why this is not tight. */
const MAX_PRICE = 1e12;

export interface PerpQuote {
  symbol: string;
  base: string;
  name: string;
  underlying: PerpSpec["underlying"];
  accent: string;
  /** Last traded price. */
  price: number;
  changePct: number;
  high24h: number | null;
  low24h: number | null;
  /** Base-asset volume over 24h. */
  volume24h: number | null;
  /** Quote (USDT) volume over 24h — the figure the exchange screen shows. */
  quoteVolume24h: number | null;
  /** Mark price, which is what liquidations use. Null when unavailable. */
  markPrice: number | null;
  indexPrice: number | null;
  /** Current funding rate as a fraction (0.0001 = 0.01%). */
  fundingRate: number | null;
  /** Epoch ms of the next funding settlement. */
  nextFundingTime: number | null;
  /** ISO date the CONTRACT listed — see registry.ts. */
  listedAt: string;
  ageDays: number | null;
  /** True when this came from the provider rather than a cache miss fallback. */
  live: boolean;
}

/** A finite, positive price, or null. The oracle guard. */
function price(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > MAX_PRICE) return null;
  return n;
}

/** A finite number that is allowed to be negative or zero (change, funding). */
function signed(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

interface Ticker24h {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
}

interface PremiumIndex {
  symbol: string;
  markPrice: string;
  indexPrice: string;
  lastFundingRate: string;
  nextFundingTime: number;
}

async function fetchJson<T>(url: string, timeoutMs = 10_000): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: BROWSER_UA,
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Every 24h ticker, keyed by symbol. One request for all contracts. */
async function allTickers(): Promise<Map<string, Ticker24h>> {
  const rows = await cachedJson<Ticker24h[]>("perp:ticker24", TTL_TICKER, () =>
    fetchJson<Ticker24h[]>(`${FAPI}/ticker/24hr`)
  );
  const out = new Map<string, Ticker24h>();
  for (const r of rows ?? []) out.set(r.symbol, r);
  return out;
}

/** Mark, index and funding for every contract. */
async function allPremiums(): Promise<Map<string, PremiumIndex>> {
  const rows = await cachedJson<PremiumIndex[]>("perp:premium", TTL_PREMIUM, () =>
    fetchJson<PremiumIndex[]>(`${FAPI}/premiumIndex`)
  );
  const out = new Map<string, PremiumIndex>();
  for (const r of rows ?? []) out.set(r.symbol, r);
  return out;
}

/**
 * Quotes for the tracked perpetuals.
 *
 * A symbol with no usable price is OMITTED from the result rather than
 * returned with zeros — the caller then renders one fewer row instead of a row
 * claiming a contract is worth nothing.
 */
export async function getPerpQuotes(
  symbols: readonly string[] = PERPS.map((p) => p.symbol),
  now = new Date()
): Promise<PerpQuote[]> {
  const [tickers, premiums] = await Promise.all([allTickers(), allPremiums()]);

  const out: PerpQuote[] = [];
  for (const sym of symbols) {
    const spec = perpBySymbol(sym);
    if (!spec) continue;

    const t = tickers.get(spec.symbol);
    const last = price(t?.lastPrice);
    // No price, no row. See the header.
    if (!t || last === null) continue;

    const p = premiums.get(spec.symbol);

    out.push({
      symbol: spec.symbol,
      base: spec.base,
      name: spec.name,
      underlying: spec.underlying,
      accent: spec.accent,
      price: last,
      changePct: signed(t.priceChangePercent) ?? 0,
      high24h: price(t.highPrice),
      low24h: price(t.lowPrice),
      volume24h: signed(t.volume),
      quoteVolume24h: signed(t.quoteVolume),
      markPrice: price(p?.markPrice),
      indexPrice: price(p?.indexPrice),
      fundingRate: signed(p?.lastFundingRate),
      nextFundingTime:
        typeof p?.nextFundingTime === "number" && p.nextFundingTime > 0 ? p.nextFundingTime : null,
      listedAt: spec.listedAt,
      ageDays: contractAgeDays(spec, now),
      live: true,
    });
  }

  return out;
}

/**
 * What the provider says when asked directly, with nothing cached in the way.
 *
 * Called only when a request produced no quotes at all. Until this existed the
 * route's single signal for a blocked region was `returned: 0` — which is also
 * what an unknown symbol returns, and what a healthy exchange with no matching
 * contracts would return. That ambiguity is precisely what let a 451 sit in
 * production undiagnosed while the code passed every test and worked on every
 * developer machine.
 *
 * /fapi/v1/ping is the cheapest endpoint Binance publishes and is subject to
 * the same geo-restriction as the rest of the API, so it answers the actual
 * question: can this region reach the provider at all?
 */
export async function probeUpstream(): Promise<{
  reachable: boolean;
  status: number | null;
  detail: string;
}> {
  try {
    const res = await fetch(`${FAPI}/ping`, {
      headers: BROWSER_UA,
      signal: AbortSignal.timeout(5_000),
      cache: "no-store",
    });
    if (res.ok) return { reachable: true, status: res.status, detail: "reachable" };
    return {
      reachable: false,
      status: res.status,
      detail:
        res.status === 451
          ? "Binance refused this region (451 Unavailable For Legal Reasons). This function is not running outside the restricted jurisdiction — check the `functions` region pin in vercel.json."
          : `Binance returned HTTP ${res.status}.`,
    };
  } catch {
    return { reachable: false, status: null, detail: "Binance was unreachable (network error or timeout)." };
  }
}

/**
 * Open interest for one contract.
 *
 * Separate because Binance only serves it per-symbol: twelve contracts is
 * twelve requests, which is not something to do on every page render.
 */
export async function getOpenInterest(symbol: string): Promise<number | null> {
  const spec = perpBySymbol(symbol);
  if (!spec) return null;
  const row = await cachedJson<{ openInterest?: string }>(`perp:oi:${spec.symbol}`, 30, () =>
    fetchJson<{ openInterest?: string }>(`${FAPI}/openInterest?symbol=${spec.symbol}`)
  );
  return price(row?.openInterest);
}
