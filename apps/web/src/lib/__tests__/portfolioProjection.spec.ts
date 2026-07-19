import { describe, expect, it } from "vitest";
import {
  applyActions,
  orderActions,
  projectDividends,
  projectHoldings,
  recordBuy,
  recordSell,
  usableActions,
} from "@/lib/corporateActions/projector";
import type { CorporateAction, TradeLot } from "@/lib/corporateActions/types";

// ---------------------------------------------------------------------------
// holdings[] is now a PROJECTION of the lot ledger, not the source of truth.
// These cover the projection itself plus the three replay hazards that silently
// corrupt positions: duplicate delivery, superseded corrections, and
// out-of-order arrival.
// ---------------------------------------------------------------------------

const quote = (price: number, changePct = 0, name?: string) => () => ({ price, changePct, name });

const split = (id: string, symbol: string, ratio: number, effectiveDate: string): CorporateAction => ({
  id,
  symbol,
  type: ratio >= 1 ? "stock_split" : "reverse_split",
  effectiveDate,
  ratio,
  source: "manual",
  confidence: "confirmed",
});

const dividend = (
  id: string,
  symbol: string,
  amountPerShare: number,
  effectiveDate: string,
  recordDate?: string,
  paymentDate?: string,
): CorporateAction => ({
  id,
  symbol,
  type: "cash_dividend",
  effectiveDate,
  recordDate: recordDate ?? effectiveDate,
  paymentDate,
  amountPerShare,
  source: "manual",
  confidence: "confirmed",
});

describe("recordBuy", () => {
  it("creates an open lot", () => {
    const lot = recordBuy({ id: "l1", userId: "u1", symbol: "AAPL", quantity: 10, costBasis: 1_500 });
    expect(lot).toMatchObject({ symbol: "AAPL", quantity: 10, costBasis: 1_500, status: "open" });
    expect(Date.parse(lot.acquiredAt)).not.toBeNaN();
  });

  it("rejects non-positive quantity and negative basis", () => {
    expect(() => recordBuy({ id: "x", userId: "u", symbol: "A", quantity: 0, costBasis: 1 })).toThrow(/positive/);
    expect(() => recordBuy({ id: "x", userId: "u", symbol: "A", quantity: 1, costBasis: -1 })).toThrow(/negative/);
  });

  it("NEVER merges into an existing position", () => {
    // Two buys at different prices must stay distinguishable, or a later sale
    // cannot know what was actually paid per share.
    const a = recordBuy({ id: "l1", userId: "u1", symbol: "AAPL", quantity: 10, costBasis: 1_500 });
    const b = recordBuy({ id: "l2", userId: "u1", symbol: "AAPL", quantity: 10, costBasis: 2_000 });
    const holdings = projectHoldings([a, b], [], quote(200));
    expect(holdings).toHaveLength(1);
    expect(holdings[0].shares).toBe(20);
    expect(holdings[0].costBasis).toBe(3_500); // not averaged away
  });
});

describe("projectHoldings", () => {
  const lots: TradeLot[] = [
    recordBuy({ id: "l1", userId: "u1", symbol: "AAPL", quantity: 10, costBasis: 1_500, acquiredAt: "2026-01-01T00:00:00Z" }),
    recordBuy({ id: "l2", userId: "u1", symbol: "NVDA", quantity: 2, costBasis: 2_000, acquiredAt: "2026-02-01T00:00:00Z" }),
  ];

  it("derives shares, basis and market value from the ledger", () => {
    const h = projectHoldings(lots, [], (s) => (s === "AAPL" ? { price: 200, changePct: 1.5 } : { price: 1_200, changePct: -2 }));
    const aapl = h.find((x) => x.symbol === "AAPL")!;
    expect(aapl.shares).toBe(10);
    expect(aapl.costBasis).toBe(1_500);
    expect(aapl.marketValue).toBe(2_000);
    expect(aapl.changePct).toBe(1.5);
  });

  it("omits fully closed positions", () => {
    const sale = recordSell(lots, "AAPL", 10, 2_000);
    expect(projectHoldings(sale.remaining, [], quote(200)).map((h) => h.symbol)).toEqual(["NVDA"]);
  });

  it("keeps shares and basis when a quote is missing", () => {
    // An unpriced asset still has a real position — it must not vanish.
    const h = projectHoldings(lots, [], () => undefined);
    expect(h.find((x) => x.symbol === "AAPL")!.shares).toBe(10);
    expect(h.find((x) => x.symbol === "AAPL")!.costBasis).toBe(1_500);
    expect(h.find((x) => x.symbol === "AAPL")!.marketValue).toBe(0);
  });

  it("is deterministic — same inputs, same output", () => {
    const a = projectHoldings(lots, [], quote(200));
    const b = projectHoldings(lots, [], quote(200));
    expect(a).toEqual(b);
  });

  it("applies a split during projection", () => {
    const h = projectHoldings(lots, [split("ca1", "AAPL", 2, "2026-03-01")], quote(100));
    const aapl = h.find((x) => x.symbol === "AAPL")!;
    expect(aapl.shares).toBe(20);
    expect(aapl.costBasis).toBe(1_500); // basis unchanged — not a taxable event
  });

  it("does NOT apply a split that predates a lot's acquisition", () => {
    // Full-history ingestion includes old splits. A position opened in 2026 is
    // already post-split, so a 2020 4:1 split must leave it untouched.
    const h = projectHoldings(lots, [split("ca_old", "AAPL", 4, "2020-08-31")], quote(100));
    expect(h.find((x) => x.symbol === "AAPL")!.shares).toBe(10);
  });
});

describe("replay hazards", () => {
  const base = [recordBuy({ id: "l1", userId: "u1", symbol: "AAPL", quantity: 100, costBasis: 15_000, acquiredAt: "2026-01-01T00:00:00Z" })];

  it("sorts by effectiveDate, NOT insertion order", () => {
    const later = split("b", "AAPL", 2, "2026-06-01");
    const earlier = split("a", "AAPL", 3, "2026-03-01");
    expect(orderActions([later, earlier]).map((a) => a.id)).toEqual(["a", "b"]);
  });

  it("IDEMPOTENT: a duplicate split is applied once", () => {
    // A retried ingest delivering the same event twice must not quadruple the
    // position.
    const s = split("ca_dup", "AAPL", 2, "2026-03-01");
    const once = applyActions(base, [s]);
    const twice = applyActions(base, [s, s]);
    expect(projectHoldings(once, [], quote(1))[0].shares).toBe(200);
    expect(projectHoldings(twice, [], quote(1))[0].shares).toBe(200);
  });

  it("a correction SUPERSEDES the original rather than stacking on it", () => {
    // Announced 2:1, corrected to 3:1. Applying both would give 6x.
    const announced = { ...split("ca_v1", "AAPL", 2, "2026-03-01"), confidence: "announced" as const };
    const corrected: CorporateAction = {
      ...split("ca_v2", "AAPL", 3, "2026-03-01"),
      confidence: "corrected",
      supersedes: "ca_v1",
    };
    const usable = usableActions([announced, corrected]);
    expect(usable.map((a) => a.id)).toEqual(["ca_v2"]);
    expect(projectHoldings(applyActions(base, [announced, corrected]), [], quote(1))[0].shares).toBe(300);
  });

  it("a late-arriving split still applies before the one that followed it", () => {
    const march = split("ca_mar", "AAPL", 2, "2026-03-01");
    const june = split("ca_jun", "AAPL", 3, "2026-06-01");
    // Delivered out of order; result must equal chronological application.
    const outOfOrder = projectHoldings(applyActions(base, [june, march]), [], quote(1));
    const inOrder = projectHoldings(applyActions(base, [march, june]), [], quote(1));
    expect(outOfOrder[0].shares).toBe(600); // 100 → 200 → 600
    expect(outOfOrder).toEqual(inOrder);
  });

  it("INVARIANT: no sequence of splits changes total cost basis", () => {
    const before = projectHoldings(base, [], quote(1))[0].costBasis;
    const seq = [split("a", "AAPL", 2, "2026-02-01"), split("b", "AAPL", 3, "2026-04-01"), split("c", "AAPL", 0.5, "2026-06-01")];
    expect(projectHoldings(applyActions(base, seq), [], quote(1))[0].costBasis).toBeCloseTo(before, 2);
  });
});

describe("projectDividends", () => {
  const hundred = () => [
    recordBuy({ id: "l1", userId: "u1", symbol: "AAPL", quantity: 100, costBasis: 15_000, acquiredAt: "2026-01-01T00:00:00Z" }),
  ];

  it("pays on the position held on the record date", () => {
    const d = projectDividends(hundred(), [dividend("d1", "AAPL", 0.25, "2026-02-01")]);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ symbol: "AAPL", sharesHeld: 100, amountPerShare: 0.25, grossAmount: 25 });
  });

  it("EXCLUDES shares bought after the record date", () => {
    const lots = [
      ...hundred(),
      recordBuy({ id: "l2", userId: "u1", symbol: "AAPL", quantity: 50, costBasis: 8_000, acquiredAt: "2026-03-01T00:00:00Z" }),
    ];
    const d = projectDividends(lots, [dividend("d1", "AAPL", 1, "2026-02-01", "2026-02-01")]);
    expect(d[0].sharesHeld).toBe(100); // the 50 bought in March don't qualify
  });

  it("counts a split BEFORE the record date (pays on the adjusted count)", () => {
    const actions = [split("s1", "AAPL", 2, "2026-02-01"), dividend("d1", "AAPL", 0.5, "2026-03-01", "2026-03-01")];
    const d = projectDividends(hundred(), actions);
    expect(d[0].sharesHeld).toBe(200); // 100 → 200 after the split
    expect(d[0].grossAmount).toBe(100); // 200 × 0.5
  });

  it("does NOT let a split AFTER the record date inflate an earlier dividend", () => {
    const actions = [dividend("d1", "AAPL", 0.5, "2026-02-01", "2026-02-01"), split("s1", "AAPL", 2, "2026-03-01")];
    const d = projectDividends(hundred(), actions);
    expect(d[0].sharesHeld).toBe(100); // split is later; dividend paid on 100
  });

  it("honours a superseding correction and never double-counts", () => {
    const announced = { ...dividend("d_v1", "AAPL", 0.25, "2026-02-01"), confidence: "announced" as const };
    const corrected: CorporateAction = { ...dividend("d_v2", "AAPL", 0.3, "2026-02-01"), confidence: "corrected", supersedes: "d_v1" };
    const d = projectDividends(hundred(), [announced, corrected]);
    expect(d).toHaveLength(1);
    expect(d[0].amountPerShare).toBe(0.3);
  });

  it("applies withholding to the net amount", () => {
    const d = projectDividends(hundred(), [dividend("d1", "AAPL", 1, "2026-02-01")], { withholdingRate: 0.3 });
    expect(d[0].grossAmount).toBe(100);
    expect(d[0].netAmount).toBe(70);
  });

  it("omits a dividend for a position not yet held on the record date", () => {
    const lots = [recordBuy({ id: "l1", userId: "u1", symbol: "AAPL", quantity: 100, costBasis: 15_000, acquiredAt: "2026-05-01T00:00:00Z" })];
    expect(projectDividends(lots, [dividend("d1", "AAPL", 1, "2026-02-01", "2026-02-01")])).toHaveLength(0);
  });
});

describe("buy → split → sell (the full money path)", () => {
  it("realizes gain against split-adjusted basis", () => {
    // Buy 100 @ $150 = $15,000, then 2:1 split → 200 @ $75/sh.
    let lots = [recordBuy({ id: "l1", userId: "u1", symbol: "AAPL", quantity: 100, costBasis: 15_000, acquiredAt: "2026-01-01T00:00:00Z" })];
    lots = applyActions(lots, [split("ca", "AAPL", 2, "2026-03-01")]);
    expect(projectHoldings(lots, [], quote(100))[0].shares).toBe(200);

    // Sell half (100 shares) at $100 = $10,000. FIFO basis = 100 × $75 = $7,500.
    const sale = recordSell(lots, "AAPL", 100, 10_000);
    expect(sale.costBasis).toBe(7_500);
    expect(sale.realizedGain).toBe(2_500);

    const after = projectHoldings(sale.remaining, [], quote(100))[0];
    expect(after.shares).toBe(100);
    expect(after.costBasis).toBe(7_500); // the untouched half
  });
});
