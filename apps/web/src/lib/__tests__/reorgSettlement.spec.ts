import { describe, expect, it } from "vitest";
import { settleReorgs } from "@/lib/corporateActions/reorgSettlement";
import { positionCostBasis, positionQuantity } from "@/lib/corporateActions/lots";
import type { CorporateAction, TradeLot } from "@/lib/corporateActions/types";

const USER = "u1";
const NONE = new Set<string>();
const AFTER = new Date("2026-12-01T00:00:00Z");

function lot(over: Partial<TradeLot> = {}): TradeLot {
  return {
    id: "lot_1",
    userId: USER,
    symbol: "AAPL",
    quantity: 100,
    costBasis: 15_000,
    acquiredAt: "2025-01-01T00:00:00Z",
    status: "open",
    provenance: "execution",
    ...over,
  };
}

function action(over: Partial<CorporateAction>): CorporateAction {
  return {
    id: "ca_1",
    symbol: "AAPL",
    type: "merger",
    effectiveDate: "2026-03-01T00:00:00Z",
    source: "manual",
    confidence: "confirmed",
    ...over,
  };
}

describe("settleReorgs — cash-out merger", () => {
  const deal = action({ terms: { cashPerShare: 200 } });

  it("pays the cash and realizes the gain", () => {
    const r = settleReorgs(USER, [lot()], [deal], NONE, { asOf: AFTER });
    expect(r.cashToCredit).toBe(20_000); // 100 × $200
    expect(r.realizedGain).toBe(5_000); // 20,000 − 15,000
    expect(r.events).toHaveLength(1);
    expect(positionQuantity(r.lots, "AAPL")).toBe(0);
  });

  it("is idempotent: an already-settled action pays nothing and is skipped", () => {
    const already = new Set(["ca_1"]);
    const r = settleReorgs(USER, [lot()], [deal], already, { asOf: AFTER });
    expect(r.cashToCredit).toBe(0);
    expect(r.events).toHaveLength(0);
    expect(r.skipped).toEqual(["ca_1"]);
  });

  it("a second run after recording the first settles nothing more", () => {
    const first = settleReorgs(USER, [lot()], [deal], NONE, { asOf: AFTER });
    const settled = new Set(first.events.map((e) => e.corporateActionId));
    // The real ledger would now hold first.lots (position closed). Re-running
    // with the settled-set recorded must be a no-op.
    const second = settleReorgs(USER, first.lots, [deal], settled, { asOf: AFTER });
    expect(first.cashToCredit).toBe(20_000);
    expect(second.cashToCredit).toBe(0);
  });
});

describe("settleReorgs — date gating", () => {
  it("does not settle before the effective/payment date", () => {
    const deal = action({ terms: { cashPerShare: 200 }, paymentDate: "2026-03-15T00:00:00Z" });
    const r = settleReorgs(USER, [lot()], [deal], NONE, {
      asOf: new Date("2026-03-01T00:00:00Z"),
    });
    expect(r.events).toHaveLength(0);
    expect(r.cashToCredit).toBe(0);
  });
});

describe("settleReorgs — only cash-bearing actions", () => {
  it("ignores a pure stock-for-stock merger (no cash to settle)", () => {
    const stockOnly = action({ ratio: 0.5, newSymbol: "NEWCO" });
    const r = settleReorgs(USER, [lot()], [stockOnly], NONE, { asOf: AFTER });
    expect(r.events).toHaveLength(0);
    // The projection handles the stock leg; settlement leaves it alone.
    expect(positionQuantity(r.lots, "AAPL")).toBe(100);
  });

  it("does nothing when the user no longer holds the symbol", () => {
    const deal = action({ symbol: "GONE", terms: { cashPerShare: 200 } });
    const r = settleReorgs(USER, [lot()], [deal], NONE, { asOf: AFTER });
    expect(r.events).toHaveLength(0);
  });
});

describe("settleReorgs — liquidating delisting", () => {
  it("pays the distribution and closes the lots", () => {
    const delist = action({ type: "delisting", terms: { liquidationPerShare: 120 } });
    const r = settleReorgs(USER, [lot()], [delist], NONE, { asOf: AFTER });
    expect(r.cashToCredit).toBe(12_000);
    expect(r.realizedGain).toBe(-3_000); // 12,000 − 15,000, a loss
    expect(r.lots.every((l) => l.status === "closed")).toBe(true);
  });

  it("settles a ZERO liquidation as a worthless-security writeoff", () => {
    const writeoff = action({ type: "delisting", terms: { liquidationPerShare: 0 } });
    const r = settleReorgs(USER, [lot()], [writeoff], NONE, { asOf: AFTER });
    expect(r.events).toHaveLength(1);
    expect(r.cashToCredit).toBe(0);
    expect(r.realizedGain).toBe(-15_000); // the whole basis is lost
  });
});

describe("settleReorgs — ordering over an evolving ledger", () => {
  it("applies a spin-off before a later merger of the parent", () => {
    // AAPL spins off SPINCO (cash-in-lieu) in June, then AAPL is cash-acquired
    // in September. The merger must see the post-spin-off AAPL basis.
    const spin = action({
      id: "ca_spin",
      type: "spin_off",
      ratio: 0.25,
      newSymbol: "SPINCO",
      effectiveDate: "2026-06-01T00:00:00Z",
      terms: { parentFmv: 180, childFmv: 40, cashInLieuOfFractional: true },
    });
    const merger = action({
      id: "ca_merge",
      type: "merger",
      effectiveDate: "2026-09-01T00:00:00Z",
      terms: { cashPerShare: 200 },
    });

    const r = settleReorgs(USER, [lot()], [merger, spin], NONE, { asOf: AFTER });
    // Both settled, in date order regardless of input order.
    expect(r.events.map((e) => e.corporateActionId)).toEqual(["ca_spin", "ca_merge"]);
    // AAPL fully cashed out; SPINCO remains (its stock leg was distributed).
    expect(positionQuantity(r.lots, "AAPL")).toBe(0);
    expect(positionQuantity(r.lots, "SPINCO")).toBeGreaterThan(0);
  });

  it("INVARIANT: cash credited + surviving basis conserves the original basis", () => {
    // A cash-out merger pays proceeds, not basis, so the identity is on the
    // spin-off's cash-in-lieu leg, which conserves basis by construction.
    const spin = action({
      type: "spin_off",
      ratio: 0.25,
      newSymbol: "SPINCO",
      terms: { parentFmv: 180, childFmv: 40, cashInLieuOfFractional: true },
    });
    const start = [lot({ quantity: 10, costBasis: 1_900 })];
    const r = settleReorgs(USER, start, [spin], NONE, { asOf: AFTER });
    const survivingBasis =
      positionCostBasis(r.lots, "AAPL") + positionCostBasis(r.lots, "SPINCO");
    // cashInLieu here IS basis (a spin-off is non-taxable), so basis + cash-out
    // fraction reconstructs the original.
    expect(survivingBasis + r.cashToCredit).toBeCloseTo(1_900, 2);
  });
});
