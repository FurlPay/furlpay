// Robust statistics for "is this transaction unusual?"
//
// Median and MAD rather than mean and standard deviation, because Bitcoin
// value distributions are heavy-tailed in a way that breaks the usual tools.
// Measured on block 966016: 4,552 transactions, of which one moved 2,437 BTC
// and the median moved about 0.004 BTC. A mean and a standard deviation
// computed over that block are both dominated by the single largest
// transaction, so the next 2,000 BTC transaction scores as *less* unusual than
// a 50 BTC one would have before it. The median does not move, and the MAD
// moves only with the bulk of the distribution.
//
// The scale factor 1.4826 makes MAD a consistent estimator of the standard
// deviation for normally distributed data, which keeps the resulting z-scores
// interpretable on the usual scale even though the input is not normal.

export const MAD_SCALE = 1.4826;

export interface Baseline {
  metric: string;
  median: number;
  mad: number;
  p95: number | null;
  p99: number | null;
  samples: number;
  updatedAt: number;
}

/** Median of a numeric sample. Returns null for an empty one. */
export function median(xs: readonly number[]): number | null {
  const v = xs.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}

/** Percentile by nearest rank, `p` in 0..1. */
export function percentile(xs: readonly number[], p: number): number | null {
  const v = xs.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!v.length) return null;
  const idx = Math.min(v.length - 1, Math.max(0, Math.ceil(p * v.length) - 1));
  return v[idx]!;
}

/** Median absolute deviation from the median. */
export function mad(xs: readonly number[], med?: number): number | null {
  const m = med ?? median(xs);
  if (m === null) return null;
  return median(xs.filter(Number.isFinite).map((x) => Math.abs(x - m)));
}

/**
 * Where `x` sits in the distribution, in robust standard deviations.
 *
 * A MAD of zero is the case that matters and the one a naive implementation
 * divides by: it happens whenever more than half the sample is identical,
 * which for Bitcoin fee rates is routine — most of a block pays the same
 * floor rate. Returning null there is correct; the honest statement is "this
 * metric has no spread to measure against", not "infinitely unusual".
 */
export function robustZ(x: number, b: Pick<Baseline, "median" | "mad">): number | null {
  if (!Number.isFinite(x)) return null;
  const scale = b.mad * MAD_SCALE;
  if (!Number.isFinite(scale) || scale <= 0) return null;
  return (x - b.median) / scale;
}

/** Build a baseline from a sample. Null when the sample is too small to mean anything. */
export function buildBaseline(
  metric: string,
  xs: readonly number[],
  minSamples = 30,
): Baseline | null {
  const v = xs.filter(Number.isFinite);
  if (v.length < minSamples) return null;
  const med = median(v)!;
  return {
    metric,
    median: med,
    mad: mad(v, med) ?? 0,
    p95: percentile(v, 0.95),
    p99: percentile(v, 0.99),
    samples: v.length,
    updatedAt: Date.now(),
  };
}

/**
 * The share of a sample at or below `x`, as a percentile in 0..100.
 *
 * Reported alongside a z-score because a percentile is what a reader can
 * actually act on — "99.4th percentile" is a claim about this population, and
 * unlike a z-score it stays meaningful when the distribution is not normal.
 */
export function percentileOf(x: number, sorted: readonly number[]): number | null {
  if (!sorted.length || !Number.isFinite(x)) return null;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! <= x) lo = mid + 1;
    else hi = mid;
  }
  return (lo / sorted.length) * 100;
}

/**
 * How far `x` sits from a baseline, with a fallback for zero-spread history.
 *
 * THE HOLE THIS CLOSES. `robustZ` returns null when MAD is zero, which is
 * correct — there is no spread to measure against. But every caller then
 * treated null as "nothing to report", and a perfectly regular address has a
 * MAD of zero on every metric. So an address that always spends 0.05 BTC,
 * always 300 days apart, went SILENT on all its own detectors: dormancy,
 * amount and drain each found no spread, returned null, and the address became
 * undetectable no matter what it did next.
 *
 * That is an evasion strategy, not an edge case. Behave with perfect
 * regularity and you disappear from address-relative detection entirely.
 *
 * A zero-spread history is not an absence of information — it is the strongest
 * possible statement about what an address does. "Always exactly X" makes
 * "suddenly Y" maximally surprising, not unmeasurable. So when MAD is zero the
 * deviation is measured as a RATIO against the median instead, and the result
 * is labelled with which method produced it so callers can report it honestly
 * and weight it accordingly.
 */
export interface Deviation {
  /** Deviation in robust standard deviations, or ratio-multiples. */
  score: number;
  method: "mad" | "ratio" | "none";
  /** How far above the median, as a multiple. Null when the median is zero. */
  multiple: number | null;
}

export function deviationFrom(
  x: number,
  b: Pick<Baseline, "median" | "mad">,
): Deviation | null {
  if (!Number.isFinite(x)) return null;
  const z = robustZ(x, b);
  if (z !== null) {
    return {
      score: z,
      method: "mad",
      multiple: b.median !== 0 ? x / b.median : null,
    };
  }
  // No spread. Fall back to relative distance from the median.
  if (!Number.isFinite(b.median)) return null;
  if (b.median === 0) {
    // A history of exact zeros; any non-zero value is a departure but there is
    // no scale to express it on, so report presence rather than magnitude.
    return x === 0 ? null : { score: 1, method: "ratio", multiple: null };
  }
  const multiple = x / b.median;
  if (!Number.isFinite(multiple) || multiple === 1) return null;
  // Log-scaled so 2x and 200x are ordered but neither runs away. Signed so a
  // value far BELOW an invariant history is also a departure.
  return { score: Math.log2(Math.abs(multiple)), method: "ratio", multiple };
}

/**
 * Share of a sample STRICTLY GREATER than `x`, as a fraction in 0..1.
 *
 * The correct tail test for a discrete, concentrated distribution — and two
 * wrong ones were measured before this existed.
 *
 * Bitcoin input counts are the worked example: 99% of transactions have exactly
 * one input, so the sample is almost entirely a single value.
 *
 *   Comparing against the p99 VALUE fails, because that value is 1, and
 *   "nIn > 1" admits every multi-input transaction — 63% of a real block.
 *
 *   Ranking with `percentileOf` fails in the opposite direction, because it
 *   counts values <= x, so nIn = 1 already ranks at the 99th percentile and
 *   everything is admitted — 100% of a real block.
 *
 * Exceedance answers the question actually being asked: how much of the chain
 * is doing MORE of this than the transaction in hand? A value at the mode has
 * a large exceedance and is unremarkable; a genuine outlier has almost none.
 */
export function exceedanceFraction(x: number, sorted: readonly number[]): number | null {
  if (!sorted.length || !Number.isFinite(x)) return null;
  // First index holding a value strictly greater than x.
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! <= x) lo = mid + 1;
    else hi = mid;
  }
  return (sorted.length - lo) / sorted.length;
}

/**
 * Map an unbounded z-score onto 0..1 with a soft knee.
 *
 * A linear map would let one extreme metric saturate the whole score, and a
 * hard clamp would make everything past the threshold look identical — a
 * 2,400 BTC transaction and a 250 BTC one would both read "maximum". The
 * logistic keeps them ordered while bounding the contribution.
 */
export function squash(z: number | null, knee = 3): number {
  if (z === null || !Number.isFinite(z)) return 0;
  if (z <= 0) return 0;
  return 1 / (1 + Math.exp(-(z - knee) / (knee / 2)));
}

/**
 * Shannon entropy of a value distribution, normalised to 0..1.
 *
 * Used on transaction outputs. A payment with one recipient and one change
 * output has low entropy; a payout batch spreading value evenly across two
 * hundred outputs has high entropy. Normalising by log(n) makes the figure
 * comparable across transactions with different output counts, which the raw
 * entropy is not.
 */
export function normalisedEntropy(values: readonly number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x) && x > 0);
  if (v.length < 2) return null;
  const total = v.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  let h = 0;
  for (const x of v) {
    const p = x / total;
    h -= p * Math.log(p);
  }
  const max = Math.log(v.length);
  return max > 0 ? h / max : null;
}
