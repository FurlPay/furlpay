import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../rpc", async (orig) => ({ ...(await orig<object>()), rpc: h.rpc, verifyChain: vi.fn(async () => undefined) }));
vi.mock("@/lib/supabase", () => ({ sbRpc: vi.fn(), sbUpdate: vi.fn(), sbSelect: vi.fn(async () => []), supabaseBackend: "supabase" }));
vi.mock("@/lib/compliance/addressScreening", () => ({ screenAddressRisk: vi.fn() }));

import { checkReceipt, type Receipt } from "../reconcile";
import { TRANSFER } from "../verifier";
import { paymentChain } from "../registry";
import type { MerchantIntent } from "../model";

const RECIPIENT = "0x" + "12".repeat(20);
const PAYER = "0x" + "34".repeat(20);
const TX = "0x" + "ab".repeat(32);
const BLOCK = "0x" + "cd".repeat(32);
const intent = { id: "11111111-1111-4111-8111-111111111111", chain: "base", recipient: RECIPIENT, start_block: "100" } as MerchantIntent;
const receipt: Receipt = { chain: "base", tx_hash: TX, log_index: 3, intent_id: intent.id, amount_units: "1000000000", block_hash: BLOCK };
const pad = (a: string) => "0x" + "0".repeat(24) + a.slice(2);
const log = (amount = 1_000_000_000n, over = {}) => ({ address: paymentChain("base").token, topics: [TRANSFER, pad(PAYER), pad(RECIPIENT)], data: "0x" + amount.toString(16).padStart(64, "0"), transactionHash: TX, blockNumber: "0x70", blockHash: BLOCK, logIndex: "0x3", ...over });
const chainReceipt = (over = {}) => ({ status: "0x1", blockHash: BLOCK, logs: [log()], ...over });

beforeEach(() => { h.rpc.mockReset(); });

describe("reconciliation chain leg", () => {
  it("accepts a receipt that still matches the chain", async () => {
    h.rpc.mockResolvedValue(chainReceipt());
    expect(await checkReceipt(receipt, intent)).toBeNull();
  });
  it("flags a reverted, reorged or missing transaction", async () => {
    h.rpc.mockResolvedValueOnce(chainReceipt({ status: "0x0" }));
    expect((await checkReceipt(receipt, intent))?.kind).toBe("receipt_failed");
    h.rpc.mockResolvedValueOnce(chainReceipt({ blockHash: "0x" + "ee".repeat(32) }));
    expect((await checkReceipt(receipt, intent))?.detail).toMatch(/now in block/);
    h.rpc.mockResolvedValueOnce(null);
    expect((await checkReceipt(receipt, intent))?.kind).toBe("receipt_failed");
  });
  it("flags an amount that differs from what was recorded", async () => {
    h.rpc.mockResolvedValue(chainReceipt({ logs: [log(999_000_000n)] }));
    expect((await checkReceipt(receipt, intent))?.kind).toBe("amount_mismatch");
  });
  it("flags a log that is not USDC to this intent", async () => {
    h.rpc.mockResolvedValue(chainReceipt({ logs: [log(1_000_000_000n, { address: "0x" + "99".repeat(20) })] }));
    expect((await checkReceipt(receipt, intent))?.kind).toBe("receipt_failed");
  });
  it("reports a reader outage as unavailable, never as a failed payment", async () => {
    h.rpc.mockImplementation(async () => { throw new Error("Network reader unavailable"); });
    expect((await checkReceipt(receipt, intent))?.kind).toBe("rpc_unavailable");
  });
});
