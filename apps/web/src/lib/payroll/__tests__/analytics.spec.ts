import { describe, expect, it } from "vitest";
import { summarize, windowStart } from "../analytics";
import type { Batch } from "../model";

// Payroll analytics never mixes money that moved with money that might.
const batch = (id: string, cycle: string, status: Batch["status"], gross: number, over: Partial<Batch> = {}): Batch => ({
  id, merchant_id: "m", cycle, chain: "arbitrum", status, payer_address: null, headcount: 1,
  gross_units: String(gross), batch_fee_units: "1500000", seat_fee_units: "0", total_quote_units: String(gross + 1_500_000),
  created_at: `${cycle}-05T00:00:00Z`, submitted_at: null, ...over,
});
const TX = "0x" + "ab".repeat(32);
const line = (batch_id: string, amount: number, executed: boolean, contractor = "c1", name = "Ada") => ({
  batch_id, contractor_id: contractor, name, amount_units: String(amount),
  executed_tx: executed ? TX : null, executed_at: executed ? "2026-10-07T10:00:00Z" : null,
});

describe("payroll analytics", () => {
  const batches = [
    batch("b1", "2026-10", "completed", 3_000_000_000),
    batch("b2", "2026-10", "submitted", 2_000_000_000, { chain: "base" }),
    batch("b3", "2026-09", "draft", 500_000_000),
    batch("b4", "2026-09", "cancelled", 9_000_000_000),
  ];
  const lines = [
    line("b1", 1_000_000_000, true),
    line("b1", 2_000_000_000, true, "c2", "Grace"),
    line("b2", 1_200_000_000, true),
    line("b2", 800_000_000, false, "c2", "Grace"),
    line("b3", 500_000_000, false),
    line("b4", 9_000_000_000, false),
  ];
  const a = summarize("2026-09", batches, lines);

  it("counts as paid only lines whose execution was verified, and keeps pending and prepared apart", () => {
    expect(a.totals.paidUnits).toBe("4200000000");
    expect(a.totals.pendingUnits).toBe("800000000");
    expect(a.totals.preparedUnits).toBe("500000000");
    expect(a.totals.paidLines).toBe(3);
  });

  it("leaves cancelled batches out of every amount but reports them by status", () => {
    expect(a.totals.batches).toBe(3);
    expect(a.byStatus).toEqual({ completed: 1, submitted: 1, draft: 1, cancelled: 1 });
    expect(a.totals.quotedFeeUnits).toBe("4500000");
  });

  it("breaks paid amounts down by cycle (newest first), chain and contractor", () => {
    expect(a.byCycle.map((c) => [c.cycle, c.paidUnits, c.pendingUnits, c.preparedUnits])).toEqual([
      ["2026-10", "4200000000", "800000000", "0"],
      ["2026-09", "0", "0", "500000000"],
    ]);
    expect(a.byChain).toEqual({ arbitrum: { paidUnits: "3000000000", batches: 2 }, base: { paidUnits: "1200000000", batches: 1 } });
    expect(a.topContractors).toEqual([
      { contractorId: "c1", name: "Ada", paidUnits: "2200000000", paidLines: 2, lastPaidAt: "2026-10-07T10:00:00Z" },
      { contractorId: "c2", name: "Grace", paidUnits: "2000000000", paidLines: 1, lastPaidAt: "2026-10-07T10:00:00Z" },
    ]);
  });

  it("stays exact beyond 2^53 micro-units", () => {
    const big = summarize("2026-10", [batch("x", "2026-10", "completed", 0)], [line("x", 0, true), { ...line("x", 0, true), amount_units: "9007199254740993" }]);
    expect(big.totals.paidUnits).toBe("9007199254740993");
  });

  it("computes the window start in UTC months", () => {
    expect(windowStart(1, Date.parse("2026-10-11T00:00:00Z"))).toBe("2026-10");
    expect(windowStart(6, Date.parse("2026-10-11T00:00:00Z"))).toBe("2026-05");
    expect(windowStart(12, Date.parse("2026-01-31T23:00:00Z"))).toBe("2025-02");
  });
});
