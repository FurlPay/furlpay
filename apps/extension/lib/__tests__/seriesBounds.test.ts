import { describe, expect, it } from "vitest";
import { RANGES, changePct, seriesFor, tokenMeta } from "../market";
import { blendSeries } from "../market";

// ---------------------------------------------------------------------------
// Regression: the portfolio card rendered "H $5,577,547.09" and
// "Today -$23,237.30 (-55.20%)" against an $18,856 portfolio.
//
// seriesFor()'s volatility-clustering rule was an unbounded feedback loop:
//     vol = max(amp*0.25, vol*0.9 + |shock|*0.6)     with |shock| <= vol
// so vol could reach 1.5x EVERY step — geometric growth. Measured: vol ran from
// amp=0.0008 to ~1e2, a USDC sparkline peaked at 2e+1, and XSGD/1M hit 1.74e+13.
// The old `Math.max(0.02, …)` only floored the series; nothing capped it.
//
// These bounds must hold for EVERY token at EVERY range — the portfolio index
// is a weighted blend, so one bad asset poisons the whole card.
// ---------------------------------------------------------------------------

// The seeded demo portfolio (store.ts seedDemoAccount) plus the volatile
// majors, which have the largest amplitude and so the greatest blow-up risk.
const TOKENS = ["USDC", "USDT", "EURC", "XSGD", "XUSD", "BTC", "ETH", "SOL", "ARB"];

describe("seriesFor stays bounded", () => {
  for (const token of TOKENS) {
    for (const range of RANGES) {
      it(`${token} @ ${range} produces a plausible, finite series`, () => {
        const meta = tokenMeta(token);
        const series = seriesFor(`${token}:test`, range, meta.volatility);

        expect(series).toHaveLength(64);
        for (const v of series) {
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThan(0);
        }

        const min = Math.min(...series);
        const max = Math.max(...series);
        // A 16x swing inside one sparkline window is not a market move.
        expect(max / min).toBeLessThanOrEqual(16);
        // Series is normalized to a 1.0 baseline; keep it in a sane band.
        expect(max).toBeLessThanOrEqual(4);
        expect(min).toBeGreaterThanOrEqual(0.25);
      });
    }
  }

  it("keeps stablecoins visibly flat", () => {
    for (const range of RANGES) {
      const series = seriesFor("USDC:base", range, tokenMeta("USDC").volatility);
      const swing = Math.max(...series) / Math.min(...series);
      // USDC must not look like a meme coin.
      expect(swing).toBeLessThan(1.2);
      expect(Math.abs(changePct(series))).toBeLessThan(20);
    }
  });
});

describe("blended portfolio index stays chartable", () => {
  it("never yields a high wildly above its own last value", () => {
    // Mirrors the seeded demo account's weights.
    const holdings = [
      { token: "USDC", weight: 4210.55 },
      { token: "USDC", weight: 1890.0 },
      { token: "EURC", weight: 1068.6 },
      { token: "USDT", weight: 640.12 },
      { token: "XSGD", weight: 1950.0 },
      { token: "XUSD", weight: 750.0 },
    ];
    for (const range of RANGES) {
      const blended = blendSeries(
        holdings.map((h) => ({
          weight: h.weight,
          series: seriesFor(`${h.token}:chain`, range, tokenMeta(h.token).volatility),
        }))
      );
      const last = blended[blended.length - 1];
      const max = Math.max(...blended);
      const min = Math.min(...blended);

      expect(Number.isFinite(last)).toBe(true);
      expect(last).toBeGreaterThan(0);
      // The card computes scale = netWorth / last, then prints max*scale as the
      // period high. max/last IS the multiple of net worth shown — 295x is what
      // produced $5.5M. A stablecoin-heavy book must stay near 1.
      expect(max / last).toBeLessThan(2);
      expect(min / last).toBeGreaterThan(0.5);
      // Today's move on a stablecoin-heavy portfolio can't be -55%.
      expect(Math.abs(changePct(blended))).toBeLessThan(25);
    }
  });
});
