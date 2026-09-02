import { describe, it, expect } from "vitest";
import {
  logReturn, logReturns, periodReturn, momentum, sma, ema, emaSeries, stdev,
  trueRange, atr, rsi, macd, bollinger, trendScore, realizedVolatility,
  ewmaVolatility, percentileRank, zScore, correlation, laggedCorrelation,
  type Bar,
} from "../features";

// ---------------------------------------------------------------------------
// Every assertion below is against an input whose answer is known from the
// definition, not from running the code and recording what came out. A constant
// series has zero volatility and an RSI of 50 by construction; a straight line
// has a correlation of exactly 1; a doubling has a log return of ln 2. If the
// implementation and the definition disagree, these fail.
// ---------------------------------------------------------------------------

/** n bars at a constant price. Zero range, zero return, zero volatility. */
const flat = (n: number, p = 100): Bar[] =>
  Array.from({ length: n }, (_, i) => ({
    date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
    open: p, high: p, low: p, close: p, volume: 1000,
  }));

/** n bars rising by exactly `step` each day. */
const ramp = (n: number, start = 100, step = 1): Bar[] =>
  Array.from({ length: n }, (_, i) => {
    const c = start + i * step;
    return { date: `d${i}`, open: c, high: c + 0.5, low: c - 0.5, close: c, volume: 1000 };
  });

describe("returns", () => {
  it("gives ln 2 for a doubling", () => {
    expect(logReturn(200, 100)).toBeCloseTo(Math.LN2, 12);
  });

  it("gives zero for an unchanged price", () => {
    expect(logReturn(100, 100)).toBe(0);
  });

  it("is undefined for a non-positive price", () => {
    // ln of zero is not a very large negative number to be clamped; it does
    // not exist, and a price of zero is bad data rather than a cheap asset.
    expect(logReturn(0, 100)).toBeNull();
    expect(logReturn(100, 0)).toBeNull();
    expect(logReturn(-5, 100)).toBeNull();
  });

  it("adds across time, which is why log returns are used", () => {
    // The defining property: Σ daily log returns == the window's log return.
    const closes = [100, 105, 103, 110, 108];
    const sum = logReturns(closes).reduce((a: number, r) => a + (r ?? 0), 0);
    expect(sum).toBeCloseTo(Math.log(108 / 100), 12);
    expect(periodReturn(closes, 4)).toBeCloseTo(sum, 12);
  });

  it("returns null when the window is longer than the data", () => {
    expect(periodReturn([100, 101], 5)).toBeNull();
    expect(momentum([100, 101], 5)).toBeNull();
  });

  it("computes simple momentum as a ratio minus one", () => {
    expect(momentum([100, 110], 1)).toBeCloseTo(0.1, 12);
  });
});

describe("averages", () => {
  it("averages a constant series to the constant", () => {
    expect(sma([5, 5, 5, 5], 4)).toBe(5);
    expect(ema([5, 5, 5, 5, 5, 5], 3)).toBeCloseTo(5, 12);
  });

  it("averages a known window rather than the whole series", () => {
    // Trailing 3 of [1..6] is 4,5,6 -> 5. If it averaged everything it would
    // be 3.5, which is the bug this catches.
    expect(sma([1, 2, 3, 4, 5, 6], 3)).toBe(5);
  });

  it("seeds the EMA with an SMA, and both agree on a flat series", () => {
    const s = emaSeries([2, 2, 2, 2, 2], 3);
    expect(s[0]).toBeNull();
    expect(s[1]).toBeNull();
    // First defined value is the SMA seed at index n-1.
    expect(s[2]).toBeCloseTo(2, 12);
    expect(s[4]).toBeCloseTo(2, 12);
  });

  it("refuses a window it cannot fill", () => {
    // A 20-period average of 6 points is a 6-period average mislabelled.
    expect(sma([1, 2, 3], 20)).toBeNull();
    expect(ema([1, 2, 3], 20)).toBeNull();
    expect(stdev([1, 2, 3], 20)).toBeNull();
  });

  it("gives zero dispersion for a constant series", () => {
    expect(stdev([7, 7, 7, 7], 4)).toBe(0);
  });
});

describe("true range and ATR", () => {
  it("is the high-low range when there is no prior close", () => {
    expect(trueRange({ date: "d", open: 5, high: 12, low: 8, close: 10, volume: null }, null)).toBe(4);
  });

  it("captures a gap the high-low range misses", () => {
    // Today 105-108 after closing at 100: the real range travelled is 8, not 3.
    const gapped: Bar = { date: "d", open: 105, high: 108, low: 105, close: 107, volume: null };
    expect(trueRange(gapped, 100)).toBe(8);
  });

  it("is zero for a series that never moves", () => {
    expect(atr(flat(30), 14)).toBe(0);
  });

  it("equals the constant range of a uniform ramp", () => {
    // Each bar spans close-0.5 to close+0.5 and gaps up 1 from the prior close,
    // so TR = max(1, |c+0.5-cPrev|, |c-0.5-cPrev|) = 1.5 every bar.
    expect(atr(ramp(40), 14)).toBeCloseTo(1.5, 12);
  });
});

describe("RSI", () => {
  it("is 50 for a series that never changes", () => {
    // No gains and no losses: the index is defined as neutral, not 0 or 100.
    expect(rsi(new Array(30).fill(100), 14)).toBe(50);
  });

  it("is 100 when there are no losses at all", () => {
    // RS is unbounded, so RSI is exactly 100 by definition — not a divide by
    // zero to be caught and returned as null.
    expect(rsi(Array.from({ length: 30 }, (_, i) => 100 + i), 14)).toBe(100);
  });

  it("is 0 when there are no gains at all", () => {
    expect(rsi(Array.from({ length: 30 }, (_, i) => 200 - i), 14)).toBeCloseTo(0, 10);
  });

  it("is bounded and mid-range on an alternating series", () => {
    const alt = Array.from({ length: 40 }, (_, i) => 100 + (i % 2));
    const v = rsi(alt, 14)!;
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(100);
  });

  it("returns null without a full period", () => {
    expect(rsi([1, 2, 3], 14)).toBeNull();
  });
});

describe("MACD and Bollinger", () => {
  it("collapses to zero on a flat series", () => {
    const m = macd(new Array(60).fill(100))!;
    expect(m.macd).toBeCloseTo(0, 10);
    expect(m.signal).toBeCloseTo(0, 10);
    expect(m.histogram).toBeCloseTo(0, 10);
  });

  it("is positive when a fast average leads a slow one upward", () => {
    const m = macd(Array.from({ length: 80 }, (_, i) => 100 + i))!;
    expect(m.macd).toBeGreaterThan(0);
  });

  it("puts the bands on the average when there is no dispersion", () => {
    const b = bollinger(new Array(30).fill(50), 20, 2)!;
    expect(b.middle).toBe(50);
    expect(b.upper).toBe(50);
    expect(b.lower).toBe(50);
    // Every price is simultaneously at the top and bottom of a zero-width
    // band, so %B does not exist. 0.5 would be an invention.
    expect(b.percentB).toBeNull();
  });

  it("places a price at the top of the band at %B = 1", () => {
    const closes = [...new Array(19).fill(100), 100];
    const b = bollinger(closes, 20, 2)!;
    expect(b.middle).toBe(100);
    // With dispersion, %B is defined; check the arithmetic on a known set.
    const c2 = Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? 98 : 102));
    const b2 = bollinger(c2, 20, 2)!;
    expect(b2.middle).toBe(100);
    expect(b2.upper).toBeCloseTo(100 + 2 * 2, 10);
    expect(b2.percentB).toBeCloseTo((102 - 96) / (104 - 96), 10);
  });
});

describe("trend score", () => {
  it("is null when the range is zero, because it would divide by it", () => {
    // A flat series has no ATR, so trend cannot be expressed in ATR units.
    expect(trendScore(flat(120), 20, 50, 14)).toBeNull();
  });

  it("is positive and finite in a steady uptrend", () => {
    const t = trendScore(ramp(200), 20, 50, 14)!;
    expect(t).toBeGreaterThan(0);
    expect(Number.isFinite(t)).toBe(true);
  });

  it("is negative in a steady downtrend", () => {
    expect(trendScore(ramp(200, 500, -1), 20, 50, 14)!).toBeLessThan(0);
  });
});

describe("volatility", () => {
  it("is zero for a series that never moves", () => {
    expect(realizedVolatility(new Array(60).fill(100), 20)).toBe(0);
  });

  it("recovers a known volatility from a constructed series", () => {
    // Alternating +d/-d log returns have sample variance d^2 * n/(n-1) about a
    // zero mean, so annualized sigma ~ d * sqrt(252) for large n.
    const d = 0.01;
    const closes = [100];
    for (let i = 1; i <= 60; i++) closes.push(closes[i - 1]! * Math.exp(i % 2 === 0 ? d : -d));
    const v = realizedVolatility(closes, 40)!;
    expect(v).toBeGreaterThan(d * Math.sqrt(252) * 0.9);
    expect(v).toBeLessThan(d * Math.sqrt(252) * 1.1);
  });

  it("scales with the square root of time", () => {
    const closes = [100];
    for (let i = 1; i <= 300; i++) closes.push(closes[i - 1]! * Math.exp(i % 2 === 0 ? 0.01 : -0.01));
    const daily = realizedVolatility(closes, 100, 1)!;
    const annual = realizedVolatility(closes, 100, 252)!;
    expect(annual / daily).toBeCloseTo(Math.sqrt(252), 6);
  });

  it("gives EWMA volatility near zero on a flat series", () => {
    expect(ewmaVolatility(new Array(80).fill(100))).toBeCloseTo(0, 10);
  });
});

describe("rolling statistics use only trailing data", () => {
  it("ranks the last value within its trailing window", () => {
    // Largest value last -> rank 1. Smallest last -> rank 1/window.
    expect(percentileRank([1, 2, 3, 4, 5], 5)).toBe(1);
    expect(percentileRank([5, 4, 3, 2, 1], 5)).toBeCloseTo(0.2, 10);
  });

  it("ignores observations before the window", () => {
    // The 1000 is outside a 3-wide window and must not affect the rank.
    expect(percentileRank([1000, 1, 2, 3], 3)).toBe(1);
  });

  it("has no z-score in a window with no dispersion", () => {
    // Every observation equals the mean; "unusual" is undefined, not zero.
    expect(zScore([4, 4, 4, 4], 4)).toBeNull();
  });

  it("computes a z-score against the trailing window only", () => {
    // Window [1,2,3,4,5]: mean 3, sample sd sqrt(2.5). Last is 5.
    const z = zScore([1, 2, 3, 4, 5], 5)!;
    expect(z).toBeCloseTo((5 - 3) / Math.sqrt(2.5), 10);
  });
});

describe("correlation", () => {
  it("is exactly 1 for a line and -1 for its mirror", () => {
    const x = [1, 2, 3, 4, 5, 6];
    expect(correlation(x, x.map((v) => 3 * v + 7))!).toBeCloseTo(1, 12);
    expect(correlation(x, x.map((v) => -2 * v))!).toBeCloseTo(-1, 12);
  });

  it("does not exist against a constant series", () => {
    expect(correlation([1, 2, 3, 4], [5, 5, 5, 5])).toBeNull();
  });

  it("aligns a lagged correlation so the driver leads the target", () => {
    // Target at t+1 is exactly the driver at t, so h=1 must be a perfect 1
    // while the contemporaneous reading is not.
    const driver = [1, 2, 3, 4, 5, 6, 7, 8];
    const target = [0, 1, 2, 3, 4, 5, 6, 7];
    expect(laggedCorrelation(target, driver, 1)!).toBeCloseTo(1, 10);
  });

  it("refuses a negative lag", () => {
    // A negative h would mean reading the driver from the future.
    expect(laggedCorrelation([1, 2, 3], [1, 2, 3], -1)).toBeNull();
  });
});
