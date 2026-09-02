// ---------------------------------------------------------------------------
// Feature primitives. Pure functions over price series, no I/O, no state.
//
// Every function here is defined by an equation in the doc comment above it and
// tested against inputs whose correct answer is known analytically — a constant
// series, a straight line, a series with one known outlier — rather than
// against whatever the implementation happened to produce first. A feature
// engine that is tested only against its own output is a very confident way to
// be wrong.
//
// ── TWO RULES THAT SHAPE EVERY FUNCTION HERE ───────────────────────────────
//
// 1. NOT ENOUGH DATA RETURNS NULL, NEVER A PARTIAL ANSWER. A 20-day average
//    computed from 6 observations is not a 20-day average; it is a 6-day
//    average wearing the wrong label, and it will be compared against real
//    20-day averages downstream. Every window function returns null until it
//    has a full window.
//
// 2. NOTHING HERE LOOKS FORWARD. Each function reads a series up to and
//    including index t and never beyond it. This is the property that makes a
//    backtest meaningful, and it is easy to lose by accident — a rolling
//    z-score computed against the mean of the WHOLE series is the classic
//    version, and it produces beautiful results that cannot be traded.
// ---------------------------------------------------------------------------

export interface Bar {
  /** ISO date, exchange local. */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Null where the instrument has no volume concept. Never zero-filled. */
  volume: number | null;
}

/** Log return: r_t = ln(P_t / P_{t-1}).
 *
 * Log rather than simple returns because they add across time — the sum of
 * daily log returns over a window is exactly the window's log return, which
 * simple returns do not give you. Null for a non-positive price, where the
 * logarithm is undefined rather than merely awkward. */
export function logReturn(curr: number, prev: number): number | null {
  if (!(curr > 0) || !(prev > 0)) return null;
  return Math.log(curr / prev);
}

/** The series of log returns. Length is closes.length - 1. */
export function logReturns(closes: readonly number[]): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 1; i < closes.length; i++) out.push(logReturn(closes[i]!, closes[i - 1]!));
  return out;
}

/** k-period return: R_{t,k} = ln(P_t / P_{t-k}). Null without k+1 points. */
export function periodReturn(closes: readonly number[], k: number): number | null {
  if (k < 1 || closes.length < k + 1) return null;
  return logReturn(closes[closes.length - 1]!, closes[closes.length - 1 - k]!);
}

/** Simple momentum: M_k = P_t / P_{t-k} - 1. */
export function momentum(closes: readonly number[], k: number): number | null {
  if (k < 1 || closes.length < k + 1) return null;
  const prev = closes[closes.length - 1 - k]!;
  if (!(prev > 0)) return null;
  return closes[closes.length - 1]! / prev - 1;
}

/** Simple moving average: SMA_n = (1/n) Σ_{i=0}^{n-1} P_{t-i}. */
export function sma(values: readonly number[], n: number): number | null {
  if (n < 1 || values.length < n) return null;
  let s = 0;
  for (let i = values.length - n; i < values.length; i++) s += values[i]!;
  return s / n;
}

/** Exponential moving average, seeded with the SMA of the first n values.
 *
 *   α = 2/(n+1),  EMA_t = αP_t + (1-α)EMA_{t-1}
 *
 * The seed matters and is a common source of quiet disagreement between
 * implementations: seeding with the first price instead of the first SMA gives
 * a different series for hundreds of bars. This uses the SMA seed, which is the
 * convention the RSI and MACD definitions below assume. */
export function ema(values: readonly number[], n: number): number | null {
  if (n < 1 || values.length < n) return null;
  const alpha = 2 / (n + 1);
  let e = sma(values.slice(0, n), n)!;
  for (let i = n; i < values.length; i++) e = alpha * values[i]! + (1 - alpha) * e;
  return e;
}

/** The full EMA series, aligned to `values` with nulls before the seed. */
export function emaSeries(values: readonly number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (n < 1 || values.length < n) return out;
  const alpha = 2 / (n + 1);
  let e = sma(values.slice(0, n), n)!;
  out[n - 1] = e;
  for (let i = n; i < values.length; i++) {
    e = alpha * values[i]! + (1 - alpha) * e;
    out[i] = e;
  }
  return out;
}

/** Population standard deviation over the trailing n values. */
export function stdev(values: readonly number[], n: number): number | null {
  if (n < 2 || values.length < n) return null;
  const w = values.slice(values.length - n);
  const m = w.reduce((a, b) => a + b, 0) / n;
  const v = w.reduce((a, b) => a + (b - m) ** 2, 0) / n;
  return Math.sqrt(v);
}

/** True range:
 *
 *   TR_t = max(High_t - Low_t, |High_t - Close_{t-1}|, |Low_t - Close_{t-1}|)
 *
 * The second and third terms are what make it a TRUE range: they capture a gap
 * between sessions, which High-Low alone misses entirely. */
export function trueRange(bar: Bar, prevClose: number | null): number {
  const hl = bar.high - bar.low;
  if (prevClose === null) return hl;
  return Math.max(hl, Math.abs(bar.high - prevClose), Math.abs(bar.low - prevClose));
}

/** Average true range over n bars, as a simple mean of true ranges. */
export function atr(bars: readonly Bar[], n: number): number | null {
  if (n < 1 || bars.length < n + 1) return null;
  const trs: number[] = [];
  for (let i = bars.length - n; i < bars.length; i++) {
    trs.push(trueRange(bars[i]!, bars[i - 1]?.close ?? null));
  }
  return trs.reduce((a, b) => a + b, 0) / n;
}

/** Wilder's RSI over n periods.
 *
 *   RS = AverageGain / AverageLoss,  RSI = 100 - 100/(1 + RS)
 *
 * Averages are Wilder-smoothed, not simple means: the first is a simple mean of
 * the first n changes and each subsequent one is
 * ((n-1) * prev + current) / n. A simple-mean RSI is a different indicator with
 * the same name, and the two disagree materially in a trend.
 *
 * With no losses at all, RS is unbounded and RSI is exactly 100. That is the
 * defined value, not a division-by-zero to be papered over. */
export function rsi(closes: readonly number[], n = 14): number | null {
  if (n < 1 || closes.length < n + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i]! - closes[i - 1]!;
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / n;
  let avgLoss = loss / n;
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i]! - closes[i - 1]!;
    avgGain = (avgGain * (n - 1) + Math.max(d, 0)) / n;
    avgLoss = (avgLoss * (n - 1) + Math.max(-d, 0)) / n;
  }
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export interface Macd {
  macd: number;
  signal: number;
  histogram: number;
}

/** MACD = EMA_fast - EMA_slow, signal = EMA of the MACD line. */
export function macd(
  closes: readonly number[],
  fast = 12,
  slow = 26,
  signalN = 9
): Macd | null {
  if (closes.length < slow + signalN) return null;
  const f = emaSeries(closes, fast);
  const s = emaSeries(closes, slow);
  const line: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (f[i] === null || s[i] === null) continue;
    line.push(f[i]! - s[i]!);
  }
  if (line.length < signalN) return null;
  const sig = ema(line, signalN);
  if (sig === null) return null;
  const m = line[line.length - 1]!;
  return { macd: m, signal: sig, histogram: m - sig };
}

export interface Bollinger {
  middle: number;
  upper: number;
  lower: number;
  /** Where the last close sits in the band: 0 at the lower, 1 at the upper. */
  percentB: number | null;
  /** Band width relative to the middle — a volatility-compression measure. */
  bandwidth: number | null;
}

/** Bollinger bands: middle = SMA_n, upper/lower = SMA_n ± kσ_n. */
export function bollinger(closes: readonly number[], n = 20, k = 2): Bollinger | null {
  const middle = sma(closes, n);
  const sd = stdev(closes, n);
  if (middle === null || sd === null) return null;
  const upper = middle + k * sd;
  const lower = middle - k * sd;
  const last = closes[closes.length - 1]!;
  return {
    middle,
    upper,
    lower,
    // A zero-width band means every price is at once at the top and the bottom
    // of it. Undefined, not 0.5.
    percentB: upper === lower ? null : (last - lower) / (upper - lower),
    bandwidth: middle === 0 ? null : (upper - lower) / middle,
  };
}

/** Trend strength in units of ATR: (EMA_fast - EMA_slow) / ATR_n.
 *
 * Dividing by ATR is what makes this comparable across instruments and across
 * time. A 20-dollar gap between averages means something very different in gold
 * at $4,380 than in silver at $65, and something different again in gold when
 * daily ranges are $20 versus $80. */
export function trendScore(
  bars: readonly Bar[],
  fast = 20,
  slow = 50,
  atrN = 14
): number | null {
  const closes = bars.map((b) => b.close);
  const f = ema(closes, fast);
  const s = ema(closes, slow);
  const a = atr(bars, atrN);
  if (f === null || s === null || a === null || a === 0) return null;
  return (f - s) / a;
}

/** Annualized realized volatility: σ = sqrt(periodsPerYear * Var(r)).
 *
 * Variance is taken about the sample mean. Some desks assume a zero mean for
 * short horizons; over a 20-day window on a trending instrument that
 * assumption inflates the estimate, so the mean is subtracted here. */
export function realizedVolatility(
  closes: readonly number[],
  n: number,
  periodsPerYear = 252
): number | null {
  if (closes.length < n + 1) return null;
  const rs: number[] = [];
  for (let i = closes.length - n; i < closes.length; i++) {
    const r = logReturn(closes[i]!, closes[i - 1]!);
    if (r === null) return null;
    rs.push(r);
  }
  const m = rs.reduce((a, b) => a + b, 0) / rs.length;
  const v = rs.reduce((a, b) => a + (b - m) ** 2, 0) / (rs.length - 1);
  return Math.sqrt(v * periodsPerYear);
}

/** EWMA volatility: σ²_t = λσ²_{t-1} + (1-λ)r²_t, annualized.
 *
 * λ = 0.94 is the RiskMetrics daily convention. Seeded with the sample variance
 * of the first ten returns rather than with zero, which would take dozens of
 * observations to decay away and understate volatility throughout. */
export function ewmaVolatility(
  closes: readonly number[],
  lambda = 0.94,
  periodsPerYear = 252
): number | null {
  const rs = logReturns(closes).filter((r): r is number => r !== null);
  if (rs.length < 11) return null;
  const seed = rs.slice(0, 10);
  const m = seed.reduce((a, b) => a + b, 0) / seed.length;
  let v = seed.reduce((a, b) => a + (b - m) ** 2, 0) / (seed.length - 1);
  for (let i = 10; i < rs.length; i++) v = lambda * v + (1 - lambda) * rs[i]! ** 2;
  return Math.sqrt(v * periodsPerYear);
}

/** Percentile rank of the last value within a trailing window, in [0,1].
 *
 * Strictly trailing: the window ends at the last observation and the rank is
 * the fraction of the window at or below it. Ranking against a window that
 * includes future observations is the single most common way a backtest is
 * accidentally made to look good. */
export function percentileRank(values: readonly number[], window: number): number | null {
  if (values.length < window || window < 2) return null;
  const w = values.slice(values.length - window);
  const last = w[w.length - 1]!;
  const below = w.filter((v) => v <= last).length;
  return below / w.length;
}

/** Rolling z-score: (x_t - μ_window) / σ_window, using only trailing data. */
export function zScore(values: readonly number[], window: number): number | null {
  if (values.length < window || window < 2) return null;
  const w = values.slice(values.length - window);
  const m = w.reduce((a, b) => a + b, 0) / w.length;
  const v = w.reduce((a, b) => a + (b - m) ** 2, 0) / (w.length - 1);
  const sd = Math.sqrt(v);
  // A constant window has no dispersion, so no observation is unusual in it.
  // Returning 0 would be a claim; null says the statistic does not exist here.
  if (sd === 0) return null;
  return (w[w.length - 1]! - m) / sd;
}

/** Pearson correlation of two equal-length series. */
export function correlation(a: readonly number[], b: readonly number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;
  const x = a.slice(a.length - n);
  const y = b.slice(b.length - n);
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i]! - mx;
    const dy = y[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

/** Correlation of gold returns at t+h against a driver at t.
 *
 * `h = 0` is contemporaneous. A non-zero h is the only version with any
 * predictive content, and it is almost always far weaker than the
 * contemporaneous number that gets quoted. Reporting the contemporaneous
 * correlation and implying the lagged one is a standard sleight of hand. */
export function laggedCorrelation(
  target: readonly number[],
  driver: readonly number[],
  h: number
): number | null {
  if (h < 0) return null;
  if (h === 0) return correlation(target, driver);
  const n = Math.min(target.length, driver.length);
  if (n <= h + 3) return null;
  // driver at t against target at t+h
  const d = driver.slice(0, n - h);
  const t = target.slice(h, n);
  return correlation(t, d);
}
