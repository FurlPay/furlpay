import { describe, expect, it } from "vitest";
import { deriveCandles, isPlausibleSeries } from "../candles";

// ---------------------------------------------------------------------------
// Regression: the portfolio card printed "H $2,476,953.80" against a $19,448
// portfolio (127x). Cause: /api/markets/bars is a market feed; asked for a
// stablecoin symbol it can answer with an unrelated instrument or a near-zero
// first close. normalizeCloses() divides by that first close, so the normalized
// series peaked in the thousands and the card multiplied it by net worth.
// isPlausibleSeries() is the gate that now rejects it.
// ---------------------------------------------------------------------------

describe("isPlausibleSeries", () => {
  it("accepts a normal portfolio walk", () => {
    expect(isPlausibleSeries([1, 1.02, 0.99, 1.05, 1.01])).toBe(true);
  });

  it("accepts a violent but real move (5x)", () => {
    expect(isPlausibleSeries([1, 2, 3, 5])).toBe(true);
  });

  it("rejects the near-zero-divisor explosion that caused the $2.4M high", () => {
    // normalizeCloses(closes) where the first positive close was ~0.
    expect(isPlausibleSeries([1, 40, 900, 2500])).toBe(false);
  });

  it("rejects non-finite and non-positive values", () => {
    expect(isPlausibleSeries([1, Number.NaN, 1.1])).toBe(false);
    expect(isPlausibleSeries([1, Infinity])).toBe(false);
    expect(isPlausibleSeries([1, 0, 1.1])).toBe(false);
    expect(isPlausibleSeries([1, -3])).toBe(false);
  });

  it("rejects series too short to chart", () => {
    expect(isPlausibleSeries([])).toBe(false);
    expect(isPlausibleSeries([1])).toBe(false);
  });
});

describe("deriveCandles", () => {
  const times = Array.from({ length: 64 }, (_, i) => 1_700_000_000_000 + i * 60_000);
  const series = Array.from({ length: 64 }, (_, i) => 1 + Math.sin(i / 5) * 0.05);

  it("produces the requested bucket count", () => {
    expect(deriveCandles(series, times, 8)).toHaveLength(8);
    expect(deriveCandles(series, times, 22)).toHaveLength(22);
  });

  it("keeps the book continuous — each open equals the previous close", () => {
    const candles = deriveCandles(series, times, 10);
    for (let i = 1; i < candles.length; i++) {
      expect(candles[i].o).toBe(candles[i - 1].c);
    }
  });

  it("maintains the OHLC invariant low <= min(o,c) <= max(o,c) <= high", () => {
    for (const c of deriveCandles(series, times, 12)) {
      expect(c.l).toBeLessThanOrEqual(Math.min(c.o, c.c));
      expect(c.h).toBeGreaterThanOrEqual(Math.max(c.o, c.c));
      expect(c.l).toBeLessThanOrEqual(c.h);
    }
  });

  it("closes the final candle on the series' last value", () => {
    const candles = deriveCandles(series, times, 10);
    expect(candles[candles.length - 1].c).toBe(series[series.length - 1]);
  });

  it("never emits more buckets than samples", () => {
    expect(deriveCandles([1, 1.1, 1.2], times, 22)).toHaveLength(3);
  });

  it("returns nothing chartable for a degenerate series", () => {
    expect(deriveCandles([], times)).toEqual([]);
    expect(deriveCandles([1], times)).toEqual([]);
  });

  it("carries a timestamp on every candle", () => {
    for (const c of deriveCandles(series, times, 8)) {
      expect(Number.isFinite(c.t)).toBe(true);
    }
  });
});
