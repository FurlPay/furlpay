import { describe, it, expect } from "vitest";
import {
  impliedStop,
  MAX_RISK_FRACTION,
  MIN_STOP_DISTANCE_FRACTION,
  PositionSizingError,
  rewardRisk,
  sizePosition,
} from "@/lib/markets/positionSizing";

// ---------------------------------------------------------------------------
// Position sizing.
//
// The property under test throughout: the caller states what they are willing to
// LOSE, and the size that comes back never risks more than that. Every rounding
// decision and every refusal below exists to keep that true, including in the
// cases where the arithmetic alone would return a confident wrong answer.
// ---------------------------------------------------------------------------

const LONG = { equity: 20_000, riskFraction: 0.02, entryPrice: 100, stopPrice: 98, side: "buy" } as const;

describe("sizing from a risk budget", () => {
  it("sizes so the stop costs exactly the budget", () => {
    // $20,000 * 2% = $400 budget. $2 of risk per share -> 200 shares.
    const r = sizePosition(LONG);
    expect(r.quantity).toBe(200);
    expect(r.riskAmount).toBe(400);
    expect(r.actualRiskFraction).toBeCloseTo(0.02, 10);
  });

  it("reports NOTIONAL separately from RISK, because they are not the same number", () => {
    // The misconception the module exists to correct: a $20,000 position is not a
    // $20,000 risk. Here the exposure is 50x the amount at risk.
    const r = sizePosition(LONG);
    expect(r.notional).toBe(20_000);
    expect(r.riskAmount).toBe(400);
    expect(r.notional / r.riskAmount).toBe(50);
  });

  it("sizes a WIDER stop smaller, for the same budget", () => {
    // The whole point of sizing off the stop. Ten times the stop distance must be
    // a tenth of the position, so the loss is identical either way.
    const tight = sizePosition({ ...LONG, stopPrice: 98 }); // $2 away
    const wide = sizePosition({ ...LONG, stopPrice: 80 }); // $20 away
    expect(wide.quantity).toBeCloseTo(tight.quantity / 10, 6);
    expect(wide.riskAmount).toBeCloseTo(tight.riskAmount, 6);
  });

  it("rounds quantity DOWN, never up", () => {
    // $400 budget, $3 per share = 133.33... shares. Rounding up would risk
    // $400.02 — more than authorised. "Slightly smaller than asked" and
    // "slightly larger than authorised" are different kinds of wrong.
    const r = sizePosition({ ...LONG, stopPrice: 97 });
    expect(r.quantity).toBeLessThanOrEqual(400 / 3);
    expect(r.riskAmount).toBeLessThanOrEqual(400);
  });

  it("never exceeds the budget across a sweep of awkward numbers", () => {
    // The invariant as a property rather than a single case.
    for (const entry of [3.33, 17.77, 101.01, 1999.99]) {
      for (const distance of [0.07, 0.51, 3.33, 11.11]) {
        // Skip combinations that are not a valid long: a stop at or below zero,
        // or one too tight to be sized. The module refuses both, correctly — this
        // sweep is testing the budget invariant, not the refusals, which have
        // their own tests below.
        if (distance >= entry) continue;
        if (distance / entry < MIN_STOP_DISTANCE_FRACTION) continue;
        const r = sizePosition({
          equity: 13_337,
          riskFraction: 0.017,
          entryPrice: entry,
          stopPrice: entry - distance,
          side: "buy",
        });
        expect(r.riskAmount, `entry ${entry} stop-distance ${distance}`).toBeLessThanOrEqual(
          13_337 * 0.017 + 1e-9
        );
      }
    }
  });

  it("sizes a short off a stop ABOVE entry", () => {
    const r = sizePosition({ ...LONG, side: "sell", stopPrice: 102 });
    expect(r.quantity).toBe(200);
    expect(r.riskAmount).toBe(400);
  });
});

describe("refusals that prevent a nonsense position", () => {
  it("REFUSES a long whose stop is above entry", () => {
    // Not a rounding issue: this stop triggers on exactly the move the trade is
    // betting on. The arithmetic would happily return a number for it.
    expect(() => sizePosition({ ...LONG, stopPrice: 102 })).toThrow(/must be BELOW entry/);
  });

  it("REFUSES a short whose stop is below entry", () => {
    expect(() => sizePosition({ ...LONG, side: "sell", stopPrice: 98 })).toThrow(/must be ABOVE entry/);
  });

  it("REFUSES a stop AT entry rather than dividing by zero", () => {
    expect(() => sizePosition({ ...LONG, stopPrice: 100 })).toThrow(PositionSizingError);
  });

  it("REFUSES a stop too tight to survive noise", () => {
    // 1bp away: the arithmetic returns an enormous position that ordinary spread
    // movement closes. Refusing beats sizing it.
    expect(() => sizePosition({ ...LONG, stopPrice: 99.99 })).toThrow(/below the/);
  });

  it("REFUSES a riskFraction that looks like a percent mistyped as a fraction", () => {
    // `2` meaning 2% would risk 200% of the account. This is the typo that ends
    // an account, so the error names the fix.
    expect(() => sizePosition({ ...LONG, riskFraction: 2 })).toThrow(/pass 0.02 rather than 2/);
    expect(MAX_RISK_FRACTION).toBe(0.25);
  });

  it("REFUSES non-finite and non-positive inputs", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => sizePosition({ ...LONG, equity: bad })).toThrow(PositionSizingError);
      expect(() => sizePosition({ ...LONG, entryPrice: bad })).toThrow(PositionSizingError);
    }
    expect(() => sizePosition({ ...LONG, equity: 0 })).toThrow(/equity must be positive/);
    expect(() => sizePosition({ ...LONG, riskFraction: 0 })).toThrow(/riskFraction must be positive/);
  });

  it("REFUSES when the budget cannot buy even a minimal position", () => {
    expect(() =>
      sizePosition({ equity: 10, riskFraction: 0.0001, entryPrice: 50_000, stopPrice: 25_000, side: "buy" })
    ).toThrow(/cannot buy even a minimal position/);
  });
});

describe("reward-to-risk", () => {
  it("computes the ratio from the three prices", () => {
    // Stop $2 below, target $6 above -> 1:3.
    const r = rewardRisk({ entryPrice: 100, stopPrice: 98, targetPrice: 106, side: "buy" });
    expect(r.ratio).toBe(3);
    expect(r.riskPerUnit).toBe(2);
    expect(r.rewardPerUnit).toBe(6);
  });

  it("works for a short", () => {
    const r = rewardRisk({ entryPrice: 100, stopPrice: 102, targetPrice: 94, side: "sell" });
    expect(r.ratio).toBe(3);
  });

  it("REFUSES a target on the wrong side of entry", () => {
    // A long "target" below entry is a loss dressed as a goal.
    expect(() => rewardRisk({ entryPrice: 100, stopPrice: 98, targetPrice: 94, side: "buy" })).toThrow(
      /target must be above entry/
    );
    expect(() => rewardRisk({ entryPrice: 100, stopPrice: 102, targetPrice: 106, side: "sell" })).toThrow(
      /target must be below entry/
    );
  });

  it("says risk is UNDEFINED rather than zero when the stop equals entry", () => {
    expect(() => rewardRisk({ entryPrice: 100, stopPrice: 100, targetPrice: 106, side: "buy" })).toThrow(
      /undefined, not zero/
    );
  });
});

describe("implied stop — the inverse", () => {
  it("round-trips with sizePosition", () => {
    // Sizing from a stop and deriving a stop from a size must agree, or one of
    // them is lying to the user about their risk.
    const sized = sizePosition(LONG);
    const stop = impliedStop({
      equity: LONG.equity,
      riskFraction: LONG.riskFraction,
      entryPrice: LONG.entryPrice,
      quantity: sized.quantity,
      side: "buy",
    });
    expect(stop).toBeCloseTo(LONG.stopPrice, 6);
  });

  it("puts a short's implied stop ABOVE entry", () => {
    const stop = impliedStop({ equity: 20_000, riskFraction: 0.02, entryPrice: 100, quantity: 200, side: "sell" });
    expect(stop).toBe(102);
  });

  it("REFUSES a size whose implied stop would be at or below zero", () => {
    // 1 share against a $400 budget on a $100 stock implies a stop at -$300.
    // Returning a negative price would be worse than refusing.
    expect(() =>
      impliedStop({ equity: 20_000, riskFraction: 0.02, entryPrice: 100, quantity: 1, side: "buy" })
    ).toThrow(/at or below zero/);
  });
});
