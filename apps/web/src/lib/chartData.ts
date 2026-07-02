// Deterministic price/OHLC series generator for the charts. Mock-mode: shapes a
// realistic random walk that ends near a target value, seeded so the same
// symbol+timeframe always renders identically. A live build swaps this for the
// market-data feed (Alpaca / Twelve Data).

export type Timeframe = "1D" | "1W" | "1M" | "3M" | "1Y" | "ALL";
export const TIMEFRAMES: Timeframe[] = ["1D", "1W", "1M", "3M", "1Y", "ALL"];

export interface LinePoint { time: number; value: number }
export interface Candle { time: number; open: number; high: number; low: number; close: number }

export interface Series {
  line: LinePoint[];
  candles: Candle[];
  last: number;
  first: number;
  changeAbs: number;
  changePct: number;
}

const CONFIG: Record<Timeframe, { points: number; stepSec: number; vol: number }> = {
  "1D": { points: 78, stepSec: 5 * 60, vol: 0.004 },
  "1W": { points: 56, stepSec: 3 * 3600, vol: 0.008 },
  "1M": { points: 30, stepSec: 86400, vol: 0.013 },
  "3M": { points: 90, stepSec: 86400, vol: 0.018 },
  "1Y": { points: 52, stepSec: 7 * 86400, vol: 0.03 },
  ALL: { points: 60, stepSec: 30 * 86400, vol: 0.05 },
};

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function generateSeries(seed: string, tf: Timeframe, endValue: number): Series {
  const { points, stepSec, vol } = CONFIG[tf];
  const rng = mulberry32(hashSeed(`${seed}:${tf}`));

  // Multiplicative random walk with slight upward drift.
  const rel: number[] = [];
  let v = 1;
  for (let i = 0; i < points; i++) {
    v *= 1 + 0.0006 + (rng() - 0.5) * vol * 2;
    rel.push(v);
  }
  const scale = endValue / rel[rel.length - 1];

  const now = Math.floor(Date.now() / 1000);
  const start = now - (points - 1) * stepSec;
  const line: LinePoint[] = [];
  const candles: Candle[] = [];
  let prevClose = rel[0] * scale;

  for (let i = 0; i < points; i++) {
    const time = start + i * stepSec;
    const close = rel[i] * scale;
    const open = i === 0 ? close * (1 - (rng() - 0.5) * vol) : prevClose;
    const high = Math.max(open, close) * (1 + rng() * vol * 0.8);
    const low = Math.min(open, close) * (1 - rng() * vol * 0.8);
    line.push({ time, value: round(close) });
    candles.push({ time, open: round(open), high: round(high), low: round(low), close: round(close) });
    prevClose = close;
  }

  const first = line[0].value;
  const last = line[line.length - 1].value;
  return { line, candles, first, last, changeAbs: last - first, changePct: ((last - first) / first) * 100 };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
