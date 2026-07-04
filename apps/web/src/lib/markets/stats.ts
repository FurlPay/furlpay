// ---------------------------------------------------------------------------
// Deterministic key stats + AI digest for asset detail pages. Real quotes come
// from quotes.ts; everything derived here (market cap, P/E, ranges, volumes)
// is a stable pseudo-random function of the symbol so the demo behaves like a
// live terminal without an external fundamentals API. Swap for Alpha Vantage /
// FMP when a fundamentals key is provisioned.
// ---------------------------------------------------------------------------

import { MarketAsset } from "./catalog";
import type { Quote } from "./quotes";

/** Stable 0..1 hash of a string (FNV-style). */
function unit(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

const CAP_RANGE: Record<string, [number, number]> = {
  mega: [250e9, 3600e9],
  large: [15e9, 250e9],
  mid: [2e9, 15e9],
  small: [0.25e9, 2e9],
};

export interface KeyStats {
  marketCap: number;
  peRatio: number | null;
  eps: number | null;
  dividendYieldPct: number | null;
  beta: number | null;
  high52w: number;
  low52w: number;
  volume: number;
  avgVolume: number;
  /** Crypto only. */
  circulatingSupply: number | null;
  athPrice: number | null;
}

export function keyStatsFor(a: MarketAsset, quote: Quote): KeyStats {
  const u = (salt: string) => unit(a.symbol + ":" + salt);
  const [capLo, capHi] = CAP_RANGE[a.cap ?? "large"];
  const marketCap = capLo + (capHi - capLo) * Math.pow(u("cap"), 1.6);
  const price = quote.price || 1;

  const high52w = price * (1.04 + 0.4 * u("hi"));
  const low52w = price * (1 - (0.08 + 0.38 * u("lo")));
  const volume = marketCap * (0.002 + 0.01 * u("vol")) / Math.max(price, 0.0001);
  const avgVolume = volume * (0.85 + 0.3 * u("avg"));

  if (a.kind === "crypto") {
    return {
      marketCap,
      peRatio: null,
      eps: null,
      dividendYieldPct: null,
      beta: null,
      high52w,
      low52w,
      volume,
      avgVolume,
      circulatingSupply: marketCap / price,
      athPrice: price * (1.05 + 1.6 * u("ath")),
    };
  }

  const growthSector = a.sector === "Technology" || a.sector === "Communication" || a.industry?.includes("AI");
  const incomeSector = a.sector === "Utilities" || a.sector === "Consumer Staples" || a.sector === "Real Estate" || a.sector === "Energy";
  const peRatio = a.kind === "etf" ? null : (growthSector ? 24 : 10) + (growthSector ? 55 : 22) * u("pe");
  return {
    marketCap,
    peRatio: peRatio ? +peRatio.toFixed(1) : null,
    eps: peRatio ? +(price / peRatio).toFixed(2) : null,
    dividendYieldPct: a.kind === "etf" || incomeSector ? +(0.8 + 3.6 * u("dy")).toFixed(2) : u("hasdiv") > 0.5 ? +(0.2 + 1.4 * u("dy")).toFixed(2) : null,
    beta: +(0.55 + 1.3 * u("beta")).toFixed(2),
    high52w,
    low52w,
    volume,
    avgVolume,
    circulatingSupply: null,
    athPrice: null,
  };
}

/** Robinhood-Cortex-style natural-language digest, generated deterministically. */
export function digestFor(a: MarketAsset, quote: Quote, stats: KeyStats): string {
  const dir = quote.changePct >= 0 ? "up" : "down";
  const move = Math.abs(quote.changePct).toFixed(2);
  const posIn52w = Math.round(((quote.price - stats.low52w) / Math.max(stats.high52w - stats.low52w, 0.0001)) * 100);

  if (a.kind === "crypto") {
    const cat = a.industry ?? "digital asset";
    return `${a.name} is ${dir} ${move}% over the last 24 hours, trading in the ${posIn52w > 60 ? "upper" : posIn52w > 35 ? "middle" : "lower"} part of its 52-week range. As a ${cat === "L1" ? "layer-1 network token" : cat === "L2" ? "layer-2 scaling token" : `${cat} token`}${a.chain && a.chain !== "own" ? ` on ${a.chain[0].toUpperCase() + a.chain.slice(1)}` : ""}, price action tends to track overall crypto risk appetite — watch BTC dominance and funding rates for confirmation before sizing a position.`;
  }
  const val = stats.peRatio
    ? stats.peRatio > 40
      ? `Valuation is rich at ${stats.peRatio}× earnings, so execution needs to stay flawless.`
      : stats.peRatio > 20
        ? `At ${stats.peRatio}× earnings the market is pricing steady growth.`
        : `At ${stats.peRatio}× earnings the valuation leaves room for multiple expansion.`
    : "";
  const div = stats.dividendYieldPct ? ` A ${stats.dividendYieldPct}% dividend yield adds an income cushion.` : "";
  return `${a.name} is ${dir} ${move}% today and sits ${posIn52w}% of the way up its 52-week range. ${a.kind === "etf" ? `The fund gives diversified ${a.industry?.toLowerCase() ?? "market"} exposure in a single ticker.` : `The ${a.industry?.toLowerCase() ?? "company"} name remains a ${(a.cap ?? "large") === "mega" ? "core mega-cap" : a.cap === "small" ? "higher-beta small-cap" : `${a.cap}-cap`} holding in the ${a.sector} sector.`} ${val}${div}`.trim();
}
