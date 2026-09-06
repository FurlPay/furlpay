import { createHash } from "crypto";
import { keccak256, serializeTransaction } from "viem";
import { EVM_CHAIN_IDS } from "@/lib/x402Signature";
import { deploymentForAsset } from "@/lib/assets/stablecoins";
import type { CanonicalIntent } from "./canonical";

// ---------------------------------------------------------------------------
// The chain payload, and the two things the server must be able to do with it
// WITHOUT trusting the client: derive the bytes that will actually be signed,
// and prove those bytes mean what the intent says they mean.
//
// WHY THIS FILE HAD TO EXIST.
//
// The boundary binds simulation, attestation, confirmation and signing to one
// canonical digest — a SHA-256 over the intent. That digest is a BINDING value.
// It is not, and can never be, the thing an EVM chain wants signed: that is
// keccak256 of the RLP-encoded EIP-1559 transaction. Signing the canonical
// digest produces 65 bytes that recover to the right key over the wrong
// message; the client's own recovery check (mpcSigner.ts) rejects it, and if it
// did not, the chain would.
//
// So the server needs the transaction itself. And the moment the server holds
// the transaction, the real question appears:
//
//     THE INTENT SAYS "send 10 USDC to Alice".
//     THE CALLDATA SAYS whatever 68 bytes the client put in it.
//
// Nothing in the canonical intent forces those to agree. A client could submit
// `amountMinor: "1"` — passing every spend policy, every budget, every
// confirmation screen — alongside calldata transferring the entire balance to
// an attacker. Simulation would run on the calldata, the user would confirm the
// SUMMARY, and the two would describe different transactions. That is the
// original vulnerability wearing a different hat.
//
// `verifyPayloadMatchesIntent` is the answer, and it is the load-bearing
// function here: the calldata is DECODED and compared field by field against
// the intent. They agree or nothing is authorised.
//
// WHY NOT LET THE SERVER BUILD THE TRANSACTION OUTRIGHT. It cannot, honestly:
// gas parameters and the account nonce come from the chain as the client sees
// it, and inventing them server-side would mean guessing. The client proposes;
// the server verifies, freezes and signs. What matters is that the proposal is
// frozen at authorization time and re-read from storage at signing time, so
// there is no window in which it can be swapped.
//
// WHAT THIS REFUSES TO DO. Arbitrary calldata is NOT verifiable against an
// amount and a destination — that is the general problem of understanding an
// unknown contract, and any answer short of a full simulation is a guess. So
// unknown calldata is REFUSED rather than waved through. A signing path that
// cannot explain what it is signing must not sign.
// ---------------------------------------------------------------------------

/**
 * An EIP-1559 transaction, as the client proposes it.
 *
 * Every numeric field is a decimal STRING for the same reason amounts are in
 * `CanonicalIntent`: these are 256-bit values, `number` silently loses
 * precision above 2^53, and a wei amount routinely exceeds that.
 */
export interface EvmChainPayload {
  readonly chainId: number;
  /** The ACCOUNT nonce from the chain — not the anti-replay nonce in the intent. */
  readonly nonce: number;
  readonly gasLimit: string;
  readonly maxFeePerGas: string;
  readonly maxPriorityFeePerGas: string;
  /** Contract or recipient the transaction is addressed to. */
  readonly to: string;
  /** Native value in wei. "0" for a token transfer. */
  readonly value: string;
  /** Calldata, 0x-prefixed hex. "0x" for a native transfer. */
  readonly data: string;
}

export class ChainPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChainPayloadError";
  }
}

const UINT256_MAX = (1n << 256n) - 1n;
const SEPARATOR = "\x1f";
const RECORD = "\x1e";

const PAYLOAD_FIELD_ORDER: readonly (keyof EvmChainPayload)[] = [
  "chainId",
  "nonce",
  "gasLimit",
  "maxFeePerGas",
  "maxPriorityFeePerGas",
  "to",
  "value",
  "data",
];

function assertUint(name: string, value: string): bigint {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new ChainPayloadError(`${name} must be an unsigned decimal string, got "${value}".`);
  }
  const parsed = BigInt(value);
  if (parsed > UINT256_MAX) throw new ChainPayloadError(`${name} exceeds uint256.`);
  return parsed;
}

function assertAddress(name: string, value: string): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new ChainPayloadError(`${name} must be a 20-byte hex address, got "${value}".`);
  }
  return value.toLowerCase();
}

function assertCalldata(value: string): string {
  if (typeof value !== "string" || !/^0x([0-9a-fA-F]{2})*$/.test(value)) {
    throw new ChainPayloadError(`data must be 0x-prefixed hex of whole bytes, got "${value}".`);
  }
  // A megabyte of calldata in a payments app is not a payment. The cap is well
  // above any transfer or approval and well below anything that could be used
  // to make canonicalisation or storage expensive.
  if (value.length > 8192) throw new ChainPayloadError("data exceeds the permitted size.");
  return value.toLowerCase();
}

/**
 * Validate and normalise a proposed payload.
 *
 * Normalisation is not cosmetic: address case and hex case must be fixed
 * BEFORE the digest is taken, or a client could re-send the same transaction
 * with different capitalisation and obtain a second, differently-bound
 * authorization for identical bytes.
 */
export function normaliseChainPayload(input: EvmChainPayload): EvmChainPayload {
  if (!Number.isInteger(input.chainId) || input.chainId <= 0) {
    throw new ChainPayloadError(`chainId must be a positive integer, got ${input.chainId}.`);
  }
  if (!Number.isInteger(input.nonce) || input.nonce < 0) {
    throw new ChainPayloadError(`nonce must be a non-negative integer, got ${input.nonce}.`);
  }
  const gasLimit = assertUint("gasLimit", input.gasLimit);
  const maxFeePerGas = assertUint("maxFeePerGas", input.maxFeePerGas);
  const maxPriorityFeePerGas = assertUint("maxPriorityFeePerGas", input.maxPriorityFeePerGas);

  // EIP-1559 requires the tip not to exceed the cap. A node would reject it,
  // but rejecting here means the user is told before a signature exists rather
  // than after one has been minted and possibly broadcast.
  if (maxPriorityFeePerGas > maxFeePerGas) {
    throw new ChainPayloadError("maxPriorityFeePerGas must not exceed maxFeePerGas.");
  }
  if (gasLimit === 0n) throw new ChainPayloadError("gasLimit must be non-zero.");

  return {
    chainId: input.chainId,
    nonce: input.nonce,
    gasLimit: gasLimit.toString(),
    maxFeePerGas: maxFeePerGas.toString(),
    maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
    to: assertAddress("to", input.to),
    value: assertUint("value", input.value).toString(),
    data: assertCalldata(input.data),
  };
}

/**
 * Deterministic string form. Same encoding discipline as `canonicalise`:
 * explicit field order, explicit separators, separators rejected in values.
 */
export function canonicaliseChainPayload(payload: EvmChainPayload): string {
  const p = normaliseChainPayload(payload);
  const parts: string[] = ["evm1"];
  for (const field of PAYLOAD_FIELD_ORDER) {
    const value = String(p[field]);
    if (value.includes(SEPARATOR) || value.includes(RECORD)) {
      throw new ChainPayloadError(`Payload field "${field}" contains a reserved separator.`);
    }
    parts.push(`${field}${SEPARATOR}${value}${RECORD}`);
  }
  return parts.join("");
}

/**
 * SHA-256 of the canonical payload.
 *
 * Carried inside `CanonicalIntent.chainPayloadDigest`, which is what folds the
 * exact transaction into the intent digest that every other control commits to.
 * Without it the boundary would bind a *description* of a payment while the
 * bytes underneath stayed free.
 */
export function chainPayloadDigest(payload: EvmChainPayload): string {
  return createHash("sha256").update(canonicaliseChainPayload(payload), "utf8").digest("hex");
}

/**
 * The bytes an EVM chain actually wants signed: keccak256 of the RLP-encoded
 * unsigned EIP-1559 transaction.
 *
 * Derived from the SERVER'S stored payload at signing time — never handed in by
 * the caller. That is the whole inversion: the client no longer says "sign
 * these 32 bytes", it presents an authorization and the server works out which
 * 32 bytes that authorization means.
 */
export function evmSigningHash(payload: EvmChainPayload): `0x${string}` {
  const p = normaliseChainPayload(payload);
  const serialized = serializeTransaction({
    type: "eip1559",
    chainId: p.chainId,
    nonce: p.nonce,
    gas: BigInt(p.gasLimit),
    maxFeePerGas: BigInt(p.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(p.maxPriorityFeePerGas),
    to: p.to as `0x${string}`,
    value: BigInt(p.value),
    data: p.data as `0x${string}`,
  });
  return keccak256(serialized);
}

// ── Calldata decoding ──────────────────────────────────────────────────────

/** `transfer(address,uint256)` — keccak("transfer(address,uint256)")[0..4]. */
const SELECTOR_TRANSFER = "0xa9059cbb";
/** `approve(address,uint256)` — keccak("approve(address,uint256)")[0..4]. */
const SELECTOR_APPROVE = "0x095ea7b3";

export interface Erc20Call {
  readonly kind: "transfer" | "approve";
  /** Recipient for a transfer, spender for an approval. Lower-case. */
  readonly counterparty: string;
  /** Token minor units, decimal string. */
  readonly amountMinor: string;
}

/**
 * Decode a two-argument ERC-20 call, or return null.
 *
 * Deliberately strict about LENGTH. Solidity ignores trailing calldata, so
 * `transfer(a, n)` followed by arbitrary extra bytes executes identically —
 * which means a lenient decoder and the EVM would disagree about what the
 * transaction is, and a simulation keyed on our reading would be evidence about
 * a different transaction than the one that runs.
 *
 * Equally strict about the ADDRESS PADDING. An `address` argument is a 32-byte
 * word whose first 12 bytes must be zero. The EVM masks them off, so non-zero
 * padding changes nothing on-chain while changing what a naive decoder reads —
 * a free way to show one recipient here and use another there.
 */
export function decodeErc20Call(data: string): Erc20Call | null {
  const hex = data.toLowerCase();
  // 0x + 4-byte selector + two 32-byte words.
  if (hex.length !== 2 + 8 + 64 + 64) return null;

  const selector = hex.slice(0, 10);
  const kind =
    selector === SELECTOR_TRANSFER ? "transfer" : selector === SELECTOR_APPROVE ? "approve" : null;
  if (!kind) return null;

  const word0 = hex.slice(10, 74);
  const word1 = hex.slice(74, 138);

  if (!/^0{24}[0-9a-f]{40}$/.test(word0)) return null;
  if (!/^[0-9a-f]{64}$/.test(word1)) return null;

  return {
    kind,
    counterparty: "0x" + word0.slice(24),
    amountMinor: BigInt("0x" + word1).toString(),
  };
}

// ── The check that makes the intent mean something ─────────────────────────

export type PayloadRefusal =
  | "payload_chain_mismatch"
  | "payload_digest_mismatch"
  | "payload_action_unsupported"
  | "payload_not_verifiable"
  | "payload_token_mismatch"
  | "payload_recipient_mismatch"
  | "payload_spender_mismatch"
  | "payload_amount_mismatch"
  | "payload_native_value_unexpected";

export interface PayloadVerification {
  readonly ok: boolean;
  readonly refusals: readonly PayloadRefusal[];
  /** What the calldata actually says, for the confirmation screen and audit. */
  readonly decoded: Erc20Call | null;
}

/**
 * Prove the transaction bytes say what the intent says.
 *
 * Collects every mismatch rather than returning on the first, for the same
 * reason the boundary does: during an incident, "recipient differs AND amount
 * differs" and "amount differs alone" are different stories.
 *
 * Refuses by default. Every branch that cannot establish agreement ends in a
 * refusal, and there is no `else { return ok }`.
 */
export function verifyPayloadMatchesIntent(
  intent: CanonicalIntent,
  payload: EvmChainPayload
): PayloadVerification {
  const refusals: PayloadRefusal[] = [];
  const p = normaliseChainPayload(payload);

  // 1. The intent's settlement domain and the payload's chain must be the same
  //    network. `USDC.arbitrum` signed against chainId 1 is a different asset
  //    on a different chain, and the address may well belong to someone else.
  const expectedChainId = EVM_CHAIN_IDS[intent.chain];
  if (expectedChainId === undefined || expectedChainId !== p.chainId) {
    refusals.push("payload_chain_mismatch");
  }

  // 2. The payload must be the one folded into the intent digest. Without this
  //    the intent could be bound to payload A while payload B is stored.
  if (intent.chainPayloadDigest !== chainPayloadDigest(p)) {
    refusals.push("payload_digest_mismatch");
  }

  const decoded = decodeErc20Call(p.data);
  const deployment = deploymentForAsset(intent.assetId);
  const isNative = p.data === "0x";

  switch (intent.action) {
    case "transfer": {
      if (isNative) {
        // A native transfer: the asset must BE the chain's native coin, which
        // has no token deployment. If the intent names a token, an empty
        // calldata cannot possibly move it.
        if (deployment) {
          refusals.push("payload_token_mismatch");
          break;
        }
        if (p.to !== intent.destination.toLowerCase()) refusals.push("payload_recipient_mismatch");
        if (p.value !== intent.amountMinor) refusals.push("payload_amount_mismatch");
        break;
      }
      if (!decoded || decoded.kind !== "transfer") {
        // Calldata we cannot read is calldata we cannot confirm. Refuse.
        refusals.push("payload_not_verifiable");
        break;
      }
      if (!deployment) {
        // The intent names an asset with no known contract, so there is nothing
        // to compare `to` against and no way to know the token is the right one.
        refusals.push("payload_token_mismatch");
        break;
      }
      if (p.to !== deployment.contractAddress.toLowerCase()) {
        // The classic lookalike-contract substitution: correct-looking transfer
        // to the wrong token.
        refusals.push("payload_token_mismatch");
      }
      if (p.value !== "0") {
        // A token transfer that also sends native value is doing something the
        // intent does not describe.
        refusals.push("payload_native_value_unexpected");
      }
      if (decoded.counterparty !== intent.destination.toLowerCase()) {
        refusals.push("payload_recipient_mismatch");
      }
      if (decoded.amountMinor !== intent.amountMinor) {
        refusals.push("payload_amount_mismatch");
      }
      break;
    }

    case "approve": {
      if (!decoded || decoded.kind !== "approve") {
        refusals.push("payload_not_verifiable");
        break;
      }
      if (!deployment || p.to !== deployment.contractAddress.toLowerCase()) {
        refusals.push("payload_token_mismatch");
      }
      if (p.value !== "0") refusals.push("payload_native_value_unexpected");
      // An approval's danger is the SPENDER, which is why the intent carries it
      // as its own field rather than reusing `destination`.
      if (!intent.spender || decoded.counterparty !== intent.spender.toLowerCase()) {
        refusals.push("payload_spender_mismatch");
      }
      if (decoded.amountMinor !== intent.amountMinor) {
        refusals.push("payload_amount_mismatch");
      }
      break;
    }

    default:
      // swap, withdraw, contract_call, card_authorize. Each of these is a call
      // into a contract whose semantics we cannot read off the calldata, so an
      // amount and a destination cannot be checked against it. They need their
      // own verifier — a router-specific decoder, or a simulation whose asset
      // deltas are compared to the intent. Until one exists, refusing is the
      // only honest answer: a signing path that cannot explain what it is
      // signing must not sign.
      refusals.push("payload_action_unsupported");
  }

  return { ok: refusals.length === 0, refusals, decoded };
}
