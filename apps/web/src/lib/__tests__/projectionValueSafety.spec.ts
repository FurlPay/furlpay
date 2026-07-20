import { describe, expect, it } from "vitest";
import { applyActions } from "@/lib/corporateActions/projector";
import { positionCostBasis, positionQuantity } from "@/lib/corporateActions/lots";
import type { CorporateAction, TradeLot } from "@/lib/corporateActions/types";

// applyActions() is PURE and runs on every portfolio read, so it has nowhere to
// put cash — each handler is called for its `.lots` and its cash figure is
// discarded. These tests pin the consequence: an action that pays the holder
// must stay UNAPPLIED here rather than half-applied, or the projection deletes
// shares and basis that no settlement step ever compensates.

const LOTS: TradeLot[] = [
  {
    id: "lot_1",
    userId: "u1",
    symbol: "AAPL",
    quantity: 15,
    costBasis: 1_500,
    acquiredAt: "2025-01-01T00:00:00Z",
    status: "open",
    provenance: "execution",
  },
];

function action(over: Partial<CorporateAction>): CorporateAction {
  return {
    id: "ca_1",
    symbol: "AAPL",
    type: "stock_split",
    effectiveDate: "2026-03-01T00:00:00Z",
    source: "manual",
    confidence: "confirmed",
    ...over,
  };
}

/** Total basis across every symbol — the number that must never silently drop. */
function totalBasis(lots: TradeLot[]): number {
  const symbols = [...new Set(lots.map((l) => l.symbol))];
  return symbols.reduce((s, sym) => s + positionCostBasis(lots, sym), 0);
}

describe("applyActions — never destroys value", () => {
  it("does NOT apply a cash-in-lieu split (the fractional basis would vanish)", () => {
    const a = action({ ratio: 0.5, terms: { cashInLieuOfFractional: true } });
    const out = applyActions(LOTS, [a]);
    // Left untouched: applying it would drop 0.5 shares of basis with no payout.
    expect(positionQuantity(out, "AAPL")).toBe(15);
    expect(totalBasis(out)).toBe(1_500);
  });

  it("DOES apply a plain split — no cash involved, basis conserved", () => {
    const out = applyActions(LOTS, [action({ ratio: 2 })]);
    expect(positionQuantity(out, "AAPL")).toBe(30);
    expect(totalBasis(out)).toBe(1_500);
  });

  it("does NOT apply a cash-out merger (position would close unpaid)", () => {
    const a = action({ type: "merger", newSymbol: "NEWCO", terms: { cashPerShare: 200 } });
    const out = applyActions(LOTS, [a]);
    // The holder still shows as owning AAPL, which is imprecise but TRUE: they
    // have not been paid. Closing it here would show shares gone and no cash.
    expect(positionQuantity(out, "AAPL")).toBe(15);
    expect(totalBasis(out)).toBe(1_500);
  });

  it("DOES apply a pure stock-for-stock merger — value moves, none leaves", () => {
    const a = action({ type: "merger", ratio: 0.5, newSymbol: "NEWCO" });
    const out = applyActions(LOTS, [a]);
    expect(positionQuantity(out, "AAPL")).toBe(0);
    expect(positionQuantity(out, "NEWCO")).toBe(7.5);
    expect(totalBasis(out)).toBe(1_500);
  });

  it("does NOT apply a liquidating delisting (lots would close unpaid)", () => {
    const a = action({ type: "delisting", terms: { liquidationPerShare: 100 } });
    const out = applyActions(LOTS, [a]);
    expect(positionQuantity(out, "AAPL")).toBe(15);
  });

  it("treats a ZERO liquidation as cash-bearing too — it is still a disposal", () => {
    // A worthless-security writeoff realizes a loss; that belongs in settlement
    // with the rest of the tax consequence, not in a read projection.
    const a = action({ type: "delisting", terms: { liquidationPerShare: 0 } });
    const out = applyActions(LOTS, [a]);
    expect(positionQuantity(out, "AAPL")).toBe(15);
  });

  it("DOES apply a non-liquidating delisting — freezing moves no money", () => {
    const out = applyActions(LOTS, [action({ type: "delisting" })]);
    // Frozen lots are no longer an open position, but nothing was realized.
    expect(positionQuantity(out, "AAPL")).toBe(0);
    expect(out.every((l) => l.status === "frozen")).toBe(true);
  });

  it("INVARIANT: no action sequence ever reduces total basis in the projection", () => {
    const sequences: CorporateAction[][] = [
      [action({ ratio: 2 })],
      [action({ ratio: 0.1, terms: { cashInLieuOfFractional: true } })],
      [action({ type: "merger", ratio: 0.5, newSymbol: "NEWCO" })],
      [action({ type: "merger", newSymbol: "NEWCO", terms: { cashPerShare: 200 } })],
      [action({ type: "delisting", terms: { liquidationPerShare: 50 } })],
      [
        action({ id: "a", ratio: 2 }),
        action({ id: "b", type: "symbol_change", newSymbol: "META", effectiveDate: "2026-04-01T00:00:00Z" }),
      ],
    ];
    for (const seq of sequences) {
      // Basis may MOVE between symbols, but the total must never shrink — a
      // shrink means value left the projection with no cash to show for it.
      expect(totalBasis(applyActions(LOTS, seq))).toBeCloseTo(1_500, 2);
    }
  });
});
