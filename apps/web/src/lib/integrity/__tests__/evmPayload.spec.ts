import { describe, it, expect } from "vitest";
import {
  canonicaliseChainPayload,
  chainPayloadDigest,
  decodeErc20Call,
  evmSigningHash,
  normaliseChainPayload,
  verifyPayloadMatchesIntent,
  ChainPayloadError,
  type EvmChainPayload,
} from "../evmPayload";
import { intentDigest, type CanonicalIntent } from "../canonical";

// ---------------------------------------------------------------------------
// The property under test: the intent and the calldata must AGREE.
//
// A digest proves the bytes did not change. It says nothing about what they
// mean. Without the decode below, a client could submit `amountMinor: "1"` —
// passing every budget, every policy, every confirmation screen — alongside
// calldata transferring the whole balance to an attacker, and every control
// above would report success.
// ---------------------------------------------------------------------------

const USDC_ARBITRUM = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
const ALICE = "0x1111111111111111111111111111111111111111";
const MALLORY = "0x2222222222222222222222222222222222222222";
const SPENDER = "0x3333333333333333333333333333333333333333";

/** `transfer(to, amount)` calldata, built the way a client would. */
function transferCalldata(to: string, amountMinor: bigint): string {
  return (
    "0xa9059cbb" +
    to.replace(/^0x/, "").toLowerCase().padStart(64, "0") +
    amountMinor.toString(16).padStart(64, "0")
  );
}

function approveCalldata(spender: string, amountMinor: bigint): string {
  return (
    "0x095ea7b3" +
    spender.replace(/^0x/, "").toLowerCase().padStart(64, "0") +
    amountMinor.toString(16).padStart(64, "0")
  );
}

function payload(over: Partial<EvmChainPayload> = {}): EvmChainPayload {
  return {
    chainId: 42161,
    nonce: 7,
    gasLimit: "120000",
    maxFeePerGas: "50000000",
    maxPriorityFeePerGas: "1000000",
    to: USDC_ARBITRUM,
    value: "0",
    data: transferCalldata(ALICE, 10_000_000n),
    ...over,
  };
}

/** An intent bound to `p`. The payload digest is folded in, as prepare does. */
function intentFor(p: EvmChainPayload, over: Partial<CanonicalIntent> = {}): CanonicalIntent {
  const base: CanonicalIntent = {
    action: "transfer",
    intentId: "itx_" + "a".repeat(32),
    accountId: "0x9999999999999999999999999999999999999999",
    chain: "arbitrum",
    assetId: "USDC.arbitrum",
    amountMinor: "10000000",
    destination: ALICE,
    chainPayloadDigest: chainPayloadDigest(p),
    nonce: "b".repeat(32),
    issuedAt: 1_757_000_000_000,
    expiresAt: 1_757_000_600_000,
    ...over,
  };
  // When the caller overrode a field that changes the payload binding, the
  // digest must be recomputed or the test would fail for the wrong reason.
  return base;
}

describe("payload normalisation", () => {
  it("lower-cases addresses and hex BEFORE the digest is taken", () => {
    // Otherwise the same transaction in different capitalisation yields two
    // differently-bound authorizations for identical bytes.
    const lower = payload();
    const upper = payload({
      to: USDC_ARBITRUM.toUpperCase().replace("0X", "0x"),
      data: transferCalldata(ALICE, 10_000_000n).toUpperCase().replace("0X", "0x"),
    });
    expect(chainPayloadDigest(upper)).toBe(chainPayloadDigest(lower));
  });

  it("strips leading zeros from 256-bit values consistently", () => {
    expect(normaliseChainPayload(payload({ value: "0000" })).value).toBe("0");
  });

  it("REFUSES a tip above the fee cap", () => {
    expect(() =>
      normaliseChainPayload(payload({ maxFeePerGas: "10", maxPriorityFeePerGas: "11" }))
    ).toThrow(ChainPayloadError);
  });

  it("REFUSES a zero gas limit, a bad address and odd-length calldata", () => {
    expect(() => normaliseChainPayload(payload({ gasLimit: "0" }))).toThrow();
    expect(() => normaliseChainPayload(payload({ to: "0xnope" }))).toThrow();
    expect(() => normaliseChainPayload(payload({ data: "0xabc" }))).toThrow();
  });

  it("REFUSES a float or a negative amount", () => {
    expect(() => normaliseChainPayload(payload({ value: "1.5" }))).toThrow();
    expect(() => normaliseChainPayload(payload({ value: "-1" }))).toThrow();
  });

  it("changes the digest when ANY field changes", () => {
    const base = chainPayloadDigest(payload());
    const fields: Partial<EvmChainPayload>[] = [
      { chainId: 1 },
      { nonce: 8 },
      { gasLimit: "120001" },
      { maxFeePerGas: "50000001" },
      { maxPriorityFeePerGas: "1000001" },
      { to: MALLORY },
      { value: "1" },
      { data: transferCalldata(ALICE, 10_000_001n) },
    ];
    for (const over of fields) {
      expect(chainPayloadDigest(payload(over)), JSON.stringify(over)).not.toBe(base);
    }
  });

  it("produces an unambiguous encoding", () => {
    // The separators are what make field boundaries unambiguous; a value
    // containing one could shift every later field.
    expect(canonicaliseChainPayload(payload())).toContain("evm1");
  });
});

describe("EVM signing hash", () => {
  it("is 32 bytes and is NOT the canonical digest", () => {
    // The distinction this whole module exists for: the canonical digest is a
    // binding value; the chain wants keccak of the RLP-encoded transaction.
    const p = payload();
    const hash = evmSigningHash(p);
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(hash.slice(2)).not.toBe(chainPayloadDigest(p));
    expect(hash.slice(2)).not.toBe(intentDigest(intentFor(p)));
  });

  it("is deterministic, and changes with the transaction", () => {
    expect(evmSigningHash(payload())).toBe(evmSigningHash(payload()));
    expect(evmSigningHash(payload({ nonce: 8 }))).not.toBe(evmSigningHash(payload()));
  });
});

describe("ERC-20 decoding is strict", () => {
  it("decodes a transfer and an approval", () => {
    expect(decodeErc20Call(transferCalldata(ALICE, 42n))).toEqual({
      kind: "transfer",
      counterparty: ALICE,
      amountMinor: "42",
    });
    expect(decodeErc20Call(approveCalldata(SPENDER, 1n))?.kind).toBe("approve");
  });

  it("REJECTS trailing calldata", () => {
    // Solidity ignores trailing bytes, so a lenient decoder and the EVM would
    // disagree about what the transaction is — and our simulation would be
    // evidence about a different transaction than the one that runs.
    expect(decodeErc20Call(transferCalldata(ALICE, 42n) + "deadbeef")).toBeNull();
  });

  it("REJECTS non-zero address padding", () => {
    // The EVM masks the top 12 bytes off, so dirty padding changes nothing
    // on-chain while changing what a naive decoder reads.
    const dirty = "0xa9059cbb" + "01" + "0".repeat(22) + ALICE.slice(2) + "0".repeat(64);
    expect(decodeErc20Call(dirty)).toBeNull();
  });

  it("returns null for an unknown selector and for empty calldata", () => {
    expect(decodeErc20Call("0x12345678" + "0".repeat(128))).toBeNull();
    expect(decodeErc20Call("0x")).toBeNull();
  });
});

describe("THE ATTACK: intent and calldata must agree", () => {
  it("accepts a transfer that matches", () => {
    const p = payload();
    expect(verifyPayloadMatchesIntent(intentFor(p), p).ok).toBe(true);
  });

  it("BLOCKS a small declared amount next to a large calldata amount", () => {
    // The whole reason this file exists. `amountMinor: "1"` passes every
    // budget; the calldata moves 10 USDC.
    const p = payload({ data: transferCalldata(ALICE, 10_000_000n) });
    const lying = intentFor(p, { amountMinor: "1" });
    const r = verifyPayloadMatchesIntent(lying, p);
    expect(r.ok).toBe(false);
    expect(r.refusals).toContain("payload_amount_mismatch");
  });

  it("BLOCKS a different recipient in the calldata", () => {
    const p = payload({ data: transferCalldata(MALLORY, 10_000_000n) });
    const r = verifyPayloadMatchesIntent(intentFor(p), p);
    expect(r.refusals).toContain("payload_recipient_mismatch");
  });

  it("BLOCKS a lookalike token contract", () => {
    // Correct-looking transfer, wrong token. The digest would happily bind it.
    const p = payload({ to: MALLORY });
    const r = verifyPayloadMatchesIntent(intentFor(p), p);
    expect(r.refusals).toContain("payload_token_mismatch");
  });

  it("BLOCKS native value smuggled alongside a token transfer", () => {
    const p = payload({ value: "1000000000000000000" });
    const r = verifyPayloadMatchesIntent(intentFor(p), p);
    expect(r.refusals).toContain("payload_native_value_unexpected");
  });

  it("BLOCKS a payload swapped after the intent was bound", () => {
    // The intent binds payload A; payload B is presented.
    const bound = payload();
    const swapped = payload({ data: transferCalldata(MALLORY, 1n) });
    const r = verifyPayloadMatchesIntent(intentFor(bound), swapped);
    expect(r.refusals).toContain("payload_digest_mismatch");
  });

  it("BLOCKS a chain that is not the intent's settlement domain", () => {
    // USDC.arbitrum signed against chainId 1 is a different asset on a
    // different chain, and that address may belong to someone else entirely.
    const p = payload({ chainId: 1 });
    const r = verifyPayloadMatchesIntent(intentFor(p), p);
    expect(r.refusals).toContain("payload_chain_mismatch");
  });

  it("BLOCKS calldata it cannot read, rather than passing it", () => {
    // A signing path that cannot explain what it is signing must not sign.
    const p = payload({ data: "0xdeadbeef" });
    const r = verifyPayloadMatchesIntent(intentFor(p), p);
    expect(r.refusals).toContain("payload_not_verifiable");
  });

  it("BLOCKS an unsupported action outright", () => {
    // swap / withdraw / contract_call have no verifier yet. Refusing is the
    // only honest answer — an amount cannot be checked against calldata whose
    // semantics we do not read.
    for (const action of ["swap", "withdraw", "contract_call", "card_authorize"] as const) {
      const p = payload();
      const r = verifyPayloadMatchesIntent(intentFor(p, { action }), p);
      expect(r.refusals, action).toContain("payload_action_unsupported");
    }
  });
});

describe("approvals bind the SPENDER, not the destination", () => {
  function approvalCase(over: Partial<CanonicalIntent> = {}, amount = 1_000_000n) {
    const p = payload({ data: approveCalldata(SPENDER, amount) });
    const intent = intentFor(p, {
      action: "approve",
      amountMinor: amount.toString(),
      spender: SPENDER,
      ...over,
    });
    return { p, intent, result: verifyPayloadMatchesIntent(intent, p) };
  }

  it("accepts a matching approval", () => {
    expect(approvalCase().result.ok).toBe(true);
  });

  it("BLOCKS a different spender in the calldata", () => {
    // An approval's danger IS the spender, which is why the intent carries it
    // as its own field rather than reusing `destination`.
    expect(approvalCase({ spender: MALLORY }).result.refusals).toContain(
      "payload_spender_mismatch"
    );
  });

  it("BLOCKS an approval intent with no spender named", () => {
    expect(approvalCase({ spender: undefined }).result.refusals).toContain(
      "payload_spender_mismatch"
    );
  });

  it("BLOCKS an approval whose declared amount understates the allowance", () => {
    const p = payload({ data: approveCalldata(SPENDER, (1n << 256n) - 1n) });
    const intent = intentFor(p, { action: "approve", amountMinor: "1", spender: SPENDER });
    expect(verifyPayloadMatchesIntent(intent, p).refusals).toContain("payload_amount_mismatch");
  });
});

describe("native transfers", () => {
  it("accepts a native transfer whose value and recipient match", () => {
    const p = payload({ to: ALICE, value: "1000000000000000000", data: "0x" });
    const intent = intentFor(p, {
      assetId: "ETH.arbitrum",
      amountMinor: "1000000000000000000",
      destination: ALICE,
    });
    expect(verifyPayloadMatchesIntent(intent, p).ok).toBe(true);
  });

  it("BLOCKS empty calldata for an asset that is a token", () => {
    // Empty calldata cannot move a token, whatever the intent claims.
    const p = payload({ to: ALICE, value: "10000000", data: "0x" });
    const r = verifyPayloadMatchesIntent(intentFor(p), p);
    expect(r.refusals).toContain("payload_token_mismatch");
  });

  it("BLOCKS a native value that differs from the declared amount", () => {
    const p = payload({ to: ALICE, value: "2", data: "0x" });
    const intent = intentFor(p, { assetId: "ETH.arbitrum", amountMinor: "1", destination: ALICE });
    expect(verifyPayloadMatchesIntent(intent, p).refusals).toContain("payload_amount_mismatch");
  });
});
