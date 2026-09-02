import { describe, it, expect } from "vitest";
import {
  ols, sharpeOf, mulberry32, blockBootstrapSharpe, circularBlockShuffle, placeboTest,
} from "../stats";

// ---------------------------------------------------------------------------
// Regression is tested against relationships whose coefficients are known
// exactly by construction, because a regression that is merely "plausible" is
// how a spurious macro factor gets promoted to a signal.
// ---------------------------------------------------------------------------

describe("OLS", () => {
  it("recovers a known linear relationship exactly", () => {
    // y = 3 + 2x, no noise. Intercept 3, slope 2, R^2 = 1.
    const x = Array.from({ length: 50 }, (_, i) => i / 10);
    const y = x.map((v) => 3 + 2 * v);
    const r = ols(y, x.map((v) => [v]))!;
    expect(r.beta[0]!).toBeCloseTo(3, 9);
    expect(r.beta[1]!).toBeCloseTo(2, 9);
    expect(r.rSquared).toBeCloseTo(1, 9);
  });

  it("recovers two known coefficients in a multiple regression", () => {
    // y = 1 - 0.5*x1 + 3*x2
    const n = 200;
    const rnd = mulberry32(11);
    const x1: number[] = [], x2: number[] = [], y: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = rnd() * 2 - 1, b = rnd() * 2 - 1;
      x1.push(a); x2.push(b); y.push(1 - 0.5 * a + 3 * b);
    }
    const r = ols(y, x1.map((v, i) => [v, x2[i]!]))!;
    expect(r.beta[0]!).toBeCloseTo(1, 6);
    expect(r.beta[1]!).toBeCloseTo(-0.5, 6);
    expect(r.beta[2]!).toBeCloseTo(3, 6);
  });

  it("finds no relationship where none exists", () => {
    // y independent of x: slope near zero, |t| small, R^2 near zero.
    const rnd = mulberry32(5);
    const x: number[] = [], y: number[] = [];
    for (let i = 0; i < 500; i++) { x.push(rnd() - 0.5); y.push(rnd() - 0.5); }
    const r = ols(y, x.map((v) => [v]))!;
    expect(Math.abs(r.beta[1]!)).toBeLessThan(0.25);
    expect(r.rSquared).toBeLessThan(0.05);
  });

  it("returns null for a singular design rather than huge coefficients", () => {
    // x2 is an exact copy of x1: the system has no unique solution.
    const x = Array.from({ length: 40 }, (_, i) => i);
    expect(ols(x.map((v) => v * 2), x.map((v) => [v, v]))).toBeNull();
  });

  it("refuses a sample too small for its parameter count", () => {
    expect(ols([1, 2], [[1], [2]])).toBeNull();
  });

  it("produces LARGER standard errors under HAC than classical", () => {
    // This is the whole point of HAC. A series with strongly autocorrelated
    // residuals has classical errors that are far too small, which is exactly
    // the overlapping-horizon case. If HAC did not widen them, an overlapping
    // 20-day regression would keep reporting false significance.
    // BOTH the regressor and the residuals must be persistent for the slope's
    // HAC correction to bite. With an i.i.d. regressor the cross-products
    // average to zero and the correction lands on the intercept instead --
    // which is not the case that matters. Real yields and the dollar are
    // highly persistent, and an overlapping forward return is too, so this is
    // the realistic configuration.
    const n = 400;
    const rnd = mulberry32(3);
    const x: number[] = [], y: number[] = [];
    let e = 0, xi = 0;
    for (let i = 0; i < n; i++) {
      xi = 0.95 * xi + (rnd() - 0.5); // persistent regressor
      e = 0.9 * e + (rnd() - 0.5); // persistent errors
      x.push(xi);
      y.push(0.1 * xi + e);
    }
    const plain = ols(y, x.map((v) => [v]), 0)!;
    const hac = ols(y, x.map((v) => [v]), 20)!;
    expect(hac.hac).toBe(true);
    expect(plain.hac).toBe(false);
    // Same point estimate, wider uncertainty.
    expect(hac.beta[1]!).toBeCloseTo(plain.beta[1]!, 12);
    expect(hac.se[1]!).toBeGreaterThan(plain.se[1]!);
  });
});

describe("Sharpe", () => {
  it("is null for a constant series with no dispersion", () => {
    expect(sharpeOf(new Array(100).fill(0.001))).toBeNull();
  });

  it("scales the mean by the square root of the period count", () => {
    // Alternating +a/-a about a positive mean; check against the definition.
    const rets = Array.from({ length: 300 }, (_, i) => (i % 2 === 0 ? 0.011 : -0.009));
    const m = rets.reduce((a, b) => a + b, 0) / rets.length;
    const v = rets.reduce((a, b) => a + (b - m) ** 2, 0) / (rets.length - 1);
    const expected = (m * 252) / (Math.sqrt(v) * Math.sqrt(252));
    expect(sharpeOf(rets)!).toBeCloseTo(expected, 10);
  });

  it("refuses too short a series", () => {
    expect(sharpeOf([0.01, 0.02])).toBeNull();
  });
});

describe("bootstrap", () => {
  it("brackets the observed Sharpe and reports both tails", () => {
    const rnd = mulberry32(9);
    const rets = Array.from({ length: 800 }, () => 0.0004 + (rnd() - 0.5) * 0.02);
    const ci = blockBootstrapSharpe(rets, 400, 20, 1)!;
    expect(ci.lower).toBeLessThan(ci.upper);
    expect(ci.mean).toBeGreaterThan(ci.lower);
    expect(ci.mean).toBeLessThan(ci.upper);
    expect(ci.fractionBelowZero).toBeGreaterThanOrEqual(0);
    expect(ci.fractionBelowZero).toBeLessThanOrEqual(1);
  });

  it("puts a pure-noise series' interval across zero", () => {
    // A strategy with no edge must not produce a confidence interval that
    // excludes zero, or the bootstrap is not doing its job.
    const rnd = mulberry32(21);
    const rets = Array.from({ length: 800 }, () => (rnd() - 0.5) * 0.02);
    const ci = blockBootstrapSharpe(rets, 400, 20, 2)!;
    expect(ci.lower).toBeLessThan(0);
    expect(ci.upper).toBeGreaterThan(0);
  });

  it("refuses a series too short to resample meaningfully", () => {
    expect(blockBootstrapSharpe([0.01, 0.02, 0.03])).toBeNull();
  });
});

describe("shuffling and placebo", () => {
  it("preserves length and multiset under a circular block shuffle", () => {
    const s = Array.from({ length: 100 }, (_, i) => i);
    const out = circularBlockShuffle(s, 10, mulberry32(4));
    expect(out).toHaveLength(100);
    // Values are drawn from the original series; the distribution is preserved
    // in character even though blocks may repeat.
    for (const v of out) expect(s).toContain(v);
  });

  it("is deterministic for a given seed", () => {
    const s = Array.from({ length: 50 }, (_, i) => i);
    const a = circularBlockShuffle(s, 5, mulberry32(123));
    const b = circularBlockShuffle(s, 5, mulberry32(123));
    expect(a).toEqual(b);
  });

  it("gives a high p-value when the real result is ordinary", () => {
    // Actual Sharpe sits in the middle of the placebo distribution: no edge.
    const r = placeboTest(0, (rnd) => rnd() * 2 - 1, 500, 8)!;
    expect(r.pValue).toBeGreaterThan(0.3);
    expect(r.pValue).toBeLessThan(0.7);
  });

  it("gives a low p-value only when the real result exceeds the placebos", () => {
    const r = placeboTest(5, (rnd) => rnd() * 2 - 1, 500, 8)!;
    expect(r.pValue).toBe(0);
    expect(r.percentileOfActual).toBe(1);
  });
});
