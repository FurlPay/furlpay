import type { PendingChallenge } from "./types";

// ---------------------------------------------------------------------------
// Presentation-layer market helpers.
//
// The backend returns balances but no price history, so asset sparklines and
// change percentages here are deterministic synthetics (seeded per token +
// range) — stable across renders, clearly demo-grade, and cheap. When a real
// prices endpoint lands, swap `seriesFor`/`changeFor` to consume it.
// ---------------------------------------------------------------------------

export interface TokenMeta {
  symbol: string;
  name: string;
  logo?: string; // extension-bundled official logo (public/coins)
  color: string;
  volatility: number; // drives synthetic series amplitude (stables ≈ flat)
}

const TOKENS: Record<string, TokenMeta> = {
  USDC: { symbol: "USDC", name: "USD Coin", logo: "/coins/usdc.svg", color: "#2775CA", volatility: 0.0008 },
  USDT: { symbol: "USDT", name: "Tether", logo: "/coins/usdt.svg", color: "#26A17B", volatility: 0.0008 },
  EURC: { symbol: "EURC", name: "Euro Coin", logo: "/coins/eurc.svg", color: "#2775CA", volatility: 0.004 },
  BTC: { symbol: "BTC", name: "Bitcoin", logo: "/coins/btc.svg", color: "#F7931A", volatility: 0.03 },
  ETH: { symbol: "ETH", name: "Ethereum", logo: "/coins/eth.svg", color: "#627EEA", volatility: 0.04 },
  SOL: { symbol: "SOL", name: "Solana", logo: "/coins/sol.svg", color: "#14F195", volatility: 0.06 },
  ARB: { symbol: "ARB", name: "Arbitrum", logo: "/coins/arb.svg", color: "#12AAFF", volatility: 0.06 },
};

export function tokenMeta(symbol: string): TokenMeta {
  return (
    TOKENS[symbol.toUpperCase()] ?? {
      symbol: symbol.toUpperCase(),
      name: symbol.toUpperCase(),
      color: "#8E8E93",
      volatility: 0.02,
    }
  );
}

export const CHAIN_LABELS: Record<string, string> = {
  arbitrum: "Arbitrum",
  base: "Base",
  ethereum: "Ethereum",
  solana: "Solana",
  optimism: "Optimism",
  polygon: "Polygon",
};

export type Range = "1D" | "1W" | "1M" | "1Y";
export const RANGES: Range[] = ["1D", "1W", "1M", "1Y"];

/** Mulberry32 — tiny deterministic PRNG so series are stable per (seed). */
function prng(seedStr: string): () => number {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RANGE_SCALE: Record<Range, number> = { "1D": 1, "1W": 2.2, "1M": 4, "1Y": 9 };

/** Deterministic normalized price walk (32 points, ~1.0 baseline). */
export function seriesFor(seed: string, range: Range, volatility: number): number[] {
  const rand = prng(`${seed}:${range}`);
  const amp = volatility * RANGE_SCALE[range];
  const drift = (rand() - 0.42) * amp; // slight upward bias
  const points: number[] = [1];
  for (let i = 1; i < 32; i++) {
    const shock = (rand() - 0.5) * 2 * amp;
    points.push(Math.max(0.02, points[i - 1] * (1 + drift / 32 + shock / 3)));
  }
  return points;
}

export function changePct(series: number[]): number {
  const first = series[0];
  const last = series[series.length - 1];
  return ((last - first) / first) * 100;
}

/** Normalize a close-price series to a 1.0 baseline (relative performance). */
export function normalizeCloses(closes: number[]): number[] {
  const first = closes.find((c) => c > 0) ?? 1;
  return closes.map((c) => (c > 0 ? c / first : 1));
}

/** Resample any-length series to exactly n points (linear interpolation). */
export function resample(series: number[], n = 32): number[] {
  if (series.length === 0) return Array(n).fill(1);
  if (series.length === 1) return Array(n).fill(series[0]);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const pos = (i / (n - 1)) * (series.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(series.length - 1, lo + 1);
    out.push(series[lo] + (series[hi] - series[lo]) * (pos - lo));
  }
  return out;
}

/** Weighted blend of normalized per-asset series into one portfolio index. */
export function blendSeries(parts: { series: number[]; weight: number }[]): number[] {
  const total = parts.reduce((s, p) => s + p.weight, 0) || 1;
  const n = 32;
  const out = Array(n).fill(0);
  for (const p of parts) {
    const s = resample(p.series, n);
    for (let i = 0; i < n; i++) out[i] += (s[i] * p.weight) / total;
  }
  return out;
}

/** SVG polyline points string for a sparkline of the given box size. */
export function sparklinePoints(series: number[], width: number, height: number, pad = 2): string {
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  return series
    .map((v, i) => {
      const x = pad + (i / (series.length - 1)) * (width - pad * 2);
      const y = pad + (1 - (v - min) / span) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

// ---------------------------------------------------------------------------
// FurlPay Protect — local pre-approval risk heuristic for 3DS2 challenges.
// Runs entirely client-side on data the issuer webhook already provided
// (amount, merchant, location, MCC). Advisory only — the user always decides.
// ---------------------------------------------------------------------------

export type RiskLevel = "safe" | "review" | "high";

export interface RiskAssessment {
  level: RiskLevel;
  label: string;
  reason: string;
}

const MCC_LABELS: Record<string, string> = {
  "4411": "Cruise lines",
  "4511": "Airlines",
  "4722": "Travel agencies",
  "5411": "Groceries",
  "5732": "Electronics",
  "5812": "Restaurants",
  "5814": "Fast food",
  "5967": "Direct marketing", // classic card-testing MCC
  "6051": "Crypto / quasi-cash",
  "7011": "Hotels",
  "7273": "Dating services",
  "7995": "Gambling",
  "8398": "Charity",
};

export function mccLabel(mcc?: string): string | null {
  return (mcc && MCC_LABELS[mcc]) || null;
}

const RISKY_MCCS = new Set(["5967", "6051", "7995", "7273"]);

export function assessChallenge(c: PendingChallenge): RiskAssessment {
  const hasLocation = Boolean(c.merchant.city || c.merchant.country);
  if (c.merchant.mcc && RISKY_MCCS.has(c.merchant.mcc)) {
    return {
      level: "high",
      label: "High risk",
      reason: `${mccLabel(c.merchant.mcc)} merchants are a common card-testing pattern.`,
    };
  }
  if (c.amountUsd >= 750) {
    return {
      level: "review",
      label: "Review carefully",
      reason: "Large amount — confirm you initiated this purchase.",
    };
  }
  if (!hasLocation) {
    return {
      level: "review",
      label: "Review carefully",
      reason: "Merchant did not report a location for this charge.",
    };
  }
  return {
    level: "safe",
    label: "Looks safe",
    reason: "Amount, merchant category and location match normal patterns.",
  };
}
