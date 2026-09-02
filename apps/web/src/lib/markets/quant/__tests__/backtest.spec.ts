import { describe, it, expect } from "vitest";
import { runBacktest, walkForward } from "../backtest";
import type { Bar } from "../features";

// ---------------------------------------------------------------------------
// A backtester is only useful if it can be trusted to report a loss. These
// tests are built around inputs whose correct result is known in advance:
// a perfectly known future must be profitable, a costed churn must lose, and a
// strategy fed tomorrow's answer must look impossibly good — which is how the
// look-ahead check works.
// ---------------------------------------------------------------------------

/** Deterministic alternating series: +1% then -1% (approximately). */
const zigzag = (n: number, start = 100): Bar[] => {
  const out: Bar[] = [];
  let p = start;
  for (let i = 0; i < n; i++) {
    out.push({ date: `d${String(i).padStart(4, "0")}`, open: p, high: p * 1.01, low: p * 0.99, close: p, volume: 1 });
    p = i % 2 === 0 ? p * 1.01 : p / 1.01;
  }
  return out;
};

const ramp = (n: number, daily = 0.001): Bar[] => {
  const out: Bar[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    out.push({ date: `d${String(i).padStart(4, "0")}`, open: p, high: p, low: p, close: p, volume: 1 });
    p *= 1 + daily;
  }
  return out;
};

const NO_COST = { costPerUnitTurnover: 0 };

describe("alignment", () => {
  it("earns the NEXT bar's return, never the current one", () => {
    // Long only on the final bar. That position has no following bar, so it
    // can earn nothing. If the engine paid it the current bar's return, this
    // would be non-zero — the classic look-ahead bug.
    const bars = ramp(50);
    const pos = bars.map((_, i) => (i === bars.length - 1 ? 1 : 0));
    const r = runBacktest(bars, pos, NO_COST)!;
    expect(r.trades.every((t) => t.netReturn === 0)).toBe(true);
  });

  it("pays a one-bar position exactly the following bar's return", () => {
    const bars = ramp(50, 0.001);
    const pos = bars.map((_, i) => (i === 0 ? 1 : 0));
    const r = runBacktest(bars, pos, NO_COST)!;
    expect(r.trades[0]!.netReturn).toBeCloseTo(0.001, 10);
    expect(r.trades[1]!.netReturn).toBe(0);
  });

  it("makes perfect foresight look impossibly good, as a canary", () => {
    // Position set from the NEXT bar's actual move. Any real strategy scoring
    // like this has a look-ahead bug.
    const bars = zigzag(200);
    const cheat = bars.map((b, i) =>
      i + 1 < bars.length ? (bars[i + 1]!.close > b.close ? 1 : -1) : 0
    );
    const r = runBacktest(bars, cheat, NO_COST)!;
    expect(r.sharpe!).toBeGreaterThan(5);
    expect(r.hitRate!).toBeCloseTo(1, 6);
  });
});

describe("costs", () => {
  it("charges nothing for holding and something for trading", () => {
    const bars = ramp(100);
    const held = runBacktest(bars, bars.map(() => 1), { costPerUnitTurnover: 0.001 })!;
    // One entry at the first bar, then no further turnover.
    expect(held.totalCostDrag).toBeCloseTo(0.001, 10);
    expect(held.turnover).toBeCloseTo(1 / held.trades.length, 10);
  });

  it("turns a flat-market churn into a loss", () => {
    // Alternating position in a market that goes nowhere: gross zero, net
    // negative by exactly the cost. A backtest that reports this as breakeven
    // is not modelling costs.
    const bars = ramp(200, 0);
    const churn = bars.map((_, i) => (i % 2 === 0 ? 1 : 0));
    const r = runBacktest(bars, churn, { costPerUnitTurnover: 0.001 })!;
    expect(r.totalCostDrag).toBeGreaterThan(0);
    expect(r.trades.reduce((a, t) => a + t.netReturn, 0)).toBeLessThan(0);
  });
});

describe("statistics", () => {
  it("measures drawdown from the running peak", () => {
    // A long rise to a peak, then a sustained decline. Lengths clear the
    // engine's 30-bar minimum, which exists so a handful of points cannot be
    // dressed up as a track record.
    const up = ramp(40, 0.01);
    let p = up[up.length - 1]!.close;
    const down: Bar[] = [];
    for (let i = 0; i < 25; i++) {
      p *= 0.99;
      down.push({ date: `x${i}`, open: p, high: p, low: p, close: p, volume: 1 });
    }
    const bars = [...up, ...down];
    const r = runBacktest(bars, bars.map(() => 1), NO_COST)!;
    // The decline is 25 bars at x0.99, so the peak-to-trough loss is exactly
    // 1 - 0.99^25. Asserting the analytic value rather than a loose band.
    expect(r.maxDrawdown).toBeCloseTo(1 - Math.pow(0.99, 25), 6);
  });

  it("has no drawdown on a monotonic rise", () => {
    const bars = ramp(120, 0.001);
    expect(runBacktest(bars, bars.map(() => 1), NO_COST)!.maxDrawdown).toBeCloseTo(0, 9);
  });

  it("counts hit rate only over bars actually held", () => {
    // Flat bars return exactly zero and are neither wins nor losses. Counting
    // them as wins is a standard way to report a hit rate above 50%.
    const bars = ramp(100, 0.001);
    const half = bars.map((_, i) => (i < 50 ? 1 : 0));
    const r = runBacktest(bars, half, NO_COST)!;
    expect(r.hitRate).toBeCloseTo(1, 6);
  });

  it("refuses to score a series too short to mean anything", () => {
    expect(runBacktest(ramp(10), new Array(10).fill(1))).toBeNull();
  });

  it("rejects a position series that does not line up with the bars", () => {
    expect(runBacktest(ramp(100), new Array(50).fill(1))).toBeNull();
  });
});

describe("walk-forward", () => {
  it("never scores a parameter on the window that chose it", () => {
    // The builder records which spans it was asked about. Every test span must
    // begin at or after the end of the train span that preceded it.
    const bars = ramp(1200, 0.0005);
    const wf = walkForward(bars, [10, 20], (b, p) => b.map((_, i) => (i >= p ? 1 : null)), {
      trainBars: 400,
      testBars: 100,
    });
    expect(wf.windows.length).toBeGreaterThan(0);
    for (const w of wf.windows) {
      expect(w.testFrom >= w.trainTo).toBe(true);
    }
  });

  it("reports the gap between fitted and unseen performance", () => {
    const bars = ramp(1200, 0.0005);
    const wf = walkForward(bars, [10, 20, 30], (b, p) => b.map((_, i) => (i >= p ? 1 : null)), {
      trainBars: 400,
      testBars: 100,
    });
    // On a pure uptrend every parameter works, so the gap should be small.
    // The point of the assertion is that the number exists and is finite.
    expect(wf.overfitGap === null || Number.isFinite(wf.overfitGap)).toBe(true);
    expect(wf.combinedOutOfSampleReturn).toBeGreaterThan(0);
  });

  it("produces nothing when there is not enough history to split", () => {
    const wf = walkForward(ramp(200), [10], (b) => b.map(() => 1), { trainBars: 756, testBars: 126 });
    expect(wf.windows).toEqual([]);
    expect(wf.combinedOutOfSampleSharpe).toBeNull();
  });
});
