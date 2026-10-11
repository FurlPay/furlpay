import { beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import nacl from "tweetnacl";
import bs58 from "bs58";

const h = vi.hoisted(() => ({ sbSelect: vi.fn(), sbInsert: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ ...h, sbUpdate: vi.fn(), sbRpc: vi.fn(), sbUpsert: vi.fn(), sbInsertIgnoreDuplicates: vi.fn(), supabaseBackend: "supabase" }));

import { registerDestination, registrationMessage, DestinationRejected } from "../destinations";
import { operationSchema } from "../operations";

// Hardhat test key #0 — never funded on a real network.
const custody = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const M = "11111111-1111-4111-8111-111111111111";
const REF = "circle-wallet-7f3a";
beforeEach(() => { h.sbSelect.mockReset().mockResolvedValue([]); h.sbInsert.mockReset().mockImplementation(async (_t: string, row: object) => [row]); });

describe("collection address registration requires proof of control", () => {
  it("registers an EVM address whose key signed this exact registration", async () => {
    const signature = await custody.signMessage({ message: registrationMessage(M, "base", custody.address, REF) });
    const row = await registerDestination({ merchantId: M, chain: "base", address: custody.address, custodyReference: REF, signature });
    expect(row).toMatchObject({ merchant_id: M, chain: "base", address: custody.address, custody_reference: REF });
  });
  it("rejects a signature for a different merchant, chain or reference", async () => {
    for (const [m, chain, ref] of [["22222222-2222-4222-8222-222222222222", "base", REF], [M, "arbitrum", REF], [M, "base", "other-wallet"]] as const) {
      const signature = await custody.signMessage({ message: registrationMessage(m, chain, custody.address, ref) });
      await expect(registerDestination({ merchantId: M, chain: "base", address: custody.address, custodyReference: REF, signature })).rejects.toBeInstanceOf(DestinationRejected);
    }
    expect(h.sbInsert).not.toHaveBeenCalled();
  });
  it("rejects a typo'd address even with a valid signature from the real key", async () => {
    const typo = custody.address.slice(0, -1) + (custody.address.endsWith("6") ? "7" : "6");
    const signature = await custody.signMessage({ message: registrationMessage(M, "base", typo, REF) });
    await expect(registerDestination({ merchantId: M, chain: "base", address: typo, custodyReference: REF, signature })).rejects.toThrow("does not prove control");
  });
  it("verifies Solana addresses with Ed25519", async () => {
    const kp = nacl.sign.keyPair();
    const address = bs58.encode(kp.publicKey);
    const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(registrationMessage(M, "solana", address, REF)), kp.secretKey));
    await expect(registerDestination({ merchantId: M, chain: "solana", address, custodyReference: REF, signature })).resolves.toMatchObject({ chain: "solana" });
  });
  it("refuses chains without a deposit policy, wrong-format addresses and duplicates", async () => {
    const sig = await custody.signMessage({ message: registrationMessage(M, "optimism", custody.address, REF) });
    await expect(registerDestination({ merchantId: M, chain: "optimism", address: custody.address, custodyReference: REF, signature: sig })).rejects.toThrow("no reviewed deposit policy");
    await expect(registerDestination({ merchantId: M, chain: "solana", address: custody.address, custodyReference: REF, signature: sig })).rejects.toThrow("Not a valid solana");
    h.sbSelect.mockResolvedValue([{ id: "x" }]);
    const ok = await custody.signMessage({ message: registrationMessage(M, "base", custody.address, REF) });
    await expect(registerDestination({ merchantId: M, chain: "base", address: custody.address, custodyReference: REF, signature: ok })).rejects.toThrow("already registered");
  });
  it("has no action that generates addresses", () => {
    expect(operationSchema.safeParse({ action: "generate_destinations", merchantId: M, chain: "base", count: 5 }).success).toBe(false);
  });
});
