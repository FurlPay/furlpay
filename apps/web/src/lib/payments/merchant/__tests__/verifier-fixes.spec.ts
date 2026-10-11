import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rpc: vi.fn(), sbRpc: vi.fn(), sbUpdate: vi.fn(async () => []) }));
vi.mock("../rpc", async (orig) => ({ ...(await orig<object>()), rpc: h.rpc, verifyChain: vi.fn(async () => undefined) }));
vi.mock("@/lib/supabase", () => ({ sbRpc: h.sbRpc, sbUpdate: h.sbUpdate, sbSelect: vi.fn(async () => []), supabaseBackend: "supabase" }));
vi.mock("@/lib/compliance/addressScreening", () => ({ screenAddressRisk: vi.fn(async () => ({ action: "allow", categories: [] })) }));

import { scanIntent, usdcTokenAccount } from "../verifier";
import { requiredConfirmations } from "../registry";
import type { MerchantIntent } from "../model";

const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const RECIPIENT = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const PAYER = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const now = Date.now();
const intent: MerchantIntent = {
  id: "11111111-1111-4111-8111-111111111111", link_id: "l", merchant_id: "m", chain: "solana", recipient: RECIPIENT,
  reference: "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T", status: "awaiting_payment",
  gross_units: "1000000000", fee_units: "7500000", charge_units: "1000000000", net_units: "992500000", received_units: "0",
  start_block: "100", scan_block: "100", created_at: new Date(now - 60_000).toISOString(), expires_at: new Date(now + 600_000).toISOString(),
  paid_at: null, transaction_hash: null, confirmations: 0, ledger_tx_id: null,
};
const SIG = "5".repeat(87);
const bal = (accountIndex: number, owner: string, amount: string) => ({ accountIndex, mint: MINT, owner, uiTokenAmount: { amount, decimals: 6 } });
const plainTransfer = {
  slot: 200, blockTime: Math.floor(now / 1000),
  meta: { err: null, preTokenBalances: [bal(1, PAYER, "5000000000"), bal(2, RECIPIENT, "0")], postTokenBalances: [bal(1, PAYER, "4000000000"), bal(2, RECIPIENT, "1000000000")] },
  // No reference key among the accounts: a copied-address transfer.
  transaction: { signatures: [SIG], message: { accountKeys: [{ pubkey: PAYER, signer: true }, { pubkey: "PayerTokenAcct1111111111111111111111111111", signer: false }, { pubkey: usdcTokenAccount(RECIPIENT), signer: false }] } },
};

beforeEach(() => {
  h.rpc.mockReset(); h.sbRpc.mockReset();
  h.sbRpc.mockImplementation(async (_fn: string, args: Record<string, unknown>) => ({ ...intent, status: "paid", received_units: args.p_amount }));
});

describe("Solana detection without a Solana Pay reference", () => {
  it("credits a transfer found only through the destination's USDC token account", async () => {
    const ata = usdcTokenAccount(RECIPIENT);
    h.rpc.mockImplementation(async (_c: string, method: string, params: unknown[]) => {
      if (method === "getSignaturesForAddress") return params[0] === ata ? [{ signature: SIG, err: null, slot: 200 }] : [];
      if (method === "getTransaction") return plainTransfer;
      throw new Error(`unexpected ${method}`);
    });
    const out = await scanIntent(intent);
    expect(out.status).toBe("paid");
    expect(h.sbRpc).toHaveBeenCalledWith("merchant_payment_receive", expect.objectContaining({ p_tx: SIG, p_amount: "1000000000", p_payer: PAYER }));
  });

  it("deduplicates a transaction found through both the reference and the token account", async () => {
    h.rpc.mockImplementation(async (_c: string, method: string) => {
      if (method === "getSignaturesForAddress") return [{ signature: SIG, err: null, slot: 200 }];
      if (method === "getTransaction") return plainTransfer;
      throw new Error(method);
    });
    await scanIntent(intent);
    expect(h.sbRpc).toHaveBeenCalledTimes(1);
  });

  it("derives the standard associated token account (checked against mainnet 2026-10-09)", () => {
    expect(usdcTokenAccount(RECIPIENT)).toBe("FGETo8T8wMcN2wCjav8VK6eh3dLk63evNDPxzLSJra8B");
  });
});

describe("collection depth follows the platform deposit policy", () => {
  it("uses the policy for supported chains and refuses chains without one", () => {
    expect(requiredConfirmations("ethereum")).toBe(12);
    expect(requiredConfirmations("polygon")).toBe(128);
    expect(requiredConfirmations("solana")).toBe(31);
    expect(requiredConfirmations("arc")).toBe(1);
    expect(requiredConfirmations("optimism")).toBeNull();
    expect(requiredConfirmations("avalanche")).toBeNull();
  });
  it("never scans an EVM chain that has no deposit policy", async () => {
    await expect(scanIntent({ ...intent, chain: "optimism", recipient: "0x" + "ab".repeat(20) })).rejects.toThrow("No deposit policy");
    expect(h.rpc).not.toHaveBeenCalled();
  });
});
