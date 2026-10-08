import { describe, expect, it } from "vitest";
import { filterRows, MAX_TOLERANCE_CENTS, reconcile } from "../reconcile";

const ledger = new Map([
  ["tx-1", 10_000],
  ["tx-2", 2_500],
  ["tx-3", 999],
  ["tx-4", 100],
]);
const statement = new Map([
  ["tx-1", 10_000],
  ["tx-2", 2_503],
  ["tx-3", 1_200],
  ["ext-9", 50],
]);

describe("reconcile", () => {
  it("names why each row did or did not match", () => {
    const rows = Object.fromEntries(reconcile(ledger, statement).map((r) => [r.id, r]));
    expect(rows["tx-1"]).toMatchObject({ result: "matched", difference: 0 });
    expect(rows["tx-2"]).toMatchObject({ result: "amount_mismatch", difference: 3 });
    expect(rows["tx-4"]).toMatchObject({ result: "missing_in_statement", statementAmount: null, difference: null });
    expect(rows["ext-9"]).toMatchObject({ result: "missing_in_ledger", ledgerAmount: null });
  });

  it("a tolerance is inclusive, symmetric and labelled, never reported as an exact match", () => {
    const rows = Object.fromEntries(reconcile(ledger, statement, 3).map((r) => [r.id, r.result]));
    expect(rows["tx-2"]).toBe("within_tolerance");
    expect(rows["tx-3"]).toBe("amount_mismatch");
    expect(reconcile(new Map([["a", 103]]), new Map([["a", 100]]), 3)[0].result).toBe("within_tolerance");
  });

  it("rejects a fractional, negative or excessive tolerance", () => {
    for (const t of [-1, 0.5, MAX_TOLERANCE_CENTS + 1, Number.NaN]) expect(() => reconcile(ledger, statement, t)).toThrow();
  });

  it("filters by outcome and searches references", () => {
    const rows = reconcile(ledger, statement, 3);
    expect(filterRows(rows, "matched", "").map((r) => r.id).sort()).toEqual(["tx-1", "tx-2"]);
    expect(filterRows(rows, "exceptions", "").map((r) => r.id).sort()).toEqual(["ext-9", "tx-3", "tx-4"]);
    expect(filterRows(rows, "all", " TX-3 ").map((r) => r.id)).toEqual(["tx-3"]);
  });
});
