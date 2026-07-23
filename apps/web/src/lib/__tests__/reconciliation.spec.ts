import { describe, it, expect, vi, beforeEach } from "vitest";

// The module reads its data through paymentsDb, so that is the seam. Mocking
// Postgres itself would test the mock; mocking this boundary tests the
// severity logic, which is the part that decides whether anyone gets paged.
vi.mock("@/lib/paymentsDb", () => ({
  paymentsDurable: vi.fn(),
  ledgerImbalance: vi.fn(),
  paymentsMissingLedger: vi.fn(),
}));

import { runReconciliation } from "@/lib/reconciliation";
import { paymentsDurable, ledgerImbalance, paymentsMissingLedger } from "@/lib/paymentsDb";

const mockDurable = paymentsDurable as ReturnType<typeof vi.fn>;
const mockImbalance = ledgerImbalance as ReturnType<typeof vi.fn>;
const mockOrphans = paymentsMissingLedger as ReturnType<typeof vi.fn>;

const check = (r: Awaited<ReturnType<typeof runReconciliation>>, id: string) =>
  r.checks.find((c) => c.id === id);

beforeEach(() => {
  vi.clearAllMocks();
  mockDurable.mockReturnValue(true);
  mockImbalance.mockResolvedValue({ total_debits: 5000, total_credits: 5000, imbalance: 0 });
  mockOrphans.mockResolvedValue([]);
});

describe("reconciliation — clean", () => {
  it("reports ok when the books balance and nothing is orphaned", async () => {
    const r = await runReconciliation();
    expect(r.status).toBe("ok");
    expect(check(r, "ledger_balance")?.severity).toBe("ok");
    expect(check(r, "settled_without_ledger")?.severity).toBe("ok");
  });
});

describe("reconciliation — the distinction that matters", () => {
  it("does NOT report ok when there is no durable backend", async () => {
    // The single most important behaviour here. With the ledger in a
    // per-instance Map, "no imbalance" is vacuously true and would otherwise
    // read as a clean bill of health for a system with no books at all.
    mockDurable.mockReturnValue(false);
    const r = await runReconciliation();
    expect(r.status).toBe("warn");
    expect(r.durable).toBe(false);
    expect(check(r, "durability")?.summary).toContain("per-instance");
    // It must not pretend to have evaluated the checks it could not run.
    expect(check(r, "ledger_balance")).toBeUndefined();
  });

  it("warns rather than passing when a view is unavailable", async () => {
    // Migration unapplied — unknown, not clean.
    mockImbalance.mockResolvedValue(null);
    mockOrphans.mockResolvedValue(null);
    const r = await runReconciliation();
    expect(r.status).toBe("warn");
    expect(check(r, "ledger_balance")?.severity).toBe("warn");
  });
});

describe("reconciliation — failures", () => {
  it("is CRITICAL when debits and credits disagree", async () => {
    mockImbalance.mockResolvedValue({ total_debits: 5000, total_credits: 4900, imbalance: 100 });
    const r = await runReconciliation();
    expect(r.status).toBe("critical");
    const c = check(r, "ledger_balance");
    expect(c?.severity).toBe("critical");
    expect(c?.detail).toMatchObject({ imbalance: 100 });
  });

  it("is CRITICAL when a settled payment has no ledger entry", async () => {
    // Money moved on-chain and was never recorded — the worst of the three.
    mockOrphans.mockResolvedValue([{ id: "pay_1" }, { id: "pay_2" }]);
    const r = await runReconciliation();
    expect(r.status).toBe("critical");
    expect(check(r, "settled_without_ledger")?.detail).toMatchObject({ count: 2 });
  });

  it("reports a thrown check AS a critical check instead of throwing", async () => {
    // A monitor that errors gets muted; a monitor that reports a failure gets
    // acted on. runReconciliation must never propagate.
    mockImbalance.mockRejectedValue(new Error("connection reset"));
    const r = await runReconciliation();
    expect(r.status).toBe("critical");
    expect(check(r, "ledger_balance")?.summary).toContain("connection reset");
  });

  it("takes the WORST severity as the overall status", async () => {
    mockImbalance.mockResolvedValue(null); // warn
    mockOrphans.mockResolvedValue([{ id: "pay_1" }]); // critical
    const r = await runReconciliation();
    expect(r.status).toBe("critical");
  });
});

describe("reconciliation — report shape", () => {
  it("carries no counterparty addresses or PII", async () => {
    mockOrphans.mockResolvedValue([
      { id: "pay_1", recipient: "0xdeadbeef", created_by_user_id: "user-1" },
    ]);
    const r = await runReconciliation();
    const serialized = JSON.stringify(r);
    // The report is forwarded into alerts, so it stays to ids and totals.
    expect(serialized).not.toContain("0xdeadbeef");
    expect(serialized).not.toContain("user-1");
    expect(serialized).toContain("pay_1");
  });

  it("stamps the run time and returns every check", async () => {
    const r = await runReconciliation();
    expect(Date.parse(r.checkedAt)).not.toBeNaN();
    expect(r.checks.map((c) => c.id)).toEqual([
      "durability",
      "ledger_balance",
      "settled_without_ledger",
    ]);
  });
});
