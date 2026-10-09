import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters } from "viem";

const h = vi.hoisted(() => ({ rpc: vi.fn(), sbSelect: vi.fn(), sbRpc: vi.fn(), screen: vi.fn(), suiTx: vi.fn() }));
vi.mock("../rpc", async (orig) => ({ ...(await orig<object>()), rpc: h.rpc, verifyChain: vi.fn(async () => undefined) }));
vi.mock("../sui", async (orig) => ({ ...(await orig<object>()), fetchSuiTransaction: h.suiTx }));
vi.mock("@/lib/supabase", () => ({ sbSelect: h.sbSelect, sbRpc: h.sbRpc, sbUpdate: vi.fn(), supabaseBackend: "supabase" }));
vi.mock("@/lib/compliance/addressScreening", () => ({ screenAddressRisk: h.screen }));

import { readRefundTransfer, RefundRejected, requestRefund } from "../refunds";
import { TRANSFER } from "../verifier";
import { paymentChain } from "../registry";

const FROM = "0x" + "b1".repeat(20), TO = "0x" + "a1".repeat(20), TX = "0x" + "77".repeat(32), BLOCK = "0x" + "cd".repeat(32);
const OWNER = "11111111-1111-4111-8111-111111111111", INTENT = "22222222-2222-4222-8222-222222222222";
const pad = (a: string) => "0x" + "0".repeat(24) + a.slice(2);
const log = (over: Record<string, unknown> = {}) => ({ address: paymentChain("base").token, topics: [TRANSFER, pad(FROM), pad(TO)], data: encodeAbiParameters([{ type: "uint256" }], [300_000_000n]), transactionHash: TX, blockNumber: "0x64", blockHash: BLOCK, logIndex: "0x2", ...over });
const chain = (receipt: object | null) => h.rpc.mockImplementation(async (_c: string, m: string) =>
  m === "eth_getTransactionReceipt" ? receipt : m === "eth_blockNumber" ? "0x70" : m === "eth_getBlockByNumber" ? { number: "0x64", hash: BLOCK, timestamp: "0x6700" } : null);
const receipt = (logs = [log()], status = "0x1") => ({ status, blockNumber: "0x64", blockHash: BLOCK, logs });

beforeEach(() => { for (const f of Object.values(h)) f.mockReset(); h.screen.mockResolvedValue({ action: "allow", categories: [] }); });

describe("reading a refund transfer from the chain", () => {
  it("returns the one USDC transfer from the payment address to the refund address", async () => {
    chain(receipt([log({ logIndex: "0x1", topics: [TRANSFER, pad(FROM), pad("0x" + "ee".repeat(20))] }), log()]));
    expect(await readRefundTransfer("base", TX, FROM, TO)).toMatchObject({ log: 2, amount: 300_000_000n, block: "100" });
  });
  it.each([
    ["a reverted transaction", receipt([log()], "0x0"), "reverted"],
    ["another token", receipt([log({ address: "0x" + "99".repeat(20) })]), "no USDC transfer"],
    ["another sender", receipt([log({ topics: [TRANSFER, pad("0x" + "ee".repeat(20)), pad(TO)] })]), "no USDC transfer"],
    ["several matching transfers", receipt([log(), log({ logIndex: "0x3" })]), "several transfers"],
    ["a transaction not yet mined", null, "not on-chain yet"],
  ])("refuses %s", async (_n, r, msg) => {
    chain(r);
    await expect(readRefundTransfer("base", TX, FROM, TO)).rejects.toThrow(msg);
  });
  it("refuses a reorganized block", async () => {
    h.rpc.mockImplementation(async (_c: string, m: string) => m === "eth_getTransactionReceipt" ? receipt() : m === "eth_blockNumber" ? "0x70" : { number: "0x64", hash: "0x" + "ee".repeat(32), timestamp: "0x1" });
    await expect(readRefundTransfer("base", TX, FROM, TO)).rejects.toThrow("reorganized");
  });
  it("reads Sui refunds from netted balance changes and refuses mixed transfers", async () => {
    const SF = "0x" + "b1".repeat(32), ST = "0x" + "a1".repeat(32), U = paymentChain("sui").token;
    const tx = (changes: [string, string][]) => ({ digest: "D", sender: { address: SF }, effects: { status: "SUCCESS", timestamp: "2026-10-09T05:00:00Z", checkpoint: { sequenceNumber: 9, digest: "C" }, balanceChanges: { pageInfo: { hasNextPage: false }, nodes: changes.map(([a, n]) => ({ owner: { address: a }, coinType: { repr: U }, amount: n })) } } });
    h.suiTx.mockResolvedValue(tx([[SF, "-5000000"], [ST, "5000000"]]));
    expect(await readRefundTransfer("sui", "D", SF, ST)).toMatchObject({ amount: 5_000_000n, block: "9" });
    h.suiTx.mockResolvedValue(tx([[SF, "-6000000"], [ST, "5000000"], ["0x" + "ee".repeat(32), "1000000"]]));
    await expect(readRefundTransfer("sui", "D", SF, ST)).rejects.toThrow("other parties");
  });
  it("refuses Solana completion explicitly rather than half-verifying it", async () => {
    await expect(readRefundTransfer("solana", "sig", "a", "b")).rejects.toThrow("not supported yet");
  });
});

describe("requesting a refund", () => {
  const input = { requestId: "33333333-3333-4333-8333-333333333333", intentId: INTENT, amount: "10", reason: "returned" };
  const setup = (payers: string[]) => h.sbSelect.mockImplementation(async (t: string) =>
    t === "merchant_payment_intents" ? [{ id: INTENT, merchant_id: OWNER, chain: "base", recipient: FROM }] : payers.map(payer => ({ payer })));
  it("defaults to the single payer, lowercases EVM, screens it, and reserves exact units", async () => {
    setup([TO]); h.sbRpc.mockResolvedValue({ id: input.requestId });
    await requestRefund(OWNER, OWNER, { ...input, toAddress: undefined });
    expect(h.sbRpc).toHaveBeenCalledWith("merchant_refund_request", expect.objectContaining({ p_to: TO, p_amount: "10000000", p_merchant: OWNER }));
    await requestRefund(OWNER, OWNER, { ...input, toAddress: TO.toUpperCase().replace("0X", "0x") });
    expect(h.sbRpc.mock.calls[1][1].p_to).toBe(TO);
  });
  it("asks which payer when there are several, and fails closed on screening", async () => {
    setup([TO, "0x" + "c1".repeat(20)]);
    await expect(requestRefund(OWNER, OWNER, input)).rejects.toThrow("several payers");
    setup([TO]); h.screen.mockResolvedValueOnce({ action: "block", categories: [] });
    await expect(requestRefund(OWNER, OWNER, input)).rejects.toThrow("cannot receive a refund");
    h.screen.mockRejectedValueOnce(new Error("down"));
    await expect(requestRefund(OWNER, OWNER, input)).rejects.toThrow("screening is unavailable");
    expect(h.sbRpc).not.toHaveBeenCalled();
  });
  it("translates database refusals into merchant-readable errors", async () => {
    setup([TO]); h.sbRpc.mockRejectedValue(new Error('Supabase rpc failed: {"message":"exceeds_refundable"}'));
    await expect(requestRefund(OWNER, OWNER, input)).rejects.toThrow(RefundRejected);
    await expect(requestRefund(OWNER, OWNER, input)).rejects.toThrow("more than remains refundable");
  });
});
