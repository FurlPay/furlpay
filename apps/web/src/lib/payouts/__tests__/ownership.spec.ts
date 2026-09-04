import { describe, it, expect, beforeEach } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";
import {
  CHALLENGE_TTL_SECONDS,
  buildMessage,
  issueChallenge,
  ownershipSupport,
  verifyOwnership,
} from "../ownership";

// ---------------------------------------------------------------------------
// Wallet ownership verification.
//
// Signatures here are REAL. Every test signs with an actual key and verifies
// through the actual verifier — a mocked signature would test the mock, and
// the whole value of this module is that it correctly distinguishes a genuine
// signature from a plausible one.
//
// The attack this defends against: someone who has compromised a Discord
// account adds their own wallet as the payout destination. Every other check
// passes — the balance is right, the limits are fine, the address is valid —
// and the only thing standing between them and the money is proof that they
// hold the key.
// ---------------------------------------------------------------------------

const USER = "user_owner";
const OTHER_USER = "user_attacker";

// Deterministic test key. Never used anywhere real.
const EVM_PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const evmAccount = privateKeyToAccount(EVM_PK);

beforeEach(() => {
  const g = globalThis as unknown as { __furlpayKv?: Map<string, unknown> };
  g.__furlpayKv?.clear();
});

async function evmChallenge(address = evmAccount.address) {
  const r = await issueChallenge({ userId: USER, rail: "EVM", network: "base", address });
  if (!r.ok) throw new Error("issue failed");
  return r.challenge;
}

describe("rail support is declared, not silently skipped", () => {
  it("supports EVM and Solana", () => {
    expect(ownershipSupport("EVM")).toBe("supported");
    expect(ownershipSupport("SOLANA")).toBe("supported");
  });

  it("declares Bitcoin unsupported rather than pretending", () => {
    // Proving control of a Bitcoin address means BIP-322. Until that exists,
    // saying so is the honest option — a system that silently skips
    // verification looks identical to one that performed it.
    expect(ownershipSupport("BITCOIN_ONCHAIN")).toBe("not_implemented");
    expect(ownershipSupport("BITCOIN_LIGHTNING")).toBe("not_implemented");
  });

  it("refuses to issue a challenge for an unsupported rail", async () => {
    const r = await issueChallenge({
      userId: USER,
      rail: "BITCOIN_ONCHAIN",
      network: "bitcoin:mainnet",
      address: "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0",
    });
    expect(r.ok).toBe(false);
  });
});

describe("the signed message binds everything that matters", () => {
  it("contains domain, address, purpose, network, nonce and expiry", () => {
    const msg = buildMessage({
      address: evmAccount.address,
      rail: "EVM",
      network: "base",
      nonce: "abc123",
      issuedAt: "2026-09-04T00:00:00.000Z",
      expiresAt: "2026-09-04T00:05:00.000Z",
    });
    expect(msg).toContain(evmAccount.address);
    expect(msg).toContain("abc123");
    expect(msg).toContain("base");
    expect(msg).toContain("Expiration Time");
    // Says plainly that signing moves nothing — the sentence a careful person
    // looks for before signing anything.
    expect(msg).toMatch(/authorises nothing|moves no funds/i);
  });

  it("issues a distinct nonce every time", async () => {
    const a = await evmChallenge();
    const b = await evmChallenge();
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.message).not.toBe(b.message);
  });
});

describe("EVM ownership", () => {
  it("accepts a genuine signature from the address being added", async () => {
    const c = await evmChallenge();
    const signature = await evmAccount.signMessage({ message: c.message });
    const r = await verifyOwnership({
      challengeId: c.id,
      userId: USER,
      address: evmAccount.address,
      signature,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.proof).toBe(signature);
  });

  it("rejects a signature from a DIFFERENT key", async () => {
    // The core attack: attacker signs with their own wallet and submits it for
    // the victim's address.
    const attacker = privateKeyToAccount(
      "0x8f2a559490f5f0e6b3b7bb5e4bd3d1b8d5b8b8f0e6b3b7bb5e4bd3d1b8d5b8b8" as `0x${string}`
    );
    const c = await evmChallenge();
    const signature = await attacker.signMessage({ message: c.message });
    const r = await verifyOwnership({
      challengeId: c.id,
      userId: USER,
      address: evmAccount.address,
      signature,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("bad_signature");
  });

  it("rejects a signature over a DIFFERENT message", async () => {
    // A signature farmed from somewhere else — a login prompt, another site —
    // must not verify here. This is what the domain and purpose lines buy.
    const c = await evmChallenge();
    const signature = await evmAccount.signMessage({ message: "gm" });
    const r = await verifyOwnership({
      challengeId: c.id,
      userId: USER,
      address: evmAccount.address,
      signature,
    });
    expect(r.ok).toBe(false);
  });

  it("accepts either case of an EVM address", async () => {
    const c = await evmChallenge(evmAccount.address);
    const signature = await evmAccount.signMessage({ message: c.message });
    const r = await verifyOwnership({
      challengeId: c.id,
      userId: USER,
      address: evmAccount.address.toLowerCase(),
      signature,
    });
    expect(r.ok).toBe(true);
  });

  it("rejects a malformed signature without crashing", async () => {
    const c = await evmChallenge();
    for (const sig of ["", "not-hex", "0x1234"]) {
      const r = await verifyOwnership({
        challengeId: c.id,
        userId: USER,
        address: evmAccount.address,
        signature: sig,
      });
      expect(r.ok).toBe(false);
    }
  });
});

describe("Solana ownership", () => {
  it("accepts a genuine Ed25519 signature", async () => {
    const kp = Keypair.generate();
    const address = kp.publicKey.toBase58();
    const issued = await issueChallenge({
      userId: USER,
      rail: "SOLANA",
      network: "solana:devnet",
      address,
    });
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;

    const sig = nacl.sign.detached(
      new TextEncoder().encode(issued.challenge.message),
      kp.secretKey
    );
    const r = await verifyOwnership({
      challengeId: issued.challenge.id,
      userId: USER,
      address,
      signature: bs58.encode(sig),
    });
    expect(r.ok).toBe(true);
  });

  it("rejects a signature from a different keypair", async () => {
    const kp = Keypair.generate();
    const attacker = Keypair.generate();
    const address = kp.publicKey.toBase58();
    const issued = await issueChallenge({
      userId: USER,
      rail: "SOLANA",
      network: "solana:devnet",
      address,
    });
    if (!issued.ok) return;

    const sig = nacl.sign.detached(
      new TextEncoder().encode(issued.challenge.message),
      attacker.secretKey
    );
    const r = await verifyOwnership({
      challengeId: issued.challenge.id,
      userId: USER,
      address,
      signature: bs58.encode(sig),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("bad_signature");
  });

  it("is case-SENSITIVE for Solana addresses", async () => {
    // base58 is case-significant: lower-casing would name a different key.
    const kp = Keypair.generate();
    const address = kp.publicKey.toBase58();
    const issued = await issueChallenge({
      userId: USER,
      rail: "SOLANA",
      network: "solana:devnet",
      address,
    });
    if (!issued.ok) return;
    const sig = nacl.sign.detached(new TextEncoder().encode(issued.challenge.message), kp.secretKey);
    const r = await verifyOwnership({
      challengeId: issued.challenge.id,
      userId: USER,
      address: address.toLowerCase(),
      signature: bs58.encode(sig),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("address_mismatch");
  });
});

describe("replay and binding", () => {
  it("consumes the challenge so a captured signature cannot be reused", async () => {
    const c = await evmChallenge();
    const signature = await evmAccount.signMessage({ message: c.message });

    const first = await verifyOwnership({
      challengeId: c.id,
      userId: USER,
      address: evmAccount.address,
      signature,
    });
    expect(first.ok).toBe(true);

    // THE REPLAY. Same signature, same challenge, seconds later.
    const second = await verifyOwnership({
      challengeId: c.id,
      userId: USER,
      address: evmAccount.address,
      signature,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("unknown_challenge");
  });

  it("does NOT consume the challenge on a failed attempt", async () => {
    // A wallet that returns a bad signature once should not force the user to
    // restart. The attacker case needs a valid signature they do not have, so
    // leaving the window open costs nothing.
    const c = await evmChallenge();
    const bad = await verifyOwnership({
      challengeId: c.id,
      userId: USER,
      address: evmAccount.address,
      signature: "0x" + "11".repeat(65),
    });
    expect(bad.ok).toBe(false);

    const signature = await evmAccount.signMessage({ message: c.message });
    const retry = await verifyOwnership({
      challengeId: c.id,
      userId: USER,
      address: evmAccount.address,
      signature,
    });
    expect(retry.ok).toBe(true);
  });

  it("refuses a challenge issued to a different account", async () => {
    // Otherwise an attacker could have a victim sign a challenge and submit it
    // under their own account.
    const c = await evmChallenge();
    const signature = await evmAccount.signMessage({ message: c.message });
    const r = await verifyOwnership({
      challengeId: c.id,
      userId: OTHER_USER,
      address: evmAccount.address,
      signature,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("wrong_user");
  });

  it("refuses to verify an address the challenge was not issued for", async () => {
    const other = privateKeyToAccount(
      "0x4c0883a69102937d6231471b5dbb6204fe512961708279e2ff1e0b4c3d5b6a11" as `0x${string}`
    );
    const c = await evmChallenge(evmAccount.address);
    const signature = await other.signMessage({ message: c.message });
    const r = await verifyOwnership({
      challengeId: c.id,
      userId: USER,
      address: other.address,
      signature,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("address_mismatch");
  });

  it("refuses an unknown challenge id", async () => {
    const r = await verifyOwnership({
      challengeId: "does-not-exist",
      userId: USER,
      address: evmAccount.address,
      signature: "0x" + "11".repeat(65),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown_challenge");
  });

  it("bounds the window a captured signature stays useful", () => {
    // Five minutes: long enough to open a wallet and read the message, short
    // enough that a signature scraped from a screen share is stale.
    expect(CHALLENGE_TTL_SECONDS).toBeLessThanOrEqual(600);
    expect(CHALLENGE_TTL_SECONDS).toBeGreaterThanOrEqual(60);
  });
});
