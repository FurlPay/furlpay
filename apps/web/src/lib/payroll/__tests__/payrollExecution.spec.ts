import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, pad } from "viem";

const h = vi.hoisted(() => ({ rpc: vi.fn(), sbSelect: vi.fn(), sbUpdate: vi.fn(), sbRpc: vi.fn() }));
vi.mock("@/lib/payments/merchant/rpc", async (orig) => ({ ...(await orig<object>()), rpc: h.rpc, verifyChain: vi.fn(async () => undefined) }));
vi.mock("@/lib/supabase", () => ({ sbSelect: h.sbSelect, sbUpdate: h.sbUpdate, sbRpc: h.sbRpc, sbCount: vi.fn(), sbInsertIgnoreDuplicates: vi.fn(), supabaseBackend: "supabase" }));
vi.mock("@/lib/compliance/addressScreening", () => ({ screenAddressRisk: vi.fn() }));

import { recordExecution } from "../execution";
import { ROUTER_ABI } from "../routerAbi";

const ROUTER = "0x" + "e7".repeat(20), PAYER = "0x" + "70".repeat(20), RECIPIENT = "0x" + "ab".repeat(20);
const TX = "0x" + "aa".repeat(32), BLOCK = "0x" + "bb".repeat(32), NONCE = "0x" + "cd".repeat(32);
const OWNER = "11111111-1111-4111-8111-111111111111", BATCH = "22222222-2222-4222-8222-222222222222";
const message = { paymentId: "pay_1", recipient: RECIPIENT, amount: "2508750000", fee: "8750000", nonce: NONCE, deadline: 1_900_000_000 };
const line = { id: "44444444-4444-4444-8444-444444444444", batch_id: BATCH, signature: "0x" + "1".repeat(130), sign_data: { message }, executed_tx: null, payment_id: "pay_1" };
const batch = { id: BATCH, merchant_id: OWNER, chain: "arbitrum", status: "submitted", payer_address: PAYER };
const event = (over: Partial<typeof message> = {}, address = ROUTER) => {
  const m = { ...message, ...over };
  return { address, topics: encodeEventTopics({ abi: ROUTER_ABI, eventName: "PaymentExecuted", args: { payer: PAYER as `0x${string}`, recipient: m.recipient as `0x${string}` } }),
    data: encodeAbiParameters([{ type: "string" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32" }], [m.paymentId, BigInt(m.amount), BigInt(m.fee), m.nonce as `0x${string}`]) };
};
const chain = (receipt: object | null, head = "0x10", canonical = BLOCK) => h.rpc.mockImplementation(async (_c: string, method: string) =>
  method === "eth_getTransactionReceipt" ? receipt : method === "eth_blockNumber" ? head : method === "eth_getBlockByNumber" ? { hash: canonical } : null);
const receipt = (over = {}) => ({ status: "0x1", to: ROUTER, blockNumber: "0x10", blockHash: BLOCK, logs: [event()], ...over });

beforeEach(() => {
  vi.stubEnv("FURLPAY_ROUTER_ADDRESS_ARBITRUM", ROUTER);
  for (const f of Object.values(h)) f.mockReset();
  h.sbSelect.mockImplementation(async (t: string) => t === "payroll_batch_lines" ? [{ ...line }] : [{ ...batch }]);
  h.sbUpdate.mockImplementation(async (_t: string, _q: string, p: object) => [p]);
  h.sbRpc.mockResolvedValue(true);
});

describe("recording payroll execution from the chain", () => {
  it("marks a line paid only when the router's event matches what was signed, then completes the batch", async () => {
    chain(receipt());
    expect(await recordExecution(OWNER, BATCH, TX)).toMatchObject({ matched: 1, executed: 1, total: 1 });
    // Line recorded and the router's fee journaled atomically (migration 0048), with the fee from the verified event.
    expect(h.sbRpc).toHaveBeenCalledWith("payroll_line_executed", expect.objectContaining({ p_batch: BATCH, p_line: line.id, p_tx: TX, p_block: "16", p_payment_id: "pay_1", p_fee: "8750000" }));
    // Completion is the database's decision (under the batch lock), not this request's snapshot.
    expect(h.sbUpdate).not.toHaveBeenCalled();
  });
  it.each([
    ["a reverted transaction", receipt({ status: "0x0" }), "reverted"],
    ["a transaction to another contract", receipt({ to: "0x" + "99".repeat(20) }), "not sent to FurlPayRouter"],
    ["a transaction not yet mined", null, "not on-chain yet"],
  ])("refuses %s", async (_n, r, msg) => {
    chain(r);
    await expect(recordExecution(OWNER, BATCH, TX)).rejects.toThrow(msg);
    expect(h.sbUpdate).not.toHaveBeenCalled();
    expect(h.sbRpc).not.toHaveBeenCalled();
  });
  it("refuses a reorganized block and a shallow one", async () => {
    chain(receipt(), "0x10", "0x" + "cc".repeat(32));
    await expect(recordExecution(OWNER, BATCH, TX)).rejects.toThrow("reorganized");
    vi.doMock("@/lib/payments/merchant/registry", async (orig) => ({ ...(await orig<object>()) }));
    chain(receipt({ blockNumber: "0x11" }), "0x10");
    await expect(recordExecution(OWNER, BATCH, TX)).rejects.toThrow("Waiting for confirmations");
  });
  it.each([
    ["a different fee", { fee: "1" }],
    ["a different amount", { amount: "2508750001" }],
    ["a different recipient", { recipient: "0x" + "cd".repeat(20) }],
    ["a different payment", { paymentId: "pay_2" }],
    ["a different nonce", { nonce: "0x" + "ef".repeat(32) }],
  ])("does not accept an event with %s", async (_n, over) => {
    chain(receipt({ logs: [event(over)] }));
    await expect(recordExecution(OWNER, BATCH, TX)).rejects.toThrow("executed none");
  });
  it("ignores a look-alike event emitted by another contract", async () => {
    chain(receipt({ logs: [event({}, "0x" + "99".repeat(20))] }));
    await expect(recordExecution(OWNER, BATCH, TX)).rejects.toThrow("executed none");
  });
  it("refuses when no router is configured on the batch's chain", async () => {
    h.sbSelect.mockImplementation(async (t: string) => t === "payroll_batch_lines" ? [{ ...line }] : [{ ...batch, chain: "arc" }]);
    await expect(recordExecution(OWNER, BATCH, TX)).rejects.toThrow("No FurlPayRouter is configured on arc");
    expect(h.rpc).not.toHaveBeenCalled();
  });
  void pad;
});
