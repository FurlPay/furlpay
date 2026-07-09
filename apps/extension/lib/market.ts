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
export const SERIES_POINTS = 64;

/**
 * Deterministic normalized price walk (~1.0 baseline). Modeled on real market
 * texture rather than a smooth bezier: volatility clustering (GARCH-ish decay),
 * occasional jump shocks, and regime drift that flips sign mid-series — so BTC
 * looks choppy, ETH trends, SOL whipsaws, and stables stay visibly flat.
 */
export function seriesFor(seed: string, range: Range, volatility: number): number[] {
  const rand = prng(`${seed}:${range}`);
  const amp = volatility * RANGE_SCALE[range];
  let drift = (rand() - 0.42) * amp;
  let vol = amp * (0.5 + rand()); // current volatility regime
  const points: number[] = [1];
  for (let i = 1; i < SERIES_POINTS; i++) {
    // Volatility clustering: shocks feed the next period's volatility.
    const shock = (rand() - 0.5) * 2 * vol;
    vol = Math.max(amp * 0.25, vol * 0.9 + Math.abs(shock) * 0.6);
    // Rare jump (news candle) — ~4% of steps, stronger for volatile assets.
    const jump = rand() > 0.96 ? (rand() - 0.5) * 6 * amp : 0;
    // Drift regime flips roughly twice per series.
    if (rand() > 0.97) drift = (rand() - 0.5) * amp * 1.4;
    points.push(Math.max(0.02, points[i - 1] * (1 + drift / SERIES_POINTS + shock / 3 + jump / 3)));
  }
  return points;
}

/** Evenly spaced epoch-ms timestamps ending now, matching a series' length. */
export function seriesTimes(range: Range, n: number): number[] {
  const spans: Record<Range, number> = {
    "1D": 24 * 3600e3,
    "1W": 7 * 24 * 3600e3,
    "1M": 30 * 24 * 3600e3,
    "1Y": 365 * 24 * 3600e3,
  };
  const end = Date.now();
  const start = end - spans[range];
  return Array.from({ length: n }, (_, i) => start + ((end - start) * i) / (n - 1));
}

/** Axis / tooltip time label appropriate for the range. */
export function timeLabel(ts: number, range: Range): string {
  const d = new Date(ts);
  if (range === "1D") return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (range === "1Y") return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export const RANGE_PERIOD_LABEL: Record<Range, string> = {
  "1D": "Today",
  "1W": "Past week",
  "1M": "Past month",
  "1Y": "Past year",
};

/** $19.3M / $248.3M / $1.2B — how fintechs print TVL. */
export function compactMoney(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

/** Token quantity with intelligent precision (4,211.85 not 4210.550000). */
export function tokenAmount(n: number): string {
  const digits = n >= 1000 ? 2 : n >= 1 ? 4 : 6;
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
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
// Activity presentation — merchant monograms and transaction status system.
// ---------------------------------------------------------------------------

const MONOGRAM_PALETTE = [
  "#2775CA", // blue
  "#8B5CF6", // violet
  "#F7931A", // amber
  "#E0245E", // raspberry
  "#12AAFF", // sky
  "#26A17B", // teal
  "#F59E0B", // orange
  "#627EEA", // indigo
];

/** Deterministic brand-ish color for a merchant monogram avatar. */
export function monogramColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return MONOGRAM_PALETTE[Math.abs(h) % MONOGRAM_PALETTE.length];
}

export function monogram(name: string): string {
  const words = name.trim().split(/\s+/);
  return words.length >= 2 ? (words[0][0] + words[1][0]).toUpperCase() : name.slice(0, 2).toUpperCase();
}

export interface TxStatusMeta {
  label: string;
  tone: "gain" | "loss" | "warning" | "info" | "muted";
}

/** Map any backend status string onto the shared color system. */
export function txStatusMeta(status: string): TxStatusMeta {
  const s = status.toLowerCase();
  if (s === "declined" || s === "failed" || s === "reversed") return { label: s === "declined" ? "Declined" : "Failed", tone: "loss" };
  if (s === "pending" || s === "processing" || s === "authorizing") return { label: "Pending", tone: "warning" };
  if (s === "refunded" || s === "escrow" || s === "held") return { label: s[0].toUpperCase() + s.slice(1), tone: "info" };
  if (s === "scheduled" || s === "queued") return { label: "Scheduled", tone: "muted" };
  if (s === "settled") return { label: "Settled", tone: "gain" };
  if (s === "completed" || s === "succeeded" || s === "approved") return { label: "Completed", tone: "gain" };
  return { label: status ? status[0].toUpperCase() + status.slice(1) : "—", tone: "muted" };
}

/** "Today" / "Yesterday" / "Jul 4" group header for an ISO timestamp. */
export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 864e5);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Today";
  if (same(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) });
}

export function clockLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
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
