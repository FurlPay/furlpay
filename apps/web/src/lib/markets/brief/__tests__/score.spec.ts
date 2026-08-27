import { describe, it, expect } from "vitest";
import {
  DEFAULT_FLOORS,
  MIN_COMPONENTS,
  rankBullish,
  scoreQuote,
  WEIGHTS,
} from "../score";
import type { ScreenerQuote } from "../screener";

// ---------------------------------------------------------------------------
// The bullishness score.
//
// Every test here is a way the score could quietly become wrong. None of them
// throw at runtime — they produce a plausible leaderboard with the wrong names
// on it, published unattended to a public channel. That is the whole reason
// each guard exists.
// ---------------------------------------------------------------------------

/** A fully-measured, unremarkable row. Tests subtract from it. */
function q(over: Partial<ScreenerQuote> = {}): ScreenerQuote {
  return {
    symbol: "TEST",
    shortName: "Test Corp",
    regularMarketPrice: 100,
    regularMarketChangePercent: 5,
    regularMarketVolume: 2_000_000,
    averageDailyVolume3Month: 1_000_000,
    fiftyDayAverage: 90,
    twoHundredDayAverage: 80,
    fiftyTwoWeekHighChangePercent: -2,
    marketCap: 10_000_000_000,
    ...over,
  };
}

describe("scoreQuote — a missing input scores nothing, not zero", () => {
  it("does not treat an absent 50-day average as a price above trend", () => {
    const withMa = scoreQuote(q());
    const without = scoreQuote(q({ fiftyDayAverage: undefined }));
    expect(withMa.ok && without.ok).toBe(true);
    if (!withMa.ok || !without.ok) return;

    // The component must be unmeasured, NOT scored as if the test passed.
    expect(without.scored.components.trend50.raw).toBeNull();
    expect(without.scored.components.trend50.points).toBe(0);
    // And it must be visibly absent rather than silently counted.
    expect(without.scored.available).toBe(withMa.scored.available - 1);
    expect(without.scored.reasons.join(" ")).not.toContain("50-day");
  });

  it("scores a price BELOW its average as zero points but a measured component", () => {
    const below = scoreQuote(q({ fiftyDayAverage: 120 }));
    expect(below.ok).toBe(true);
    if (!below.ok) return;
    // Measured (raw 0), not unmeasured (raw null) — the distinction is what
    // keeps `available` honest.
    expect(below.scored.components.trend50.raw).toBe(0);
    expect(below.scored.components.trend50.points).toBe(0);
    expect(below.scored.reasons).toContain("below 50-day avg");
  });

  it("rejects a row measured on fewer than MIN_COMPONENTS inputs", () => {
    // Momentum only: no average volume, no moving averages, no 52-week high.
    const thin = scoreQuote(
      q({
        averageDailyVolume3Month: undefined,
        fiftyDayAverage: undefined,
        twoHundredDayAverage: undefined,
        fiftyTwoWeekHighChangePercent: undefined,
      })
    );
    expect(thin.ok).toBe(false);
    if (thin.ok) return;
    expect(thin.rejected.reason).toBe("too_few_components");
  });

  it("admits a row at exactly MIN_COMPONENTS", () => {
    const borderline = scoreQuote(
      q({ fiftyDayAverage: undefined, twoHundredDayAverage: undefined })
    );
    expect(borderline.ok).toBe(true);
    if (!borderline.ok) return;
    expect(borderline.scored.available).toBe(MIN_COMPONENTS);
  });
});

describe("scoreQuote — liquidity floors keep the board investable", () => {
  it("rejects a sub-floor price before it can rank on a huge percentage", () => {
    // +50% is the largest move in any plausible board, and it is a $0.03 stock.
    const penny = scoreQuote(q({ regularMarketPrice: 0.03, regularMarketChangePercent: 50 }));
    expect(penny.ok).toBe(false);
    if (penny.ok) return;
    expect(penny.rejected.reason).toBe("below_min_price");
  });

  it("rejects a thin dollar volume", () => {
    const thin = scoreQuote(q({ regularMarketVolume: 100 }));
    expect(thin.ok).toBe(false);
    if (thin.ok) return;
    expect(thin.rejected.reason).toBe("below_min_dollar_volume");
  });

  it("treats an ABSENT volume as unmeasured, not as clearing the floor", () => {
    const noVol = scoreQuote(q({ regularMarketVolume: undefined }));
    expect(noVol.ok).toBe(false);
    if (noVol.ok) return;
    // The floor cannot be cleared by a number that was never reported.
    expect(noVol.rejected.reason).toBe("below_min_dollar_volume");
  });

  it("rejects a micro-cap", () => {
    const micro = scoreQuote(q({ marketCap: 50_000_000 }));
    expect(micro.ok).toBe(false);
    if (micro.ok) return;
    expect(micro.rejected.reason).toBe("below_min_market_cap");
  });

  it("keeps a declining stock off the bullish board however good its trend", () => {
    const down = scoreQuote(q({ regularMarketChangePercent: -3 }));
    expect(down.ok).toBe(false);
    if (down.ok) return;
    expect(down.rejected.reason).toBe("not_advancing");
  });
});

describe("scoreQuote — every component is bounded", () => {
  it("does not let an extreme percentage outvote the rest of the score", () => {
    const big = scoreQuote(q({ regularMarketChangePercent: 400 }));
    const ten = scoreQuote(q({ regularMarketChangePercent: 10 }));
    expect(big.ok && ten.ok).toBe(true);
    if (!big.ok || !ten.ok) return;
    expect(big.scored.components.momentum.points).toBe(WEIGHTS.momentum);
    expect(big.scored.components.momentum.points).toBe(ten.scored.components.momentum.points);
  });

  it("does not let a 40x volume spike outvote the other four components", () => {
    const spike = scoreQuote(q({ regularMarketVolume: 40_000_000 }));
    expect(spike.ok).toBe(true);
    if (!spike.ok) return;
    expect(spike.scored.components.participation.points).toBe(WEIGHTS.participation);
    expect(spike.scored.score).toBeLessThanOrEqual(100);
  });

  it("clamps a price printing above the stored 52-week high instead of erroring", () => {
    const newHigh = scoreQuote(q({ fiftyTwoWeekHighChangePercent: 1.5 }));
    expect(newHigh.ok).toBe(true);
    if (!newHigh.ok) return;
    expect(newHigh.scored.components.position.points).toBe(WEIGHTS.position);
    expect(newHigh.scored.reasons).toContain("at 52-week high");
  });

  it("never exceeds 100 on a maximal row", () => {
    const best = scoreQuote(
      q({
        regularMarketChangePercent: 25,
        regularMarketVolume: 20_000_000,
        fiftyTwoWeekHighChangePercent: 0,
      })
    );
    expect(best.ok).toBe(true);
    if (!best.ok) return;
    expect(best.scored.score).toBe(100);
  });

  it("ignores NaN and Infinity rather than propagating them into a weight", () => {
    const bad = scoreQuote(q({ averageDailyVolume3Month: Number.NaN }));
    expect(bad.ok).toBe(true);
    if (!bad.ok) return;
    expect(bad.scored.components.participation.raw).toBeNull();
    expect(Number.isFinite(bad.scored.score)).toBe(true);
  });

  it("survives a zero average volume without dividing by it", () => {
    const zero = scoreQuote(q({ averageDailyVolume3Month: 0 }));
    expect(zero.ok).toBe(true);
    if (!zero.ok) return;
    expect(zero.scored.components.participation.raw).toBeNull();
    expect(Number.isFinite(zero.scored.score)).toBe(true);
  });
});

describe("rankBullish — a total order and no duplicates", () => {
  it("produces the same board from the same input, in any input order", () => {
    const rows = [
      q({ symbol: "AAA", regularMarketChangePercent: 4 }),
      q({ symbol: "BBB", regularMarketChangePercent: 6 }),
      q({ symbol: "CCC", regularMarketChangePercent: 4 }),
      q({ symbol: "DDD", regularMarketChangePercent: 8 }),
    ];
    const forward = rankBullish(rows, 4).rows.map((r) => r.symbol);
    const reversed = rankBullish([...rows].reverse(), 4).rows.map((r) => r.symbol);
    expect(forward).toEqual(reversed);
  });

  it("breaks an exact score tie deterministically, on dollar volume then symbol", () => {
    // Identical in every scoring input, so the scores tie exactly.
    const tied = [
      q({ symbol: "ZZZ" }),
      q({ symbol: "AAA" }),
    ];
    const board = rankBullish(tied, 2);
    expect(board.rows[0].score).toBe(board.rows[1].score);
    expect(board.rows.map((r) => r.symbol)).toEqual(["AAA", "ZZZ"]);
  });

  it("does not seat one symbol twice when it appears in two screens", () => {
    // The same name legitimately shows up in day_gainers AND most_actives.
    const dup = [q({ symbol: "NVDA" }), q({ symbol: "NVDA" }), q({ symbol: "AMD" })];
    const board = rankBullish(dup, 5);
    expect(board.rows.map((r) => r.symbol).sort()).toEqual(["AMD", "NVDA"]);
    expect(board.considered).toBe(3);
  });

  it("prefers the better-measured copy of a duplicated symbol", () => {
    const board = rankBullish(
      [
        q({ symbol: "NVDA", fiftyDayAverage: undefined, twoHundredDayAverage: undefined }),
        q({ symbol: "NVDA" }),
      ],
      5
    );
    expect(board.rows).toHaveLength(1);
    expect(board.rows[0].available).toBe(5);
  });

  it("counts every rejection so an empty board is explainable", () => {
    const board = rankBullish(
      [
        q({ symbol: "PENNY", regularMarketPrice: 0.5 }),
        q({ symbol: "MICRO", marketCap: 1_000_000 }),
        q({ symbol: "DOWN", regularMarketChangePercent: -1 }),
      ],
      5
    );
    expect(board.rows).toHaveLength(0);
    expect(board.rejected.below_min_price).toBe(1);
    expect(board.rejected.below_min_market_cap).toBe(1);
    expect(board.rejected.not_advancing).toBe(1);
  });

  it("honours the limit and a zero limit", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      q({ symbol: `S${i}`, regularMarketChangePercent: i + 1 })
    );
    expect(rankBullish(many, 5).rows).toHaveLength(5);
    expect(rankBullish(many, 0).rows).toHaveLength(0);
  });

  it("ranks a high-conviction name above a bigger percentage on no volume", () => {
    // This is the entire point of the score. SPIKE moved more; QUIET moved on
    // real participation, inside an uptrend, near its high.
    const spike = q({
      symbol: "SPIKE",
      regularMarketChangePercent: 9,
      regularMarketVolume: 1_000_000,
      averageDailyVolume3Month: 1_000_000,
      fiftyDayAverage: 120,
      twoHundredDayAverage: 130,
      fiftyTwoWeekHighChangePercent: -40,
    });
    const quiet = q({
      symbol: "QUIET",
      regularMarketChangePercent: 4,
      regularMarketVolume: 4_000_000,
      averageDailyVolume3Month: 1_000_000,
      fiftyDayAverage: 90,
      twoHundredDayAverage: 80,
      fiftyTwoWeekHighChangePercent: -1,
    });
    const board = rankBullish([spike, quiet], 2);
    expect(board.rows[0].symbol).toBe("QUIET");
  });
});

describe("scoreQuote — the reasons justify the rank", () => {
  it("carries one measurement per measured component", () => {
    const out = scoreQuote(q());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.scored.reasons).toHaveLength(5);
    expect(out.scored.reasons[0]).toBe("+5.00% today");
    expect(out.scored.reasons[1]).toBe("2.0x average volume");
    expect(out.scored.reasons).toContain("above 200-day avg");
    expect(out.scored.reasons).toContain("2.0% below 52-week high");
  });

  it("uses the documented default floors", () => {
    expect(DEFAULT_FLOORS.minPrice).toBe(5);
    expect(DEFAULT_FLOORS.minDollarVolume).toBe(5_000_000);
    expect(DEFAULT_FLOORS.minMarketCap).toBe(300_000_000);
  });
});
