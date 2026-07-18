// ---------------------------------------------------------------------------
// OHLC derivation + series sanitation for the portfolio card.
//
// The popup renders the same portfolio index two ways — a line (glanceable)
// and candles (structure: where it opened, how far it ranged, where it closed).
// Both read from ONE normalized series, so switching chart type can never show
// two different stories about the same money.
// ---------------------------------------------------------------------------

export interface Candle {
  /** Bucket end time, epoch ms. */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

/**
 * Largest high/low ratio a single window may contain before we treat the
 * series as garbage rather than data.
 *
 * This exists because of a real defect: `normalizeCloses()` divides every close
 * by the FIRST POSITIVE close, and `/api/markets/bars` is a stock/market feed —
 * asked for a stablecoin symbol it can answer with an unrelated instrument or a
 * near-zero opening close. Dividing by ~0 produced a normalized series peaking
 * in the thousands, which the portfolio card then multiplied by net worth and
 * printed as "H $2,476,953.80" against a $19,448 portfolio. A 20x intraday
 * swing in a stablecoin-heavy portfolio is not a market move, it is bad data.
 */
const MAX_WINDOW_RATIO = 20;

/** Is this series usable as a portfolio index? Rejects NaN/Inf/non-positive
 *  values and implausible ranges, so one bad feed can't blow out the axis. */
export function isPlausibleSeries(series: number[]): boolean {
  if (series.length < 2) return false;
  let min = Infinity;
  let max = -Infinity;
  for (const v of series) {
    if (!Number.isFinite(v) || v <= 0) return false;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return max / min <= MAX_WINDOW_RATIO;
}

/**
 * Aggregate a per-point value series into OHLC buckets.
 *
 * Each candle OPENS at the previous candle's close (a continuous book, the way
 * a real chart reads) rather than at its own first sample — otherwise adjacent
 * candles show visual gaps that imply price jumps that never happened.
 */
export function deriveCandles(series: number[], times: number[], buckets = 22): Candle[] {
  if (series.length < 2) return [];
  const n = Math.max(2, Math.min(buckets, series.length));
  const width = series.length / n;
  const out: Candle[] = [];

  for (let i = 0; i < n; i++) {
    const start = Math.floor(i * width);
    const end = Math.max(start + 1, Math.floor((i + 1) * width));
    const slice = series.slice(start, end);
    if (slice.length === 0) continue;

    const close = slice[slice.length - 1];
    const open = out.length === 0 ? slice[0] : out[out.length - 1].c;
    let high = Math.max(open, close);
    let low = Math.min(open, close);
    for (const v of slice) {
      if (v > high) high = v;
      if (v < low) low = v;
    }
    const tIdx = Math.min(times.length - 1, end - 1);
    out.push({ t: times[tIdx] ?? Date.now(), o: open, h: high, l: low, c: close });
  }
  return out;
}
