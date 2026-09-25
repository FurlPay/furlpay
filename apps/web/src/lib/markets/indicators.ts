// ---------------------------------------------------------------------------
// Technical indicators — EMA, RSI (Wilder), MACD, Bollinger.
//
// WHY THESE ARE HAND-WRITTEN rather than taken from `technicalindicators`, which
// is what the brief specified. That package's latest release is 3.1.0, published
// 2023-07-12, and it declares `@types/node: ^6.0.96` — a Node 6-era type
// dependency. A three-year-unmaintained package with an ancient transitive
// dependency is a poor supply-chain bet for arithmetic that renders on a money
// surface, and AGENTS.md rule 11 makes adding dependencies a deliberate act.
//
// The deciding factor is the RSI requirement: these must match TradingView's
// reference values, and that is only guaranteeable by controlling the smoothing.
// There is more than one RSI in the wild — a simple-average variant and Wilder's
// — and they disagree by several points on the same data. The whole of this file
// is about 120 lines of specified math with a reference-value test, which is a
// better position than trusting an abandoned package to have picked the same one.
//
// SOURCES for the conventions implemented here:
//   Wilder's RSI (α = 1/n, SMA-seeded):
//     https://www.tradingview.com/support/solutions/43000502338-relative-strength-index-rsi/
//     Wilder, New Concepts in Technical Trading Systems (1978)
//   EMA (α = 2/(N+1), SMA-seeded): standard, and what TradingView's ta.ema uses.
//
// THE RULE THIS FILE OBEYS, and it is the reason for the result type below:
// an indicator with insufficient history returns a REASON, never a number. A
// truncated EMA-200 computed from 34 bars is not an EMA-200 — it is a different
// number wearing its name, and drawing it on a chart is synthetic data with a
// technical-sounding label. `allowSynthetic={false}` exists to forbid exactly
// that, so this layer must not smuggle it back in.
// ---------------------------------------------------------------------------

/**
 * An indicator series, or an honest account of why there isn't one.
 *
 * A discriminated union rather than `number[] | null`, so a caller cannot render
 * an empty array as a flat line at zero and cannot show "no data" without being
 * able to say what was missing.
 */
export type IndicatorResult =
  | { ok: true; values: (number | null)[]; required: number; provided: number }
  | { ok: false; reason: string; required: number; provided: number };

/**
 * Bars needed before each indicator produces its first real value.
 *
 * These are the SEED requirements, not suggestions. An EMA-200 needs 200 closes
 * to form the SMA it starts from; the MACD signal needs 26 for the slow EMA plus
 * another 9 to smooth the resulting line.
 */
export const REQUIRED_BARS = {
  ema: (period: number) => period,
  rsi: (period: number) => period + 1, // n changes need n+1 closes
  macd: (slow: number, signal: number) => slow + signal - 1,
  bollinger: (period: number) => period,
} as const;

function insufficient(name: string, required: number, provided: number): IndicatorResult {
  return {
    ok: false,
    // Phrased for a tooltip a user will actually read, and it names both numbers
    // so the gap is obvious rather than mysterious.
    reason: `${name} requires ${required} bars (${provided} available)`,
    required,
    provided,
  };
}

/**
 * Exponential moving average, seeded with the SMA of the first `period` closes.
 *
 *   α = 2 / (period + 1)
 *   EMA_t = close_t · α + EMA_{t-1} · (1 − α)
 *
 * Leading entries are `null` rather than a copy of the price: an EMA has no value
 * before its seed window closes, and filling the gap with the close would draw a
 * line that tracks price exactly and then diverges, which reads as signal.
 */
export function ema(closes: number[], period: number): IndicatorResult {
  const required = REQUIRED_BARS.ema(period);
  if (!Number.isInteger(period) || period < 1) {
    return { ok: false, reason: `EMA period must be a positive integer`, required, provided: closes.length };
  }
  if (closes.length < required) return insufficient(`EMA-${period}`, required, closes.length);

  const out: (number | null)[] = new Array(closes.length).fill(null);
  const alpha = 2 / (period + 1);

  let seed = 0;
  for (let i = 0; i < period; i++) seed += closes[i];
  let prev = seed / period;
  out[period - 1] = prev;

  for (let i = period; i < closes.length; i++) {
    prev = closes[i] * alpha + prev * (1 - alpha);
    out[i] = prev;
  }
  return { ok: true, values: out, required, provided: closes.length };
}

/**
 * Relative Strength Index, using WILDER's smoothing.
 *
 *   seed:  avgGain = Σ(gains over first n) / n,  avgLoss likewise
 *   step:  avgGain = (avgGain·(n−1) + gain_t) / n
 *   RSI    = 100 − 100/(1 + avgGain/avgLoss)
 *
 * WILDER'S, NOT A SIMPLE AVERAGE, and the distinction is not academic: the two
 * conventions differ by several points on the same series, and TradingView,
 * MetaTrader and the major exchanges all default to Wilder's. An RSI that
 * disagreed with the chart the user is comparing against would be worse than no
 * RSI at all.
 *
 * A zero average loss yields 100 — the correct limit as RS → ∞, and the case a
 * naive implementation divides by zero on.
 */
export function rsi(closes: number[], period = 14): IndicatorResult {
  const required = REQUIRED_BARS.rsi(period);
  if (closes.length < required) return insufficient(`RSI-${period}`, required, closes.length);

  const out: (number | null)[] = new Array(closes.length).fill(null);

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) gainSum += change;
    else lossSum -= change; // losses carried as positive magnitudes
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return { ok: true, values: out, required, provided: closes.length };
}

export interface MacdResult {
  ok: true;
  macd: (number | null)[];
  signal: (number | null)[];
  histogram: (number | null)[];
  required: number;
  provided: number;
}

/**
 * MACD: fast EMA − slow EMA, with a signal EMA over that difference.
 *
 * The signal is an EMA of the MACD LINE, not of price, and it is seeded from the
 * first `signal` values of that line — which is why the full series needs
 * slow + signal − 1 bars before a histogram exists.
 */
export function macd(
  closes: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9
): MacdResult | { ok: false; reason: string; required: number; provided: number } {
  const required = REQUIRED_BARS.macd(slow, signalPeriod);
  if (closes.length < required) {
    const bad = insufficient(`MACD(${fast},${slow},${signalPeriod})`, required, closes.length);
    return bad as { ok: false; reason: string; required: number; provided: number };
  }

  const fastEma = ema(closes, fast);
  const slowEma = ema(closes, slow);
  if (!fastEma.ok || !slowEma.ok) {
    return insufficient(`MACD(${fast},${slow},${signalPeriod})`, required, closes.length) as {
      ok: false; reason: string; required: number; provided: number;
    };
  }

  const line: (number | null)[] = closes.map((_, i) => {
    const f = fastEma.values[i];
    const s = slowEma.values[i];
    return f === null || s === null ? null : f - s;
  });

  // Seed the signal EMA from the first `signalPeriod` REAL macd values, so the
  // leading nulls do not shift the seed window.
  const firstReal = line.findIndex((v) => v !== null);
  const dense = line.slice(firstReal).filter((v): v is number => v !== null);
  const signalDense = ema(dense, signalPeriod);

  const signal: (number | null)[] = new Array(closes.length).fill(null);
  if (signalDense.ok) {
    for (let i = 0; i < signalDense.values.length; i++) {
      signal[firstReal + i] = signalDense.values[i];
    }
  }

  const histogram: (number | null)[] = closes.map((_, i) => {
    const m = line[i];
    const s = signal[i];
    return m === null || s === null ? null : m - s;
  });

  return { ok: true, macd: line, signal, histogram, required, provided: closes.length };
}

export interface BollingerResult {
  ok: true;
  middle: (number | null)[];
  upper: (number | null)[];
  lower: (number | null)[];
  required: number;
  provided: number;
}

/**
 * Bollinger Bands: SMA ± k standard deviations.
 *
 * POPULATION standard deviation (divide by n), which is what TradingView and
 * Wilder-era platforms use. The sample form (n−1) produces slightly wider bands
 * and would not match the chart a user compares against.
 */
export function bollinger(
  closes: number[],
  period = 20,
  multiplier = 2
): BollingerResult | { ok: false; reason: string; required: number; provided: number } {
  const required = REQUIRED_BARS.bollinger(period);
  if (closes.length < required) {
    return insufficient(`Bollinger(${period},${multiplier})`, required, closes.length) as {
      ok: false; reason: string; required: number; provided: number;
    };
  }

  const middle: (number | null)[] = new Array(closes.length).fill(null);
  const upper: (number | null)[] = new Array(closes.length).fill(null);
  const lower: (number | null)[] = new Array(closes.length).fill(null);

  for (let i = period - 1; i < closes.length; i++) {
    const win = closes.slice(i - period + 1, i + 1);
    const mean = win.reduce((a, b) => a + b, 0) / period;
    const variance = win.reduce((acc, v) => acc + (v - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    middle[i] = mean;
    upper[i] = mean + multiplier * sd;
    lower[i] = mean - multiplier * sd;
  }
  return { ok: true, middle, upper, lower, required, provided: closes.length };
}

/**
 * How many bars to REQUEST so an indicator has a valid value across the whole
 * visible window — the lookback buffer.
 *
 * This is the arithmetic behind showing a real EMA-200 on a 1-day chart. The
 * viewport shows `visibleBars`; the indicator needs `required` bars of history
 * BEFORE the first visible one, so the fetch must cover both. Without it a 1D
 * chart can only ever show indicators shorter than the day.
 */
export function lookbackFor(visibleBars: number, required: number): number {
  return Math.max(visibleBars + required - 1, required);
}
