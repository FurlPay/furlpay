// ---------------------------------------------------------------------------
// Transfer authorization signatures (lib/signature.ts). Exercises the REAL
// viem recovery path: a real secp256k1 key signs the canonical EIP-191
// message and the verifier must recover it — plus the fail-closed matrix for
// live mode, wrong signers, and tampered payloads.
// ---------------------------------------------------------------------------

import { describe, it, expect, afterEach } from "vitest";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import {
  isValidSignatureShape,
  transferAuthorizationMessage,
  verifyTransferSignature,
  type TransferPayload,
} from "../signature";

const SAFE = "0x1111111111111111111111111111111111111111";
const PAYLOAD: TransferPayload = {
  destination: "0x2222222222222222222222222222222222222222",
  amount: 250,
  token: "USDC",
  chain: "arbitrum",
};

const owner = privateKeyToAccount(generatePrivateKey());

async function signedAuthorization(payload: TransferPayload = PAYLOAD) {
  return owner.signMessage({ message: transferAuthorizationMessage(SAFE, payload) });
}

afterEach(() => {
  delete process.env.INTEGRATION_MODE;
});

describe("signature shape", () => {
  it("accepts a 65-byte hex blob and rejects everything else", () => {
    expect(isValidSignatureShape("0x" + "ab".repeat(65))).toBe(true);
    expect(isValidSignatureShape("0x" + "ab".repeat(64))).toBe(false);
    expect(isValidSignatureShape("not-hex")).toBe(false);
    expect(isValidSignatureShape(42)).toBe(false);
  });
});

describe("owner recovery (real path)", () => {
  it("accepts a signature from a registered owner", async () => {
    const sig = await signedAuthorization();
    const res = await verifyTransferSignature(sig, SAFE, PAYLOAD, [owner.address]);
    expect(res.ok).toBe(true);
  });

  it("owner matching is case-insensitive", async () => {
    const sig = await signedAuthorization();
    const res = await verifyTransferSignature(sig, SAFE, PAYLOAD, [owner.address.toLowerCase()]);
    expect(res.ok).toBe(true);
  });

  it("rejects a signature from a non-owner key", async () => {
    const stranger = privateKeyToAccount(generatePrivateKey());
    const sig = await stranger.signMessage({
      message: transferAuthorizationMessage(SAFE, PAYLOAD),
    });
    const res = await verifyTransferSignature(sig, SAFE, PAYLOAD, [owner.address]);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/registered Safe owner/);
  });

  it("rejects when the payload was tampered after signing", async () => {
    const sig = await signedAuthorization();
    const res = await verifyTransferSignature(
      sig,
      SAFE,
      { ...PAYLOAD, amount: 9_999_999 }, // signed 250, presenting 9,999,999
      [owner.address]
    );
    expect(res.ok).toBe(false);
  });

  it("rejects a well-formed random blob against a real owner list", async () => {
    const res = await verifyTransferSignature("0x" + "ab".repeat(65), SAFE, PAYLOAD, [
      owner.address,
    ]);
    expect(res.ok).toBe(false);
  });
});

describe("fail-closed matrix (no registered owners)", () => {
  it("live mode rejects — an unverifiable authorization must never move money", async () => {
    process.env.INTEGRATION_MODE = "live";
    const res = await verifyTransferSignature("0x" + "ab".repeat(65), SAFE, PAYLOAD);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/cannot verify/i);
  });

  it("mock/demo mode accepts a shape-valid blob (demo transfer flow)", async () => {
    const res = await verifyTransferSignature("0x" + "ab".repeat(65), SAFE, PAYLOAD);
    expect(res.ok).toBe(true);
  });

  it("still rejects malformed signatures and payloads in demo mode", async () => {
    expect((await verifyTransferSignature("0xdead", SAFE, PAYLOAD)).ok).toBe(false);
    expect(
      (await verifyTransferSignature("0x" + "ab".repeat(65), "", PAYLOAD)).ok
    ).toBe(false);
    expect(
      (await verifyTransferSignature("0x" + "ab".repeat(65), SAFE, { ...PAYLOAD, amount: 0 })).ok
    ).toBe(false);
  });
});
