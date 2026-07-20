import { describe, expect, it } from "vitest";
import { applyDelisting, applyMerger, applySpinOff } from "@/lib/corporateActions/reorg";
import { applySale, positionCostBasis, positionQuantity } from "@/lib/corporateActions/lots";
import type { CorporateAction, TradeLot } from "@/lib/corporateActions/types";

// 150 shares of AAPL at a $22,750 blended basis, across two lots a year apart —
// the age gap is what makes holding-period tacking observable.
const OLD = "2024-01-15T00:00:00Z";
const NEW = "2025-06-01T00:00:00Z";

function lot(over: Partial<TradeLot> = {}): TradeLot {
  return {
    id: "lot_1",
    userId: "u1",
    symbol: "AAPL",
    quantity: 100,
    costBasis: 15_000,
    acquiredAt: OLD,
    status: "open",
    provenance: "execution",
    ...over,
  };
}

const BASE: TradeLot[] = [
  lot(),
  lot({ id: "lot_2", quantity: 50, costBasis: 7_750, acquiredAt: NEW }),
];

function action(over: Partial<CorporateAction> = {}): CorporateAction {
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

describe("applyMerger — stock for stock", () => {
  const deal = action({ ratio: 0.5, newSymbol: "NEWCO" });

  it("carries basis whole and realizes nothing", () => {
    const r = applyMerger(BASE, deal);
    expect(r.realizedGain).toBe(0);
    expect(r.cashProceeds).toBe(0);
    // 150 old shares → 75 new, same total basis.
    expect(positionQuantity(r.lots, "NEWCO")).toBe(75);
    expect(positionCostBasis(r.lots, "NEWCO")).toBe(22_750);
    expect(positionQuantity(r.lots, "AAPL")).toBe(0);
  });

  it("TACKS the holding period — the new lot keeps the original acquisition date", () => {
    const r = applyMerger(BASE, deal);
    const fromOld = r.lots.find((l) => l.sourceLotId === "lot_1")!;
    const fromNew = r.lots.find((l) => l.sourceLotId === "lot_2")!;
    // Resetting these to the merger date would turn a long-term position into a
    // short-term one and overtax the holder on the next sale.
    expect(fromOld.acquiredAt).toBe(OLD);
    expect(fromNew.acquiredAt).toBe(NEW);
  });

  it("supersedes the old lots rather than mutating them", () => {
    const r = applyMerger(BASE, deal);
    const original = r.lots.find((l) => l.id === "lot_1")!;
    expect(original.status).toBe("superseded");
    expect(original.quantity).toBe(100); // history intact
    expect(original.symbol).toBe("AAPL");
  });

  it("rejects a share-paying merger with no target ticker", () => {
    expect(() => applyMerger(BASE, action({ ratio: 0.5 }))).toThrow(/no newSymbol/);
  });
});

describe("applyMerger — cash out", () => {
  const deal = action({ ratio: undefined });

  it("realizes the full gain and closes the position", () => {
    // $200/share on 150 shares = $30,000 against a $22,750 basis.
    const r = applyMerger(BASE, deal, { cashPerShare: 200 });
    expect(r.cashProceeds).toBe(30_000);
    expect(r.realizedGain).toBe(7_250);
    expect(positionQuantity(r.lots, "AAPL")).toBe(0);
    expect(r.consumed).toHaveLength(2);
  });

  it("realizes a LOSS when the deal prices below basis", () => {
    const r = applyMerger(BASE, deal, { cashPerShare: 100 });
    expect(r.cashProceeds).toBe(15_000);
    expect(r.realizedGain).toBe(-7_750);
  });

  it("matches what an outright sale at the same price would have realized", () => {
    const viaSale = applySale(BASE, "AAPL", 150, 30_000);
    const viaMerger = applyMerger(BASE, deal, { cashPerShare: 200 });
    // A cash-out merger IS a disposal; the economics must not differ.
    expect(viaMerger.realizedGain).toBeCloseTo(viaSale.realizedGain, 2);
  });
});

describe("applyMerger — mixed consideration", () => {
  const deal = action({ ratio: 0.5, newSymbol: "NEWCO" });

  it("apportions basis by relative value and realizes only the cash leg", () => {
    // Per old share: $60 cash + 0.5 × $140 = $70 stock. Cash is 60/130 of value.
    const r = applyMerger(BASE, deal, { cashPerShare: 60, stockValuePerShare: 140 });

    const cashFraction = 60 / 130;
    expect(r.cashProceeds).toBe(9_000); // 150 × $60
    expect(r.realizedGain).toBeCloseTo(9_000 - 22_750 * cashFraction, 2);

    // The stock leg keeps the rest of the basis — deferred, not realized.
    expect(positionCostBasis(r.lots, "NEWCO")).toBeCloseTo(22_750 * (1 - cashFraction), 2);
    expect(positionQuantity(r.lots, "NEWCO")).toBe(75);
  });

  it("INVARIANT: basis is conserved across both legs", () => {
    const r = applyMerger(BASE, deal, { cashPerShare: 60, stockValuePerShare: 140 });
    const realizedBasis = r.consumed.reduce((s, c) => s + c.costBasis, 0);
    expect(realizedBasis + positionCostBasis(r.lots, "NEWCO")).toBeCloseTo(22_750, 2);
  });

  it("refuses to guess when the stock leg has no value", () => {
    // Without it there is no way to apportion, and a wrong split misstates tax.
    expect(() => applyMerger(BASE, deal, { cashPerShare: 60 })).toThrow(
      /stockValuePerShare/
    );
  });

  it("rejects a deal that pays nothing at all", () => {
    expect(() => applyMerger(BASE, action({ ratio: undefined }))).toThrow(/nothing to apply/);
  });
});

describe("applySpinOff", () => {
  const spin = action({ type: "spin_off", ratio: 0.25, newSymbol: "SPINCO" });
  // Parent $180, child $40 × 0.25 = $10 per parent share → child takes 10/190.
  const fmv = { parentFmv: 180, childFmv: 40 };
  const childShare = 10 / 190;

  it("apportions parent basis by relative FMV", () => {
    const r = applySpinOff(BASE, spin, fmv);
    expect(positionQuantity(r.lots, "SPINCO")).toBeCloseTo(37.5, 6);
    // Tolerance of a cent or so, not exact: basis is rounded to cents PER LOT,
    // so a two-lot position can sit a rounding step off the exact fraction.
    // The conservation invariant below is the assertion that must hold tightly.
    expect(positionCostBasis(r.lots, "SPINCO")).toBeCloseTo(22_750 * childShare, 1);
    expect(positionCostBasis(r.lots, "AAPL")).toBeCloseTo(22_750 * (1 - childShare), 1);
  });

  it("INVARIANT: total basis is unchanged — a spin-off is not a taxable event", () => {
    const r = applySpinOff(BASE, spin, fmv);
    expect(positionCostBasis(r.lots, "AAPL") + positionCostBasis(r.lots, "SPINCO")).toBeCloseTo(
      22_750,
      2
    );
  });

  it("leaves the parent share count alone", () => {
    const r = applySpinOff(BASE, spin, fmv);
    // Only basis moves; the holder did not give up any parent shares.
    expect(positionQuantity(r.lots, "AAPL")).toBe(150);
  });

  it("tacks the holding period to the child shares", () => {
    const r = applySpinOff(BASE, spin, fmv);
    const child = r.lots.find((l) => l.sourceLotId === "lot_1" && l.symbol === "SPINCO")!;
    expect(child.acquiredAt).toBe(OLD);
  });

  it("records the allocation fraction so the basis split stays auditable", () => {
    const r = applySpinOff(BASE, spin, fmv);
    const child = r.lots.find((l) => l.symbol === "SPINCO")!;
    expect(child.basisAllocationPct).toBeCloseTo(childShare, 8);
  });

  it("pays cash in lieu of fractional child shares, conserving basis", () => {
    const odd = [lot({ id: "odd", quantity: 10, costBasis: 1_900 })];
    // 10 × 0.25 = 2.5 child shares; the 0.5 is paid out.
    const r = applySpinOff(odd, spin, { ...fmv, cashInLieuOfFractional: true });
    expect(positionQuantity(r.lots, "SPINCO")).toBe(2);
    expect(
      positionCostBasis(r.lots, "AAPL") + positionCostBasis(r.lots, "SPINCO") + r.cashInLieu
    ).toBeCloseTo(1_900, 2);
  });

  it("refuses to run without both FMVs rather than assigning a zero basis", () => {
    expect(() => applySpinOff(BASE, spin, { parentFmv: 180, childFmv: 0 })).toThrow(/childFmv/);
    expect(() => applySpinOff(BASE, spin, { parentFmv: 0, childFmv: 40 })).toThrow(/parentFmv/);
  });
});

describe("applyDelisting", () => {
  const delist = action({ type: "delisting" });

  it("FREEZES the position rather than realizing a phantom loss", () => {
    const r = applyDelisting(BASE, delist);
    expect(r.realizedGain).toBe(0);
    expect(r.liquidationProceeds).toBe(0);
    for (const l of r.lots) {
      expect(l.status).toBe("frozen");
      // Still owned: basis and share count survive intact.
      expect(l.quantity).toBeGreaterThan(0);
    }
    expect(positionCostBasis(r.lots, "AAPL")).toBe(0); // no longer an OPEN position
  });

  it("frozen lots are not sellable", () => {
    const r = applyDelisting(BASE, delist);
    expect(() => applySale(r.lots, "AAPL", 1, 100)).toThrow(/insufficient position/);
  });

  it("realizes gain when the delisting pays a liquidating distribution", () => {
    const r = applyDelisting(BASE, delist, { liquidationPerShare: 200 });
    expect(r.liquidationProceeds).toBe(30_000);
    expect(r.realizedGain).toBe(7_250);
    expect(r.lots.every((l) => l.status === "closed")).toBe(true);
  });

  it("treats a ZERO liquidation as a worthless-security writeoff, not a freeze", () => {
    // Absent liquidationPerShare freezes; an explicit 0 realizes the full loss.
    const r = applyDelisting(BASE, delist, { liquidationPerShare: 0 });
    expect(r.realizedGain).toBe(-22_750);
    expect(r.lots.every((l) => l.status === "closed")).toBe(true);
  });
});
