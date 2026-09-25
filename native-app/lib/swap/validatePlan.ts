import { keccak_256 } from "@noble/hashes/sha3";
import type { Eip1559Transaction } from "@/lib/evm/transaction";

// ---------------------------------------------------------------------------
// Everything that must be true before a key touches a transaction.
//
// The server already validates the route it got from Li.Fi. This re-checks it
// on the device anyway, and that is not redundancy for its own sake: the thing
// on the other side of this function is a signature from a key we hold and the
// server does not. A compromised or simply buggy backend response should not be
// able to produce a signed transaction on a chain the user never chose, to an
// address that is not an address, or with calldata that is missing.
//
// Defence in depth is cheap here — a few regexes against a request the user is
// about to authorise with their face.
// ---------------------------------------------------------------------------

/**
 * chainId per slug, matching CHAIN_REGISTRY server-side.
 *
 * DELIBERATELY NARROWER than lib/evm/rpc.ts's `ChainSlug`. This table is the
 * allow-list of chains a SWAP may be signed for, and it is not the same question
 * as which chains the RPC proxy serves.
 *
 * Circle Arc (5042 / 5042002) is absent on purpose. A swap needs a route from a
 * liquidity provider and none is configured for Arc, so a swap there cannot be
 * quoted — and listing the chain here would let a malformed or hostile response
 * get as far as a signature request for a route that does not exist. Adding a
 * chain to this table is a claim that swaps work on it; adding one to the RPC
 * slug list is only a claim that the proxy will forward a call.
 *
 * The type split is what keeps that honest: TypeScript refuses to pass an Arc
 * slug into `assertPlanSignable`, so the omission is enforced at compile time
 * rather than relying on a runtime check nobody re-reads.
 */
export const CHAIN_IDS = {
  ethereum: 1,
  arbitrum: 42161,
  base: 8453,
  polygon: 137,
  robinhood: 4663,
} as const;

/** Chains a swap may be signed for. See the note above on why Arc is not one. */
export type ChainSlug = keyof typeof CHAIN_IDS;

/**
 * Confirmations before a receipt is treated as final, per chain.
 *
 * One confirmation is a probability, not a fact, and the probability differs
 * enormously by chain — so a single global default is wrong somewhere by
 * construction. Ethereum L1 reorgs of one or two blocks are routine; the
 * rollups here have a sequencer and a single confirmation is settled for
 * practical purposes. Polygon sits in between and has historically seen deeper
 * reorgs than either.
 */
export const CONFIRMATIONS: Record<ChainSlug, number> = {
  ethereum: 3,
  polygon: 2,
  arbitrum: 1,
  base: 1,
  robinhood: 1,
};

/**
 * A 20-byte address whose EIP-55 checksum, IF PRESENT, is correct.
 *
 * Implemented here with keccak_256 rather than pulled from viem/ethers. This
 * app has neither: the wallet is built directly on @noble/curves and
 * @noble/hashes, which is why lib/evm hand-rolls RLP and EIP-1559 too. Adding
 * viem for one predicate would mean a TextEncoder polyfill on Expo SDK 53 and a
 * bundle cost, to reimplement twenty lines we already have the primitives for.
 *
 * THE CASE RULE MATTERS AND IS EASY TO GET BACKWARDS. Per EIP-55, an
 * all-lowercase or all-uppercase address carries NO checksum and is perfectly
 * valid — rejecting those would reject addresses users legitimately paste, and
 * lowercase is what plenty of explorers and APIs emit. Only a MIXED-case
 * address is claiming a checksum, and only then must it verify. Getting this
 * inverted turns a safety check into an outage.
 */
export function isAddress(value: unknown): value is string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) return false;

  const body = value.slice(2);
  const hasUpper = /[A-F]/.test(body);
  const hasLower = /[a-f]/.test(body);
  // No mixed case → no checksum claimed → nothing to verify.
  if (!hasUpper || !hasLower) return true;

  return body === checksumBody(body.toLowerCase());
}

/** EIP-55 body: uppercase a hex letter when its nibble in keccak(lower) ≥ 8. */
function checksumBody(lower: string): string {
  const hash = keccak_256(new TextEncoder().encode(lower));
  let out = "";
  for (let i = 0; i < lower.length; i++) {
    const nibble = i % 2 === 0 ? hash[i >> 1] >> 4 : hash[i >> 1] & 0x0f;
    out += nibble >= 8 ? lower[i].toUpperCase() : lower[i];
  }
  return out;
}

/** The zero address is a valid 20-byte value and never a valid counterparty. */
export function isNonZeroAddress(value: unknown): value is string {
  return isAddress(value) && !/^0x0{40}$/i.test(value);
}

/**
 * A decimal atomic amount as a bigint, or null.
 *
 * `BigInt()` throws on anything it cannot parse, and a throw from inside a
 * validator is an unhandled crash rather than a rejection the user can read.
 * The regex guards the common cases; this guards the rest.
 */
export function parseAtomic(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^\d{1,78}$/.test(value)) return null;
  try {
    const parsed = BigInt(value);
    // Above uint256 no ERC-20 can hold it and no approve() can encode it.
    return parsed < 1n << 256n ? parsed : null;
  } catch {
    return null;
  }
}

function isHexData(value: unknown): value is string {
  return typeof value === "string" && /^0x([0-9a-fA-F]{2})*$/.test(value);
}

function isQuantity(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value);
}

export interface PlanShape {
  approvalAddress: string | null;
  fromTokenAddress: string | null;
  fromAmountAtomic: string | null;
  expiresAt?: string;
  transactionRequest: {
    to: string;
    data: string;
    value: string;
    chainId: number;
    gasLimit?: string;
  };
}

export class PlanRejected extends Error {
  readonly reason: string;
  constructor(reason: string, message: string) {
    super(message);
    this.name = "PlanRejected";
    this.reason = reason;
  }
}

/**
 * Validates a plan against the chain the user actually chose.
 *
 * Throws rather than returning a boolean: every caller must handle a rejection,
 * and a boolean invites `if (!ok) {}` with an empty body.
 */
export function assertPlanSignable(plan: PlanShape, expectedChain: ChainSlug, now = Date.now()): void {
  const expectedChainId = CHAIN_IDS[expectedChain];
  if (!expectedChainId) {
    throw new PlanRejected("unsupported_chain", `Unsupported chain: ${expectedChain}`);
  }

  const tx = plan.transactionRequest;
  if (!tx) throw new PlanRejected("no_transaction", "The route came back without a transaction.");

  // The one that matters most. A plan whose chainId disagrees with the chain
  // the user picked would be signed for a DIFFERENT network — same address,
  // different chain, and on a chain where the user holds funds that signature
  // is live. Nothing else in the flow would catch it.
  if (tx.chainId !== expectedChainId) {
    throw new PlanRejected(
      "chain_mismatch",
      `This route is for chain ${tx.chainId}, not ${expectedChain}. Nothing was signed.`
    );
  }

  if (!isNonZeroAddress(tx.to)) {
    throw new PlanRejected("bad_target", "The route's destination address is invalid.");
  }
  // A swap is always a contract call. Empty calldata to a router does nothing
  // and burns gas.
  if (!isHexData(tx.data) || tx.data === "0x") {
    throw new PlanRejected("no_calldata", "The route came back without transaction data.");
  }
  if (!isQuantity(tx.value)) {
    throw new PlanRejected("bad_value", "The route's value field is malformed.");
  }
  if (tx.gasLimit !== undefined && (!isQuantity(tx.gasLimit) || BigInt(tx.gasLimit) === 0n)) {
    throw new PlanRejected("bad_gas_limit", "The route's gas limit is invalid.");
  }

  // Approval fields travel together: a spender with no token, or a token with
  // no amount, is a route that cannot be approved correctly.
  if (plan.approvalAddress !== null) {
    if (!isNonZeroAddress(plan.approvalAddress)) {
      throw new PlanRejected("bad_spender", "The route's approval address is invalid.");
    }
    if (!isNonZeroAddress(plan.fromTokenAddress)) {
      throw new PlanRejected("bad_token", "The route needs an approval but didn't name a token.");
    }
    const amount = parseAtomic(plan.fromAmountAtomic);
    if (amount === null) {
      throw new PlanRejected("bad_amount", "The route's approval amount is invalid.");
    }
    if (amount === 0n) {
      throw new PlanRejected("bad_amount", "The route wants a zero-value approval.");
    }
  }

  assertFresh(plan, now);
}

/**
 * Refuses a stale route.
 *
 * Li.Fi's /v1/quote carries no expiry of its own — verified against the live
 * endpoint — so `expiresAt` is stamped by our server when the route is built.
 * The calldata embeds a price and a `toAmountMin` computed at that moment;
 * signing it much later asks the router to honour a market that has moved,
 * which reverts on slippage at best.
 *
 * A plan with no `expiresAt` is treated as stale rather than eternal: the
 * absence of a freshness guarantee is not a freshness guarantee.
 */
export function assertFresh(plan: PlanShape, now = Date.now()): void {
  if (!plan.expiresAt) {
    throw new PlanRejected("no_expiry", "This route didn't come with an expiry. Re-quote to swap.");
  }
  const expires = Date.parse(plan.expiresAt);
  if (Number.isNaN(expires)) {
    throw new PlanRejected("no_expiry", "This route's expiry is unreadable. Re-quote to swap.");
  }
  if (now >= expires) {
    throw new PlanRejected("expired", "That quote expired. Get a fresh price and swap again.");
  }
}

/** Fee-cap sanity, checked after the client computes them from chain state. */
export function assertFeesSane(tx: Eip1559Transaction): void {
  if (tx.gasLimit <= 0n) {
    throw new PlanRejected("bad_gas_limit", "Couldn't estimate gas for this swap.");
  }
  if (tx.maxFeePerGas <= 0n) {
    throw new PlanRejected("bad_fees", "Couldn't read a gas price for this network.");
  }
  // A tip above the cap is rejected by every node — better to say so than to
  // burn a biometric on a transaction that cannot be accepted.
  if (tx.maxPriorityFeePerGas > tx.maxFeePerGas) {
    throw new PlanRejected("bad_fees", "This network reported an inconsistent gas price.");
  }
  if (tx.value < 0n || tx.nonce < 0n) {
    throw new PlanRejected("bad_transaction", "The transaction is malformed.");
  }
}
