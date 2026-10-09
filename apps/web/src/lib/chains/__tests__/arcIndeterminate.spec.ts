import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rpc: vi.fn(), sbSelect: vi.fn(), alerts: [] as { kind: string; severity: string }[] }));
vi.mock("@/lib/payments/merchant/rpc", async (orig) => ({ ...(await orig<object>()), rpc: h.rpc }));
vi.mock("@/lib/supabase", () => ({ sbSelect: h.sbSelect, sbRpc: vi.fn(), sbUpdate: vi.fn(), sbInsert: vi.fn() }));
vi.mock("@/lib/alerts", () => ({ raiseAlert: vi.fn(async (a: { kind: string; severity: string }) => { h.alerts.push(a); return {}; }) }));

import { reviewArcIndeterminate } from "../arcIndeterminate";

// Arc agent payments left INDETERMINATE: classified from the chain, never moved.
const T = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const SYS = "0xfffffffffffffffffffffffffffffffffffffffe", USDC = "0x3600000000000000000000000000000000000000";
const FROM = "0x" + "aa".repeat(20), TO = "0x" + "bb".repeat(20), TX = "0x" + "11".repeat(32), BH = "0x" + "22".repeat(32);
const word = (a: string) => "0x" + a.slice(2).padStart(64, "0");
const log = (address: string, value: bigint, i: number) => ({ address, topics: [T, word(FROM), word(TO)], data: "0x" + value.toString(16).padStart(64, "0"), logIndex: "0x" + i.toString(16), transactionHash: TX, blockHash: BH, blockNumber: "0x10" });
let receipt: object | null; let canonical = BH;
beforeEach(() => {
  h.alerts.length = 0; canonical = BH;
  receipt = { status: "0x1", blockNumber: "0x10", blockHash: BH, logs: [log(SYS, 25_000_000n * 10n ** 12n, 0), log(USDC, 25_000_000n, 1)] };
  h.sbSelect.mockImplementation(async (t: string) => t === "cp_indeterminate_executions"
    ? [{ id: 1, organization_id: "org", authorization_id: "auth_1", rail_id: "arc_usdc_transfer", rail_ref: TX, started_at: "x" }]
    : [{ id: "auth_1", amount_atomic: "25000000", recipient_destination: TO, network_id: "arc" }]);
  h.rpc.mockImplementation(async (_c: string, m: string) => m === "eth_getTransactionReceipt" ? receipt : { hash: canonical });
});
const env = { ARC_SETTLEMENT_ADDRESS: FROM };

describe("Arc INDETERMINATE review", () => {
  it("finds settled evidence when exactly the authorized amount reached the destination (counted once)", async () => {
    expect(await reviewArcIndeterminate(env)).toEqual({ reviewed: 1, byResolution: { settled_evidence: 1 } });
  });
  it("flags a different amount as a critical mismatch", async () => {
    receipt = { ...receipt!, logs: [log(SYS, 24_000_000n * 10n ** 12n, 0), log(USDC, 24_000_000n, 1)] };
    await reviewArcIndeterminate(env);
    expect(h.alerts).toEqual([expect.objectContaining({ kind: "arc.indeterminate.settled_mismatch", severity: "critical" })]);
  });
  it("reports reverted, missing and non-canonical receipts without concluding settlement", async () => {
    receipt = { ...receipt!, status: "0x0" };
    expect((await reviewArcIndeterminate(env)).byResolution).toEqual({ reverted: 1 });
    receipt = null;
    expect((await reviewArcIndeterminate(env)).byResolution).toEqual({ not_found: 1 });
    receipt = { status: "0x1", blockNumber: "0x10", blockHash: BH, logs: [] }; canonical = "0x" + "33".repeat(32);
    expect((await reviewArcIndeterminate(env)).byResolution).toEqual({ not_found: 1 });
  });
  it("an RPC outage or missing settlement address concludes nothing", async () => {
    h.rpc.mockRejectedValue(new Error("Network reader unavailable"));
    expect((await reviewArcIndeterminate(env)).byResolution).toEqual({ unavailable: 1 });
    expect((await reviewArcIndeterminate({})).byResolution).toEqual({ unavailable: 1 });
  });
});
