import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, encode, hexToBytes, toBigInt, toMinimalBytes, type RlpInput } from "./rlp";

// ---------------------------------------------------------------------------
// EIP-1559 (type-2) transaction serialization and hashing.
//
// Pure functions over plain values: no key material, no network, no biometric.
// That split is deliberate — this is the part that must be exactly right, and
// keeping it free of I/O is what lets it be tested on a laptop instead of only
// on a phone with a funded wallet.
//
// The envelope (EIP-2718 / EIP-1559):
//
//   unsigned digest = keccak256(0x02 ‖ rlp([
//       chainId, nonce, maxPriorityFeePerGas, maxFeePerGas, gasLimit,
//       to, value, data, accessList ]))
//
//   raw signed tx  = 0x02 ‖ rlp([ …the same nine…, yParity, r, s ])
//
// FIELD ORDER IS NOT ALPHABETICAL AND NOT INTUITIVE. `maxPriorityFeePerGas`
// comes BEFORE `maxFeePerGas`. Swapping them still produces a well-formed,
// signable transaction — one that pays the tip as the cap and vice versa. It
// will not be rejected; it will just behave wrongly and cost money. This is the
// single most valuable thing the tests in evmTransaction.test.ts pin.
//
// Legacy and type-1 transactions are not supported. Every chain this app
// touches (Arbitrum, Base, Polygon, Ethereum, Robinhood Chain) has supported
// type-2 for years, and a second code path would double the surface where the
// above can go wrong.
// ---------------------------------------------------------------------------

/** An unsigned EIP-1559 transaction, in the units the chain actually uses. */
export interface Eip1559Transaction {
  chainId: number;
  nonce: bigint;
  maxPriorityFeePerGas: bigint;
  maxFeePerGas: bigint;
  gasLimit: bigint;
  /** 0x-prefixed 20-byte address. Contract creation is not supported here. */
  to: string;
  value: bigint;
  /** 0x-prefixed calldata; "0x" for a plain transfer. */
  data: string;
}

export interface Signature {
  /** 0 or 1 — EIP-1559 uses yParity, NOT the legacy v of 27/28 or 35+. */
  yParity: number;
  r: bigint;
  s: bigint;
}

const TRANSACTION_TYPE = 0x02;

/** The nine signed-over fields, in consensus order. */
function payloadFields(tx: Eip1559Transaction): RlpInput[] {
  if (!/^0x[0-9a-fA-F]{40}$/.test(tx.to)) {
    // Contract creation would be an empty `to`, and nothing in this app creates
    // contracts. Rejecting is better than silently encoding a deployment.
    throw new Error(`Invalid recipient address: ${tx.to}`);
  }
  return [
    toMinimalBytes(BigInt(tx.chainId)),
    toMinimalBytes(tx.nonce),
    toMinimalBytes(tx.maxPriorityFeePerGas),
    toMinimalBytes(tx.maxFeePerGas),
    toMinimalBytes(tx.gasLimit),
    hexToBytes(tx.to),
    toMinimalBytes(tx.value),
    hexToBytes(tx.data ?? "0x"),
    // Empty access list. Present as an empty RLP LIST (0xc0), which is not the
    // same as an empty string (0x80) — encoding it as the latter changes the
    // hash and produces a transaction no node will accept.
    [],
  ];
}

/** The digest a signer must sign for this transaction. */
export function signingHash(tx: Eip1559Transaction): Uint8Array {
  const encoded = encode(payloadFields(tx));
  const envelope = new Uint8Array(encoded.length + 1);
  envelope[0] = TRANSACTION_TYPE;
  envelope.set(encoded, 1);
  return keccak_256(envelope);
}

/** The raw, broadcastable transaction, as 0x-hex for `eth_sendRawTransaction`. */
export function serializeSigned(tx: Eip1559Transaction, sig: Signature): string {
  if (sig.yParity !== 0 && sig.yParity !== 1) {
    // A legacy v (27/28) landing here would serialize as a valid-looking but
    // unrecoverable signature.
    throw new Error(`yParity must be 0 or 1, got ${sig.yParity}`);
  }
  const encoded = encode([
    ...payloadFields(tx),
    // yParity 0 is the empty string under RLP's minimal-integer rule, which is
    // correct and is what every node expects.
    toMinimalBytes(BigInt(sig.yParity)),
    toMinimalBytes(sig.r),
    toMinimalBytes(sig.s),
  ]);
  const envelope = new Uint8Array(encoded.length + 1);
  envelope[0] = TRANSACTION_TYPE;
  envelope.set(encoded, 1);
  return bytesToHex(envelope);
}

/** The hash the transaction will have on-chain, once broadcast. */
export function transactionHash(tx: Eip1559Transaction, sig: Signature): string {
  return bytesToHex(keccak_256(hexToBytes(serializeSigned(tx, sig))));
}

/**
 * Total wei this transaction can cost at worst: value + gasLimit × maxFeePerGas.
 *
 * Used to check the balance BEFORE asking for a biometric. `maxFeePerGas` is
 * the cap, not the expected price, so this over-estimates on purpose — the
 * failure it prevents is a user authorising a transaction that then reverts
 * out-of-funds after they have already paid gas for it.
 */
export function maximumCostWei(tx: Eip1559Transaction): bigint {
  return tx.value + tx.gasLimit * tx.maxFeePerGas;
}

/**
 * Builds an unsigned transaction from Li.Fi's `transactionRequest` plus the
 * chain state the client had to fetch.
 *
 * Li.Fi supplies `to`, `data`, `value` and a `gasLimit` estimate; nonce and fee
 * caps are per-account and per-block, so they are ours to determine.
 */
export function fromTransactionRequest(
  request: { to: string; data: string; value: string; chainId: number; gasLimit?: string },
  chainState: {
    nonce: bigint;
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
    /** Used when the route did not carry an estimate. */
    fallbackGasLimit: bigint;
  }
): Eip1559Transaction {
  const routeGas = request.gasLimit ? toBigInt(request.gasLimit) : 0n;
  return {
    chainId: request.chainId,
    nonce: chainState.nonce,
    maxPriorityFeePerGas: chainState.maxPriorityFeePerGas,
    maxFeePerGas: chainState.maxFeePerGas,
    gasLimit: routeGas > 0n ? routeGas : chainState.fallbackGasLimit,
    to: request.to,
    value: toBigInt(request.value),
    data: request.data || "0x",
  };
}
