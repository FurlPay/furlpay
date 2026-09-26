// Valuing a transfer in USD.
//
// This is the single most abusable step in the whole system: it is where a
// number appears that nobody can check by eye. So the rules are strict —
//
//   * a price must come from somewhere nameable (the price cache, a CoinGecko
//     contract lookup, or a stablecoin peg),
//   * every valuation carries its age and its origin,
//   * when no price exists the transfer is DROPPED rather than valued at zero
//     or at a guessed price.
//
// A whale alert that cannot be priced is not a whale alert.

import { prices } from "../db/index.js";
import { coingecko, CG_PLATFORM } from "../providers/index.js";
import { valuationConfidence } from "./classify.js";
import { makeLogger } from "../util/logger.js";

const log = makeLogger("pricing");

export interface Valuation {
  priceUsd: number;
  amountUsd: number;
  confidence: number;
  source: "registry" | "lookup" | "stablecoin-peg";
}

/**
 * Stablecoins are pegged, but the peg is an assumption, not an observation —
 * so it is labelled as such and carries slightly reduced confidence. If the
 * price cache holds a real quote for the symbol, that always wins over the peg.
 */
const PEGGED: Record<string, number> = {
  USDT: 1, USDC: 1, DAI: 1, BUSD: 1, TUSD: 1, USDP: 1, FDUSD: 1,
  PYUSD: 1, USDE: 1, "USD₮0": 1, USDT0: 1, USDt: 1,
};

/** In-process negative cache: stop re-querying a token CoinGecko does not list. */
const unpriceable = new Map<string, number>();
const UNPRICEABLE_TTL = 6 * 60 * 60 * 1000;

/**
 * Value `amount` of `symbol`. Returns null when no honest price exists, which
 * the callers treat as "do not emit this event".
 */
export async function value(
  amount: number,
  symbol: string,
  opts: { chainSlug?: string; tokenAddress?: string | null; coingeckoId?: string | null } = {},
): Promise<Valuation | null> {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const sym = (symbol ?? "").trim();
  if (!sym) return null;

  // 1. A real quote in the price cache, by CoinGecko id when we have one.
  if (opts.coingeckoId) {
    const q = prices.get(opts.coingeckoId);
    if (q?.priceUsd) {
      return build(amount, q.priceUsd, Date.now() - q.fetchedAt, "registry");
    }
  }

  // 2. A real quote by ticker.
  const bySym = prices.bySymbol(sym);
  if (bySym) {
    return build(amount, bySym.price, Date.now() - bySym.fetchedAt, "registry");
  }

  // 3. Stablecoin peg — an assumption, marked as one.
  const peg = PEGGED[sym] ?? PEGGED[sym.toUpperCase()];
  if (peg) {
    return build(amount, peg, 0, "stablecoin-peg");
  }

  // 4. Contract lookup for a token we do not track. Costs a CoinGecko call, so
  //    failures are cached to keep an unlisted token from burning the budget.
  if (opts.chainSlug && opts.tokenAddress) {
    const platform = CG_PLATFORM[opts.chainSlug];
    if (platform) {
      const key = `${opts.chainSlug}:${opts.tokenAddress.toLowerCase()}`;
      const failedAt = unpriceable.get(key);
      if (failedAt && Date.now() - failedAt < UNPRICEABLE_TTL) return null;

      const p = await coingecko.tokenPrice(platform, opts.tokenAddress).catch(() => null);
      if (p && p > 0) return build(amount, p, 0, "lookup");
      unpriceable.set(key, Date.now());
      log.debug("token has no listed price", { chain: opts.chainSlug, token: opts.tokenAddress });
    }
  }

  return null;
}

function build(
  amount: number,
  price: number,
  ageMs: number,
  source: Valuation["source"],
): Valuation | null {
  const amountUsd = amount * price;
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return null;
  const confidence = valuationConfidence({ priceAgeMs: ageMs, pricedFrom: source });
  // A valuation nobody should act on is worse than none at all.
  if (confidence < 0.5) return null;
  return { priceUsd: price, amountUsd, confidence, source };
}

/** Synchronous variant for hot loops — cache and peg only, never a network call. */
export function valueSync(
  amount: number,
  symbol: string,
  coingeckoId?: string | null,
): Valuation | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const sym = (symbol ?? "").trim();
  if (!sym) return null;

  if (coingeckoId) {
    const q = prices.get(coingeckoId);
    if (q?.priceUsd) return build(amount, q.priceUsd, Date.now() - q.fetchedAt, "registry");
  }
  const bySym = prices.bySymbol(sym);
  if (bySym) return build(amount, bySym.price, Date.now() - bySym.fetchedAt, "registry");
  const peg = PEGGED[sym] ?? PEGGED[sym.toUpperCase()];
  if (peg) return build(amount, peg, 0, "stablecoin-peg");
  return null;
}

export function isStablecoinSymbol(symbol: string): boolean {
  return symbol.toUpperCase() in PEGGED || /^[A-Z]*USD[A-Z0-9]*$/.test(symbol.toUpperCase());
}
