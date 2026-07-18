import { describe, expect, it } from "vitest";
import {
  applySale,
  applySplit,
  applySymbolChange,
  dividendEntitlement,
  orderLots,
  positionCostBasis,
  positionQuantity,
} from "@/lib/corporateActions/lots";
import type { CorporateAction, TradeLot } from "@/lib/corporateActions/types";

// ---------------------------------------------------------------------------
// Tax-lot arithmetic. Portfolio state was a mutable aggregate — a buy did
// `shares += qty; costBasis += notional`, a sell scaled basis by a fraction.
// That is average-cost with no history, and it makes corporate actions
// impossible: a split has to mutate both numbers with no record of the before,
// and a dividend cannot know the record-date position.
//
// Two invariants must hold for every operation:
//   1. A split never changes total cost basis.
//   2. A sale never invents or loses shares.
// ---------------------------------------------------------------------------

const lot = (over: Partial<TradeLot> & Pick<TradeLot, "id" | "quantity" | "costBasis" | "acquiredAt">): TradeLot => ({
  userId: "u1",
  symbol: "AAPL",
  status: "open",
  ...over,
});

// 100 @ $150 then 50 @ $155 — the audit's own worked example.
const BASE: TradeLot[] = [
  lot({ id: "lot_1", quantity: 100, costBasis: 15_000, acquiredAt: "2026-03-15T14:30:00Z" }),
  lot({ id: "lot_2", quantity: 50, costBasis: 7_750, acquiredAt: "2026-06-01T14:30:00Z" }),
];

describe("position aggregation", () => {
  it("sums open lots", () => {
    expect(positionQuantity(BASE, "AAPL")).toBe(150);
    expect(positionCostBasis(BASE, "AAPL")).toBe(22_750);
  });

  it("ignores closed and superseded lots", () => {
    const withDead: TradeLot[] = [
      ...BASE,
      lot({ id: "dead", quantity: 0, costBasis: 0, acquiredAt: "2026-01-01T00:00:00Z", status: "closed" }),
      lot({ id: "old", quantity: 999, costBasis: 999, acquiredAt: "2026-01-01T00:00:00Z", status: "split_adjusted" }),
    ];
    expect(positionQuantity(withDead, "AAPL")).toBe(150);
    expect(positionCostBasis(withDead, "AAPL")).toBe(22_750);
  });
});

describe("lot ordering", () => {
  it("fifo takes the oldest first", () => {
    expect(orderLots(BASE, "fifo").map((l) => l.id)).toEqual(["lot_1", "lot_2"]);
  });
  it("lifo takes the newest first", () => {
    expect(orderLots(BASE, "lifo").map((l) => l.id)).toEqual(["lot_2", "lot_1"]);
  });
  it("hifo takes the most expensive per share first", () => {
    // lot_2 is $155/sh vs lot_1 at $150/sh.
    expect(orderLots(BASE, "hifo").map((l) => l.id)).toEqual(["lot_2", "lot_1"]);
  });
});

describe("applySale", () => {
  it("consumes a single lot partially and reports the realized gain", () => {
    // Sell 40 @ $200 = $8,000. FIFO basis = 40 × $150 = $6,000.
    const r = applySale(BASE, "AAPL", 40, 8_000, "fifo");
    expect(r.costBasis).toBe(6_000);
    expect(r.realizedGain).toBe(2_000);
    expect(r.consumed).toEqual([{ lotId: "lot_1", quantity: 40, costBasis: 6_000 }]);
    expect(positionQuantity(r.remaining, "AAPL")).toBe(110);
    expect(positionCostBasis(r.remaining, "AAPL")).toBe(16_750);
  });

  it("spans multiple lots and closes the exhausted one", () => {
    // Sell 120: all of lot_1 (100 @ $150) + 20 of lot_2 (20 × $155 = $3,100).
    const r = applySale(BASE, "AAPL", 120, 24_000, "fifo");
    expect(r.costBasis).toBe(18_100);
    expect(r.realizedGain).toBe(5_900);
    expect(r.remaining.find((l) => l.id === "lot_1")!.status).toBe("closed");
    expect(positionQuantity(r.remaining, "AAPL")).toBe(30);
  });

  it("hifo realizes a smaller gain than fifo on the same sale", () => {
    const f = applySale(BASE, "AAPL", 50, 10_000, "fifo");
    const h = applySale(BASE, "AAPL", 50, 10_000, "hifo");
    expect(h.realizedGain).toBeLessThan(f.realizedGain);
  });

  it("records a loss as a negative gain", () => {
    const r = applySale(BASE, "AAPL", 10, 1_000, "fifo"); // basis 1,500
    expect(r.realizedGain).toBe(-500);
  });

  it("REFUSES to sell more than is held", () => {
    // Silently allowing this is how a ledger goes negative.
    expect(() => applySale(BASE, "AAPL", 151, 30_000)).toThrow(/insufficient position/);
  });

  it("rejects a non-positive quantity", () => {
    expect(() => applySale(BASE, "AAPL", 0, 0)).toThrow(/must be positive/);
  });

  it("INVARIANT: consumed quantity always equals the sale quantity", () => {
    for (const qty of [1, 7.5, 33.333, 99.9, 100, 149.99999999, 150]) {
      const r = applySale(BASE, "AAPL", qty, qty * 200);
      const taken = r.consumed.reduce((s, c) => s + c.quantity, 0);
      expect(taken).toBeCloseTo(qty, 6);
      // And nothing goes negative.
      for (const l of r.remaining) expect(l.quantity).toBeGreaterThanOrEqual(0);
    }
  });

  it("INVARIANT: basis removed + basis remaining == basis before", () => {
    const before = positionCostBasis(BASE, "AAPL");
    for (const qty of [10, 50, 100, 150]) {
      const r = applySale(BASE, "AAPL", qty, 1);
      expect(r.costBasis + positionCostBasis(r.remaining, "AAPL")).toBeCloseTo(before, 2);
    }
  });
});

describe("applySplit", () => {
  const split = (ratio: number): CorporateAction => ({
    id: "ca_split",
    symbol: "AAPL",
    type: ratio >= 1 ? "stock_split" : "reverse_split",
    effectiveDate: "2026-07-15",
    ratio,
    source: "manual",
    confidence: "confirmed",
  });

  it("2-for-1 doubles shares and halves per-share basis", () => {
    const { lots } = applySplit(BASE, split(2));
    expect(positionQuantity(lots, "AAPL")).toBe(300);
    // The whole point: total basis is untouched.
    expect(positionCostBasis(lots, "AAPL")).toBe(22_750);
    const l1 = lots.find((l) => l.sourceLotId === "lot_1")!;
    expect(l1.quantity).toBe(200);
    expect(l1.costBasis / l1.quantity).toBeCloseTo(75, 6); // was $150/sh
  });

  it("1-for-10 reverse split reduces shares and raises per-share basis", () => {
    const { lots } = applySplit(BASE, split(0.1));
    expect(positionQuantity(lots, "AAPL")).toBe(15);
    expect(positionCostBasis(lots, "AAPL")).toBe(22_750);
  });

  it("supersedes rather than mutates, keeping the pre-split lot auditable", () => {
    const { lots } = applySplit(BASE, split(2));
    const original = lots.find((l) => l.id === "lot_1")!;
    expect(original.status).toBe("split_adjusted");
    expect(original.quantity).toBe(100); // untouched history
    const replacement = lots.find((l) => l.sourceLotId === "lot_1")!;
    expect(replacement.fromCorporateActionId).toBe("ca_split");
  });

  it("leaves other symbols alone", () => {
    const mixed = [...BASE, lot({ id: "nvda", symbol: "NVDA", quantity: 10, costBasis: 1_000, acquiredAt: "2026-01-01T00:00:00Z" })];
    const { lots } = applySplit(mixed, split(2));
    expect(positionQuantity(lots, "NVDA")).toBe(10);
    expect(positionCostBasis(lots, "NVDA")).toBe(1_000);
  });

  it("pays cash in lieu of a fractional share and removes exactly that basis", () => {
    const odd = [lot({ id: "odd", quantity: 15, costBasis: 1_500, acquiredAt: "2026-01-01T00:00:00Z" })];
    // 1-for-2 reverse: 15 → 7.5 shares. Broker pays out the 0.5.
    const { lots, cashInLieu } = applySplit(odd, split(0.5), { cashInLieuOfFractional: true });
    expect(positionQuantity(lots, "AAPL")).toBe(7);
    // Post-split per-share basis is 1500/7.5 = $200; the 0.5 share is $100.
    expect(cashInLieu).toBe(100);
    expect(positionCostBasis(lots, "AAPL") + cashInLieu).toBeCloseTo(1_500, 2);
  });

  it("rejects an invalid ratio instead of silently corrupting the position", () => {
    for (const bad of [0, -2, Number.NaN, undefined]) {
      expect(() => applySplit(BASE, { ...split(2), ratio: bad as number })).toThrow(/invalid ratio/);
    }
  });

  it("INVARIANT: total cost basis is unchanged for any ratio", () => {
    const before = positionCostBasis(BASE, "AAPL");
    for (const ratio of [1.5, 2, 3, 4, 7, 10, 0.5, 0.2, 0.1, 0.05]) {
      const { lots } = applySplit(BASE, split(ratio));
      expect(positionCostBasis(lots, "AAPL")).toBeCloseTo(before, 2);
      expect(positionQuantity(lots, "AAPL")).toBeCloseTo(150 * ratio, 6);
    }
  });

  it("INVARIANT: splitting then selling everything realizes the same gain as selling before", () => {
    const proceeds = 40_000;
    const direct = applySale(BASE, "AAPL", 150, proceeds);
    const { lots } = applySplit(BASE, split(4));
    const afterSplit = applySale(lots, "AAPL", 600, proceeds);
    // A split is not a taxable event: same economics either way.
    expect(afterSplit.realizedGain).toBeCloseTo(direct.realizedGain, 2);
  });
});

describe("dividendEntitlement", () => {
  const div: CorporateAction = {
    id: "ca_div",
    symbol: "AAPL",
    type: "cash_dividend",
    effectiveDate: "2026-07-01",
    recordDate: "2026-07-05",
    paymentDate: "2026-07-20",
    amountPerShare: 0.25,
    source: "alpaca",
    confidence: "confirmed",
  };

  it("pays on the record-date position", () => {
    const e = dividendEntitlement(BASE, div);
    expect(e.sharesHeld).toBe(150);
    expect(e.grossAmount).toBe(37.5);
    expect(e.netAmount).toBe(37.5);
  });

  it("EXCLUDES shares bought after the record date", () => {
    // Buying after the ex-date does not earn the dividend; using today's
    // position instead of the record-date position over-pays every holder.
    const late = [...BASE, lot({ id: "late", quantity: 1_000, costBasis: 200_000, acquiredAt: "2026-07-10T00:00:00Z" })];
    expect(dividendEntitlement(late, div).sharesHeld).toBe(150);
  });

  it("applies withholding tax", () => {
    const e = dividendEntitlement(BASE, div, { withholdingRate: 0.3 });
    expect(e.grossAmount).toBe(37.5);
    expect(e.withholdingTax).toBe(11.25);
    expect(e.netAmount).toBe(26.25);
  });

  it("refuses a non-dividend action", () => {
    expect(() => dividendEntitlement(BASE, { ...div, type: "stock_split" })).toThrow(/not a cash dividend/);
  });

  it("refuses an invalid per-share amount", () => {
    expect(() => dividendEntitlement(BASE, { ...div, amountPerShare: -1 })).toThrow(/invalid amountPerShare/);
  });
});

describe("applySymbolChange", () => {
  it("renames without touching quantity or basis", () => {
    const action: CorporateAction = {
      id: "ca_sym",
      symbol: "AAPL",
      type: "symbol_change",
      effectiveDate: "2026-08-01",
      newSymbol: "APPL",
      source: "manual",
      confidence: "confirmed",
    };
    const out = applySymbolChange(BASE, action);
    expect(positionQuantity(out, "APPL")).toBe(150);
    expect(positionCostBasis(out, "APPL")).toBe(22_750);
    expect(positionQuantity(out, "AAPL")).toBe(0);
  });
});
