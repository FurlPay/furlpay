import { AssetMatch, Bar, BarInterval, BarsResult, Quote } from "./types";

/**
 * Deterministic demo data. Every value is derived from the symbol string, so the
 * same symbol always yields the same quote/bars — the library is clone-and-run
 * without any API key, and demos look identical on every render.
 */

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Mulberry32 seeded PRNG — deterministic given a seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function basePrice(symbol: string): number {
  // Stable price in roughly [20, 520).
  return 20 + (hash(symbol.toUpperCase()) % 5000) / 10;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function demoQuote(symbol: string): Quote {
  const sym = symbol.toUpperCase();
  const r = rng(hash(sym));
  const prev = basePrice(sym);
  const changePct = (r() - 0.5) * 4; // ±2%
  const price = round2(prev * (1 + changePct / 100));
  const high = round2(Math.max(price, prev) * (1 + r() * 0.01));
  const low = round2(Math.min(price, prev) * (1 - r() * 0.01));
  const open = round2(prev * (1 + (r() - 0.5) * 0.01));
  return {
    symbol: sym,
    price,
    open,
    high,
    low,
    previousClose: round2(prev),
    change: round2(price - prev),
    changePercent: round2(changePct),
    volume: 500_000 + (hash(sym + "v") % 5_000_000),
    currency: "USD",
    asOf: new Date().toISOString(),
    source: "demo",
  };
}

export function demoBars(symbol: string, interval: BarInterval, limit: number): BarsResult {
  const sym = symbol.toUpperCase();
  const r = rng(hash(sym + interval));
  const stepMs = intervalMs(interval);
  const bars: Bar[] = [];
  let price = basePrice(sym);
  const now = Date.now();
  for (let i = limit - 1; i >= 0; i--) {
    const drift = (r() - 0.5) * price * 0.02; // ±1% random walk
    const o = round2(price);
    const c = round2(price + drift);
    const h = round2(Math.max(o, c) * (1 + r() * 0.005));
    const l = round2(Math.min(o, c) * (1 - r() * 0.005));
    bars.push({
      t: new Date(now - i * stepMs).toISOString(),
      o,
      h,
      l,
      c,
      v: 100_000 + Math.floor(r() * 2_000_000),
    });
    price = c;
  }
  return { symbol: sym, interval, bars, source: "demo" };
}

export function demoSearch(query: string): AssetMatch[] {
  const q = query.toUpperCase();
  const universe: Array<[string, string, string]> = [
    ["AAPL", "Apple Inc.", "Equity"],
    ["MSFT", "Microsoft Corporation", "Equity"],
    ["NVDA", "NVIDIA Corporation", "Equity"],
    ["VOO", "Vanguard S&P 500 ETF", "ETF"],
    ["VTI", "Vanguard Total Stock Market ETF", "ETF"],
    ["TSLA", "Tesla, Inc.", "Equity"],
    ["AMZN", "Amazon.com, Inc.", "Equity"],
    ["QQQ", "Invesco QQQ Trust", "ETF"],
  ];
  return universe
    .filter(([s, n]) => s.includes(q) || n.toUpperCase().includes(q))
    .map(([symbol, name, type]) => ({
      symbol,
      name,
      type,
      region: "United States",
      currency: "USD",
      source: "demo" as const,
    }));
}

function intervalMs(interval: BarInterval): number {
  switch (interval) {
    case "1min":
      return 60_000;
    case "5min":
      return 5 * 60_000;
    case "15min":
      return 15 * 60_000;
    case "30min":
      return 30 * 60_000;
    case "60min":
      return 60 * 60_000;
    case "daily":
      return 24 * 60 * 60_000;
  }
}
