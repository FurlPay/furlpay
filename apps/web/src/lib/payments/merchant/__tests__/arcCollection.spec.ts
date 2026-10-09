import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters } from "viem";

// ARC-P1-001 / ARC-P2-003: on Arc a native USDC send emits ONLY the EIP-7708
// system-emitter Transfer log (0xffff…fffe, 18 dp); a transfer() emits that log
// AND the 0x3600 ERC-20 log (6 dp). Shapes follow lib/chains/arc.ts's mainnet
// measurements (txs 0xbb74…cec9 native-only, 0x42d1…c15d dual).
const h = vi.hoisted(() => ({ rpc: vi.fn(), sbRpc: vi.fn(), sbUpdate: vi.fn(async (..._a: unknown[]) => [] as unknown[]), screen: vi.fn() }));
vi.mock("../rpc", async (orig) => ({ ...(await orig<object>()), rpc: h.rpc, verifyChain: vi.fn(async () => undefined) }));
vi.mock("@/lib/supabase", () => ({ sbRpc: h.sbRpc, sbUpdate: h.sbUpdate, sbSelect: vi.fn(async () => []), supabaseBackend: "supabase" }));
vi.mock("@/lib/compliance/addressScreening", () => ({ screenAddressRisk: h.screen }));

import { scanIntent } from "../verifier";
import { checkReceipt } from "../reconcile";
import type { MerchantIntent } from "../model";

const SYSTEM = "0xfffffffffffffffffffffffffffffffffffffffe", USDC = "0x3600000000000000000000000000000000000000";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const RECIPIENT = "0x" + "12".repeat(20), PAYER = "0x" + "34".repeat(20), OTHER = "0x" + "56".repeat(20);
const TX = "0x" + "ab".repeat(32), BLOCK = "0x" + "cd".repeat(32);
const pad = (a: string) => "0x" + "0".repeat(24) + a.slice(2);
const word = (v: bigint) => encodeAbiParameters([{ type: "uint256" }], [v]);
const now = Date.now();
const intent = (over: Partial<MerchantIntent> = {}): MerchantIntent => ({
  id: "11111111-1111-4111-8111-111111111111", link_id: "l", merchant_id: "m", chain: "arc", recipient: RECIPIENT, reference: "r",
  status: "awaiting_payment", gross_units: "25000000", fee_units: "187500", charge_units: "25000000", net_units: "24812500", received_units: "0",
  start_block: "100", scan_block: "100", created_at: new Date(now - 60_000).toISOString(), expires_at: new Date(now + 600_000).toISOString(),
  paid_at: null, transaction_hash: null, confirmations: 0, ledger_tx_id: null, ...over,
});
const log = (address: string, from: string, to: string, value: bigint, logIndex: string) =>
  ({ address, topics: [TRANSFER, pad(from), pad(to)], data: word(value), transactionHash: TX, blockNumber: "0x70", blockHash: BLOCK, logIndex, removed: false });
const NATIVE_25 = 25_000_000n * 10n ** 12n; // 25 USDC at 18 dp

let blocked = false;
function chain(receiptLogs: ReturnType<typeof log>[], status = "0x1") {
  h.rpc.mockImplementation(async (_c: string, method: string, params: unknown[]) => {
    switch (method) {
      case "eth_getBlockByNumber": return { number: params[0] === "latest" ? "0x72" : "0x70", hash: BLOCK, timestamp: "0x" + Math.floor(now / 1000).toString(16) };
      // decimals() == 6; isBlacklisted(...) == false unless the test says otherwise.
      case "eth_call": return (params[0] as { data: string }).data.startsWith("0xfe575a87") ? "0x" + (blocked ? "1" : "0").padStart(64, "0") : "0x" + "6".padStart(64, "0");
      case "eth_getLogs": {
        const f = params[0] as { address: string | string[] };
        const allowed = (Array.isArray(f.address) ? f.address : [f.address]).map(a => a.toLowerCase());
        return receiptLogs.filter(l => allowed.includes(l.address.toLowerCase()) && l.topics[2].toLowerCase() === pad(RECIPIENT));
      }
      case "eth_getTransactionReceipt": return { status, blockHash: BLOCK, blockNumber: "0x70", transactionHash: TX, logs: receiptLogs };
      default: throw new Error(method);
    }
  });
}

beforeEach(() => {
  blocked = false;
  for (const f of Object.values(h)) f.mockReset();
  h.sbUpdate.mockImplementation(async () => []);
  h.screen.mockResolvedValue({ action: "allow", categories: [] });
  h.sbRpc.mockImplementation(async (_f: string, a: Record<string, unknown>) => ({ ...intent(), status: "paid", received_units: a.p_amount, paid_at: "x" }));
});

describe("Arc collection reads both Transfer streams and credits each movement once", () => {
  it("credits a NATIVE Arc send (system-emitter log only) at 6 dp", async () => {
    chain([log(SYSTEM, PAYER, RECIPIENT, NATIVE_25, "0x0")]);
    await scanIntent(intent());
    expect(h.sbRpc).toHaveBeenCalledWith("merchant_payment_receive", expect.objectContaining({ p_tx: TX, p_log: 0, p_amount: "25000000", p_payer: PAYER }));
  });
  it("credits a transfer() (both logs) exactly once, keyed on the system-emitter log", async () => {
    chain([log(SYSTEM, PAYER, RECIPIENT, NATIVE_25, "0x3"), log(USDC, PAYER, RECIPIENT, 25_000_000n, "0x4")]);
    await scanIntent(intent());
    expect(h.sbRpc).toHaveBeenCalledTimes(1);
    expect(h.sbRpc).toHaveBeenCalledWith("merchant_payment_receive", expect.objectContaining({ p_log: 3, p_amount: "25000000" }));
  });
  it("never reads an 18-dp system value as 6-dp units (the 1e12 under-accept)", async () => {
    // 25,000,000 wei is $0.000000000025 — it must not satisfy a 25 USDC charge.
    chain([log(SYSTEM, PAYER, RECIPIENT, 25_000_000n, "0x0")]);
    await scanIntent(intent());
    expect(h.sbRpc).not.toHaveBeenCalledWith("merchant_payment_receive", expect.objectContaining({ p_amount: "25000000" }));
  });
  it("holds a payment carrying sub-micro-USDC dust for review instead of rounding it", async () => {
    chain([log(SYSTEM, PAYER, RECIPIENT, NATIVE_25 + 1n, "0x0")]);
    await scanIntent(intent());
    expect(h.sbRpc).not.toHaveBeenCalled();
    expect(h.sbUpdate).toHaveBeenCalledWith("merchant_payment_intents", expect.stringContaining("paid_at=is.null"), { status: "review" });
  });
  it("ignores movements to other addresses and Transfer logs from other contracts", async () => {
    chain([log(SYSTEM, PAYER, OTHER, NATIVE_25, "0x0"), log("0x" + "99".repeat(20), PAYER, RECIPIENT, 25_000_000n, "0x1")]);
    await scanIntent(intent());
    expect(h.sbRpc).not.toHaveBeenCalled();
  });
  it("holds a native payment from an address on Arc's USDC blocklist", async () => {
    blocked = true;
    chain([log(SYSTEM, PAYER, RECIPIENT, NATIVE_25, "0x0")]);
    await scanIntent(intent());
    expect(h.sbRpc).not.toHaveBeenCalled();
    expect(h.sbUpdate).toHaveBeenCalledWith("merchant_payment_intents", expect.anything(), { status: "review" });
  });
  it("credits nothing from a reverted transaction", async () => {
    chain([log(SYSTEM, PAYER, RECIPIENT, NATIVE_25, "0x0")], "0x0");
    await expect(scanIntent(intent())).rejects.toThrow();
    expect(h.sbRpc).not.toHaveBeenCalled();
  });
});

describe("Arc reconciliation reads the same stream", () => {
  const receipt = { chain: "arc" as const, tx_hash: TX, log_index: 0, intent_id: intent().id, amount_units: "25000000", block_hash: BLOCK };
  it("accepts a recorded native Arc payment that still matches the chain", async () => {
    chain([log(SYSTEM, PAYER, RECIPIENT, NATIVE_25, "0x0")]);
    expect(await checkReceipt(receipt, intent())).toBeNull();
  });
  it("flags an amount that no longer matches", async () => {
    chain([log(SYSTEM, PAYER, RECIPIENT, NATIVE_25 - 10n ** 12n, "0x0")]);
    expect((await checkReceipt(receipt, intent()))?.kind).toBe("amount_mismatch");
  });
});
