import { describe, expect, it } from "vitest";
import type { TradeLot } from "@/lib/corporateActions/types";
import { applySale, applySplit } from "@/lib/corporateActions/lots";
import type { CorporateAction } from "@/lib/corporateActions/types";

// ---------------------------------------------------------------------------
// Lot persistence contract (storeDb `trade_lots`).
//
// Lots are APPEND-ONLY, unlike every other child table, which storeDb syncs by
// upserting then PRUNING rows that no longer appear. Pruning lots would delete
// exactly the rows that prove what happened:
//
//   - a `closed` lot is the record of a realized gain
//   - a `split_adjusted` lot is the pre-split state a replacement points back to
//
// These tests pin the shape that makes a plain upsert safe: ids are stable,
// terminal lots are retained rather than dropped, and back-references stay
// resolvable.
// ---------------------------------------------------------------------------

const lot = (over: Partial<TradeLot> & Pick<TradeLot, "id" | "quantity" | "costBasis" | "acquiredAt">): TradeLot => ({
  userId: "u1",
  symbol: "AAPL",
  status: "open",
  ...over,
});

const BASE: TradeLot[] = [
  lot({ id: "lot_1", quantity: 100, costBasis: 15_000, acquiredAt: "2026-03-15T00:00:00Z" }),
  lot({ id: "lot_2", quantity: 50, costBasis: 7_750, acquiredAt: "2026-06-01T00:00:00Z" }),
];

/** Mirrors storeDb.lotRows() — the row actually written to Postgres. */
function toRow(l: TradeLot, uid = "u1") {
  return {
    id: l.id,
    user_id: uid,
    symbol: l.symbol,
    quantity: l.quantity,
    cost_basis: l.costBasis,
    acquired_at: l.acquiredAt,
    status: l.status,
    source_lot_id: l.sourceLotId ?? null,
    corporate_action_id: l.fromCorporateActionId ?? null,
    order_id: null,
  };
}

describe("lot row mapping", () => {
  it("maps every field the schema requires", () => {
    const row = toRow(BASE[0]);
    expect(row).toMatchObject({
      id: "lot_1",
      user_id: "u1",
      symbol: "AAPL",
      quantity: 100,
      cost_basis: 15_000,
      status: "open",
      source_lot_id: null,
      corporate_action_id: null,
    });
    // NOT NULL in the migration — an undefined here would fail the insert.
    expect(row.acquired_at).toBeTruthy();
  });

  it("satisfies the open_lot_has_shares CHECK constraint", () => {
    // The migration rejects an open lot with zero quantity: it would sit in the
    // FIFO ordering forever, consuming nothing.
    for (const r of BASE.map((l) => toRow(l))) {
      if (r.status === "open") expect(r.quantity).toBeGreaterThan(0);
    }
  });
});

describe("append-only invariants", () => {
  it("a sale RETAINS the closed lot rather than removing it", () => {
    // Pruning here would erase the record of a realized gain.
    const sale = applySale(BASE, "AAPL", 100, 20_000);
    const closed = sale.remaining.find((l) => l.id === "lot_1")!;
    expect(closed.status).toBe("closed");
    expect(closed.quantity).toBe(0);
    // Still present in the row set that gets upserted.
    expect(sale.remaining.map((l) => l.id)).toContain("lot_1");
  });

  it("a split RETAINS the pre-split lot and links the replacement to it", () => {
    const split: CorporateAction = {
      id: "ca_split",
      symbol: "AAPL",
      type: "stock_split",
      effectiveDate: "2026-07-15",
      ratio: 2,
      source: "manual",
      confidence: "confirmed",
    };
    const { lots } = applySplit(BASE, split);

    const original = lots.find((l) => l.id === "lot_1")!;
    expect(original.status).toBe("split_adjusted");
    expect(original.quantity).toBe(100); // history intact

    const replacement = lots.find((l) => l.sourceLotId === "lot_1")!;
    expect(replacement.status).toBe("open");
    expect(replacement.quantity).toBe(200);

    // The FK target must be in the same write batch, or the insert violates
    // trade_lots.source_lot_id REFERENCES trade_lots(id).
    const ids = new Set(lots.map((l) => l.id));
    for (const l of lots) {
      if (l.sourceLotId) expect(ids.has(l.sourceLotId)).toBe(true);
    }
  });

  it("keeps lot ids stable so upsert updates rather than duplicates", () => {
    const sale = applySale(BASE, "AAPL", 40, 8_000);
    // The partially-consumed lot keeps its id; only quantity/basis change.
    const touched = sale.remaining.find((l) => l.id === "lot_1")!;
    expect(touched.quantity).toBe(60);
    expect(sale.remaining.filter((l) => l.id === "lot_1")).toHaveLength(1);
  });

  it("generates unique ids for split replacements", () => {
    const split: CorporateAction = {
      id: "ca_x", symbol: "AAPL", type: "stock_split",
      effectiveDate: "2026-07-15", ratio: 2, source: "manual", confidence: "confirmed",
    };
    const { lots } = applySplit(BASE, split);
    const ids = lots.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length); // no PK collision on upsert
  });

  it("row count only grows across a sale then a split", () => {
    const split: CorporateAction = {
      id: "ca_y", symbol: "AAPL", type: "stock_split",
      effectiveDate: "2026-07-15", ratio: 2, source: "manual", confidence: "confirmed",
    };
    const afterSale = applySale(BASE, "AAPL", 40, 8_000).remaining;
    const afterSplit = applySplit(afterSale, split).lots;
    expect(afterSale.length).toBeGreaterThanOrEqual(BASE.length);
    expect(afterSplit.length).toBeGreaterThan(afterSale.length);
  });
});
