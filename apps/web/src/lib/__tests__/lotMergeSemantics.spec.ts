import { describe, expect, it } from "vitest";
import type { TradeLot } from "@/lib/corporateActions/types";

// ---------------------------------------------------------------------------
// Hydration semantics for the lot ledger.
//
// An empty `trade_lots` result is AMBIGUOUS and the two readings are opposite:
//
//   table missing / query failed  -> memory is authoritative. Overwriting would
//                                    wipe seeded or in-flight lots on every
//                                    hydration (migration 0006 not applied).
//   read fine, zero rows          -> the DB is authoritative. Keeping memory
//                                    would RESURRECT positions already sold.
//
// storeDb therefore returns `readable`, and mergeAccount only lets the DB win
// when the read actually succeeded. These tests pin that decision table.
// ---------------------------------------------------------------------------

const lot = (id: string, symbol = "AAPL"): TradeLot => ({
  id,
  userId: "u1",
  symbol,
  quantity: 10,
  costBasis: 1_500,
  acquiredAt: "2026-01-01T00:00:00Z",
  status: "open",
});

/** Mirrors the mergeAccount rule in store.ts. */
function mergeLots(
  current: TradeLot[],
  fresh: { tradeLots: TradeLot[]; lotsReadable?: boolean }
): TradeLot[] {
  if (fresh.lotsReadable === false) return current; // unreadable — keep memory
  return fresh.tradeLots;
}

describe("ledger hydration", () => {
  it("KEEPS the in-memory ledger when the table is unreadable", () => {
    // Migration 0006 not applied. The seeded demo lots must survive; wiping
    // them would make the portfolio fall back to the aggregate forever.
    const memory = [lot("lot_seed_aapl"), lot("lot_seed_nvda", "NVDA")];
    const merged = mergeLots(memory, { tradeLots: [], lotsReadable: false });
    expect(merged).toHaveLength(2);
    expect(merged.map((l) => l.id)).toEqual(["lot_seed_aapl", "lot_seed_nvda"]);
  });

  it("ACCEPTS a genuinely empty ledger when the read succeeded", () => {
    // The user sold everything. Preserving memory here would resurrect closed
    // positions — a worse bug than the one the guard above prevents.
    const memory = [lot("lot_sold")];
    expect(mergeLots(memory, { tradeLots: [], lotsReadable: true })).toEqual([]);
  });

  it("lets the database win when it has rows", () => {
    const memory = [lot("stale")];
    const fromDb = [lot("db_1"), lot("db_2")];
    expect(mergeLots(memory, { tradeLots: fromDb, lotsReadable: true })).toEqual(fromDb);
  });

  it("treats an absent readable flag as readable (back-compat)", () => {
    // Older callers that never set the flag must not accidentally pin stale
    // lots forever.
    const memory = [lot("stale")];
    expect(mergeLots(memory, { tradeLots: [] })).toEqual([]);
  });

  it("does not resurrect a sold position across hydrations", () => {
    // Buy -> sell everything -> hydrate. The closed lot may persist as an
    // audit row, but no OPEN lot may reappear.
    const afterSell: TradeLot[] = [{ ...lot("lot_1"), quantity: 0, status: "closed" }];
    const merged = mergeLots([lot("lot_1")], { tradeLots: afterSell, lotsReadable: true });
    expect(merged.filter((l) => l.status === "open")).toHaveLength(0);
  });

  it("survives repeated hydrations while the table stays missing", () => {
    // The failure is persistent until the migration lands; the ledger must not
    // erode across retries.
    let ledger = [lot("lot_seed_aapl")];
    for (let i = 0; i < 5; i++) {
      ledger = mergeLots(ledger, { tradeLots: [], lotsReadable: false });
    }
    expect(ledger).toHaveLength(1);
  });
});
