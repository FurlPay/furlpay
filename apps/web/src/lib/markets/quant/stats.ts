// ---------------------------------------------------------------------------
// Statistics for evaluating a strategy, built so they can say "this is noise".
//
// Three of the functions here exist specifically to deflate results:
//
// NEWEY-WEST STANDARD ERRORS. Predicting a 20-day forward return from daily
// observations means consecutive residuals share 19 of their 20 days. They are
// heavily autocorrelated, ordinary standard errors are far too small, and the
// t-statistics that follow are inflated — often by a factor of three or more.
// A "significant" macro predictor at h=20 with naive errors is the single most
// common false positive in this literature. HAC errors are the default here and
// the lag is tied to the horizon.
//
// BLOCK BOOTSTRAP. Resampling daily returns independently destroys the serial
// structure that produces drawdowns, so an i.i.d. bootstrap makes every
// strategy look safer than it is. Blocks preserve it.
//
// PLACEBO BY CIRCULAR BLOCK SHUFFLE. The question a placebo answers is not
// "is the Sharpe positive" but "is it larger than what this same machinery
// produces on a factor with identical statistical properties and no real
// timing". Shuffling in blocks keeps the distribution and most of the
// autocorrelation while destroying the alignment with gold.
// ---------------------------------------------------------------------------

export interface OlsResult {
  /** Coefficients, intercept first. */
  beta: number[];
  /** Standard errors matching `beta`. */
  se: number[];
  tStat: number[];
  rSquared: number;
  adjRSquared: number;
  n: number;
  k: number;
  /** True when HAC (Newey-West) errors were used. */
  hac: boolean;
}

/** Solve a symmetric linear system by Gauss-Jordan with partial pivoting.
 *  Returns null for a singular matrix rather than a set of huge numbers. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    if (Math.abs(M[piv]![col]!) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv]!, M[col]!];
    const p = M[col]![col]!;
    for (let c = col; c <= n; c++) M[col]![c]! /= p;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r]![col]!;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r]![c]! -= f * M[col]![c]!;
    }
  }
  return M.map((row) => row[n]!);
}

/**
 * Ordinary least squares of y on [1, X...].
 *
 * `hacLag` > 0 selects Newey-West standard errors with that many lags. For an
 * h-day overlapping forward return, h-1 is the conventional minimum; passing 0
 * gives classical errors, which are wrong for overlapping horizons and are
 * offered only so the difference can be shown.
 */
export function ols(
  y: readonly number[],
  X: readonly (readonly number[])[],
  hacLag = 0
): OlsResult | null {
  const n = y.length;
  if (n === 0 || X.length !== n) return null;
  const k = (X[0]?.length ?? 0) + 1;
  if (n <= k + 1) return null;

  const design = X.map((row) => [1, ...row]);
  // X'X and X'y
  const XtX: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
  const Xty: number[] = new Array(k).fill(0);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < k; a++) {
      Xty[a]! += design[i]![a]! * y[i]!;
      for (let b = 0; b < k; b++) XtX[a]![b]! += design[i]![a]! * design[i]![b]!;
    }
  }
  const beta = solve(XtX.map((r) => [...r]), [...Xty]);
  if (!beta) return null;

  const resid: number[] = [];
  for (let i = 0; i < n; i++) {
    let f = 0;
    for (let a = 0; a < k; a++) f += beta[a]! * design[i]![a]!;
    resid.push(y[i]! - f);
  }

  const ybar = y.reduce((a, b) => a + b, 0) / n;
  const ssTot = y.reduce((a, b) => a + (b - ybar) ** 2, 0);
  const ssRes = resid.reduce((a, b) => a + b * b, 0);
  const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  // (X'X)^-1, needed for both error types.
  const inv: number[][] = [];
  for (let c = 0; c < k; c++) {
    const e = new Array(k).fill(0);
    e[c] = 1;
    const col = solve(XtX.map((r) => [...r]), e);
    if (!col) return null;
    inv.push(col);
  }
  // `inv` is currently column-major; transpose to row-major.
  const XtXinv: number[][] = Array.from({ length: k }, (_, a) =>
    Array.from({ length: k }, (_, b) => inv[b]![a]!)
  );

  let varBeta: number[];
  if (hacLag > 0) {
    // Newey-West meat: S = Σ_j w_j (Γ_j + Γ_j'), w_j = 1 - j/(L+1).
    const S: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
    for (let i = 0; i < n; i++) {
      for (let a = 0; a < k; a++)
        for (let b = 0; b < k; b++)
          S[a]![b]! += resid[i]! * resid[i]! * design[i]![a]! * design[i]![b]!;
    }
    for (let lag = 1; lag <= hacLag; lag++) {
      const w = 1 - lag / (hacLag + 1);
      for (let i = lag; i < n; i++) {
        for (let a = 0; a < k; a++) {
          for (let b = 0; b < k; b++) {
            const g = resid[i]! * resid[i - lag]! * design[i]![a]! * design[i - lag]![b]!;
            S[a]![b]! += w * (g + resid[i - lag]! * resid[i]! * design[i - lag]![a]! * design[i]![b]!);
          }
        }
      }
    }
    // Sandwich: (X'X)^-1 S (X'X)^-1
    const mid: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
    for (let a = 0; a < k; a++)
      for (let b = 0; b < k; b++)
        for (let c = 0; c < k; c++) mid[a]![b]! += XtXinv[a]![c]! * S[c]![b]!;
    varBeta = Array.from({ length: k }, (_, a) => {
      let v = 0;
      for (let c = 0; c < k; c++) v += mid[a]![c]! * XtXinv[c]![a]!;
      return v;
    });
  } else {
    const sigma2 = ssRes / (n - k);
    varBeta = Array.from({ length: k }, (_, a) => sigma2 * XtXinv[a]![a]!);
  }

  const se = varBeta.map((v) => (v > 0 ? Math.sqrt(v) : NaN));
  return {
    beta,
    se,
    tStat: beta.map((b, i) => (Number.isFinite(se[i]!) && se[i]! > 0 ? b / se[i]! : NaN)),
    rSquared,
    adjRSquared: 1 - (1 - rSquared) * ((n - 1) / (n - k)),
    n,
    k,
    hac: hacLag > 0,
  };
}

/** Annualized Sharpe of a per-bar return series. */
export function sharpeOf(returns: readonly number[], periodsPerYear = 252): number | null {
  if (returns.length < 20) return null;
  const m = returns.reduce((a, b) => a + b, 0) / returns.length;
  const v = returns.reduce((a, b) => a + (b - m) ** 2, 0) / (returns.length - 1);
  const sd = Math.sqrt(v);
  // Not `sd === 0`. Summing a constant series in floating point leaves a
  // residual around 1e-19 rather than exactly zero, and dividing by that
  // returns a Sharpe in the tens of millions — a spectacular number produced
  // by a series that never moved. Scale the tolerance to the mean.
  const scale = Math.max(Math.abs(m), 1e-12);
  if (!(sd > scale * 1e-9)) return null;
  return (m * periodsPerYear) / (sd * Math.sqrt(periodsPerYear));
}

/** Deterministic PRNG, so every experiment in this repo is reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface BootstrapCI {
  mean: number;
  lower: number;
  upper: number;
  /** Fraction of resamples at or below zero — a one-sided p-value analogue. */
  fractionBelowZero: number;
}

/**
 * Stationary block bootstrap of a statistic over a return series.
 *
 * Blocks rather than single observations: resampling days independently
 * destroys the autocorrelation that produces drawdowns and makes every
 * strategy look better behaved than it is.
 */
export function blockBootstrapSharpe(
  returns: readonly number[],
  iterations = 1000,
  blockSize = 20,
  seed = 42
): BootstrapCI | null {
  if (returns.length < 60) return null;
  const rnd = mulberry32(seed);
  const out: number[] = [];
  for (let it = 0; it < iterations; it++) {
    const sample: number[] = [];
    while (sample.length < returns.length) {
      const start = Math.floor(rnd() * returns.length);
      for (let j = 0; j < blockSize && sample.length < returns.length; j++) {
        sample.push(returns[(start + j) % returns.length]!);
      }
    }
    const s = sharpeOf(sample);
    if (s !== null) out.push(s);
  }
  if (out.length < 100) return null;
  out.sort((a, b) => a - b);
  return {
    mean: out.reduce((a, b) => a + b, 0) / out.length,
    lower: out[Math.floor(out.length * 0.025)]!,
    upper: out[Math.floor(out.length * 0.975)]!,
    fractionBelowZero: out.filter((v) => v <= 0).length / out.length,
  };
}

/**
 * Circular block shuffle: keeps the marginal distribution and most of the
 * within-block autocorrelation, destroys alignment with anything else.
 *
 * This is what a placebo factor should look like — same statistical character,
 * no real timing.
 */
export function circularBlockShuffle<T>(
  series: readonly T[],
  blockSize: number,
  rnd: () => number
): T[] {
  const n = series.length;
  const out: T[] = [];
  while (out.length < n) {
    const start = Math.floor(rnd() * n);
    for (let j = 0; j < blockSize && out.length < n; j++) out.push(series[(start + j) % n]!);
  }
  return out;
}

export interface PlaceboResult {
  actualSharpe: number;
  /** Sharpe of each shuffled run, sorted. */
  placeboMean: number;
  placeboP95: number;
  /** Fraction of placebo runs whose Sharpe is at least the actual one. This is
   *  the empirical p-value: small means the real result is hard to reach by
   *  chance with the same machinery. */
  percentileOfActual: number;
  pValue: number;
  iterations: number;
}

/** Run a strategy against shuffled factors and locate the real result inside
 *  the resulting distribution. */
export function placeboTest(
  actualSharpe: number,
  runShuffled: (rnd: () => number) => number | null,
  iterations = 1000,
  seed = 7
): PlaceboResult | null {
  const rnd = mulberry32(seed);
  const vals: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const s = runShuffled(rnd);
    if (s !== null && Number.isFinite(s)) vals.push(s);
  }
  if (vals.length < 100) return null;
  vals.sort((a, b) => a - b);
  const atLeast = vals.filter((v) => v >= actualSharpe).length;
  const below = vals.filter((v) => v < actualSharpe).length;
  return {
    actualSharpe,
    placeboMean: vals.reduce((a, b) => a + b, 0) / vals.length,
    placeboP95: vals[Math.floor(vals.length * 0.95)]!,
    percentileOfActual: below / vals.length,
    pValue: atLeast / vals.length,
    iterations: vals.length,
  };
}
