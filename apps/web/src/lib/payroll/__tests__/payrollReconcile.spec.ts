import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics } from "viem";

const h = vi.hoisted(() => ({ rpc: vi.fn(), sbSelect: vi.fn(), sbRpc: vi.fn(), alerts: [] as { kind: string; severity: string }[] }));
vi.mock("@/lib/payments/merchant/rpc", async (orig) => ({ ...(await orig<object>()), rpc: h.rpc }));
vi.mock("@/lib/supabase", () => ({ sbSelect: h.sbSelect, sbRpc: h.sbRpc, sbUpdate: vi.fn(), sbCount: vi.fn(), sbInsertIgnoreDuplicates: vi.fn(), supabaseBackend: "supabase" }));
vi.mock("@/lib/alerts", () => ({ raiseAlert: vi.fn(async (a: { kind: string; severity: string }) => { h.alerts.push(a); return {}; }) }));

import { reconcilePayroll } from "../reconcile";
import { ROUTER_ABI } from "../routerAbi";

// Payroll reconciliation: books vs executions vs chain, and partial batches reported as partial.
const ROUTER = "0x" + "e7".repeat(20), TX = "0x" + "aa".repeat(32), BLOCK = "0x" + "bb".repeat(32);
const NOW = Date.parse("2026-10-09T12:00:00Z");
const batch = { id: "22222222-2222-4222-8222-222222222222", chain: "arbitrum", status: "completed", submitted_at: "2026-10-09T10:00:00Z" };
const line = { id: "l1", batch_id: batch.id, payment_id: "pay_1", executed_tx: TX, executed_at: "2026-10-09T11:00:00Z" };
const event = (paymentId = "pay_1") => ({ address: ROUTER, topics: encodeEventTopics({ abi: ROUTER_ABI, eventName: "PaymentExecuted", args: { payer: ("0x" + "70".repeat(20)) as `0x${string}`, recipient: ("0x" + "ab".repeat(20)) as `0x${string}` } }),
  data: encodeAbiParameters([{ type: "string" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32" }], [paymentId, 10n, 1n, ("0x" + "cd".repeat(32)) as `0x${string}`]) });
let receipt: object | null, canonical = BLOCK, partial: object[] = [];
beforeEach(() => {
  vi.stubEnv("FURLPAY_ROUTER_ADDRESS_ARBITRUM", ROUTER);
  h.alerts.length = 0; receipt = { status: "0x1", blockNumber: "0x10", blockHash: BLOCK, logs: [event()] }; canonical = BLOCK; partial = [];
  h.sbRpc.mockResolvedValue([]);
  h.sbSelect.mockImplementation(async (t: string, q: string) => t === "payroll_batch_lines" ? (q.startsWith("executed_at") ? [line] : [{ id: "a", executed_tx: TX }, { id: "b", executed_tx: null }]) : q.startsWith("status=eq.submitted") ? partial : [batch]);
  h.rpc.mockImplementation(async (_c: string, m: string) => m === "eth_getTransactionReceipt" ? receipt : { hash: canonical });
});

describe("payroll reconciliation", () => {
  it("is quiet when books, chain and batches agree", async () => {
    expect(await reconcilePayroll(undefined, undefined, NOW)).toMatchObject({ findings: 0, linesChecked: 1 });
    expect(h.alerts).toEqual([]);
  });
  it("pages critically when a recorded execution is reorged out, reverted, or lost its event", async () => {
    for (const set of [() => { canonical = "0x" + "cc".repeat(32); }, () => { receipt = { ...receipt!, status: "0x0" }; }, () => { receipt = null; }, () => { receipt = { ...receipt!, logs: [event("someone_else")] }; }]) {
      h.alerts.length = 0; receipt = { status: "0x1", blockNumber: "0x10", blockHash: BLOCK, logs: [event()] }; canonical = BLOCK; set();
      await reconcilePayroll(undefined, undefined, NOW);
      expect(h.alerts).toEqual([expect.objectContaining({ kind: "payroll.execution_not_on_chain", severity: "critical" })]);
    }
  });
  it("reports fee-journal findings from the database as critical", async () => {
    h.sbRpc.mockResolvedValue([{ batch_id: batch.id, line_id: "l1", problem: "fee_journal_missing" }]);
    await reconcilePayroll(undefined, undefined, NOW);
    expect(h.alerts).toContainEqual(expect.objectContaining({ kind: "payroll.fee_journal", severity: "critical" }));
  });
  it("reports a day-old partly executed batch as partial", async () => {
    partial = [{ ...batch, status: "submitted", submitted_at: "2026-10-07T00:00:00Z" }];
    const r = await reconcilePayroll(undefined, undefined, NOW);
    expect(r.byKind).toMatchObject({ batch_partial: 1 });
    expect(h.alerts).toContainEqual(expect.objectContaining({ kind: "payroll.batch_partial" }));
  });
  it("an RPC outage is 'could not verify', never a reorg", async () => {
    h.rpc.mockRejectedValue(new Error("Network reader unavailable"));
    await reconcilePayroll(undefined, undefined, NOW);
    expect(h.alerts).toEqual([expect.objectContaining({ kind: "payroll.chain_unavailable", severity: "medium" })]);
  });
});
