import { isNonZeroAddress } from "./address.js";
import { hasCalldata, isQuantity, parseAtomic, parseQuantity } from "./calldata.js";
import { isBoundToChain, isChainId } from "./chain.js";
import { assertFresh, type Expirable } from "./quote.js";
import { GuardRejection } from "./rejection.js";

// ---------------------------------------------------------------------------
// The composed check: everything that must be true before a key touches a
// transaction.
//
// WHY VALIDATE A RESPONSE YOUR OWN BACKEND ALREADY VALIDATED. Because the thing
// on the other side of this function is a signature from a key the backend does
// not hold. A compromised, misconfigured or simply buggy response should not be
// able to produce a signed transaction on a chain the user never chose, to an
// address that is not an address, or with calldata that is missing.
//
// Defence in depth is cheap here — a few regexes against a request the user is
// about to authorise with their face.
// ---------------------------------------------------------------------------

/** An unsigned transaction as an aggregator or backend returns it. */
export interface TransactionRequest {
  to: string;
  data: string;
  /** Hex QUANTITY. `"0x0"` for a pure token operation. */
  value: string;
  chainId: number;
  /** Hex QUANTITY, when the route supplied an estimate. */
  gasLimit?: string;
}

/**
 * A transaction plus the ERC-20 approval it needs, if any.
 *
 * The approval fields travel together and are validated together: a spender
 * with no token, or a token with no amount, is a route that cannot be approved
 * correctly and will revert on `transferFrom` after the user has already paid
 * for a signature.
 */
export interface TransactionPlan extends Expirable {
  transactionRequest: TransactionRequest;
  /** Contract to approve, or null when no approval is needed. */
  approvalAddress?: string | null;
  /** ERC-20 being spent. Required when `approvalAddress` is set. */
  fromTokenAddress?: string | null;
  /** Atomic units to approve, as a decimal string. */
  fromAmountAtomic?: string | null;
}

export interface GuardOptions {
  /**
   * Require an expiry and enforce it. Default true.
   *
   * Turn it off only for flows with no price attached — a plain ETH transfer
   * does not go stale the way a swap quote does.
   */
  requireFreshness?: boolean;
  now?: number;
}

/**
 * Throws unless `plan` is safe to sign for `expectedChainId`.
 *
 * Takes a chain ID, not a name. A library that ships its own network registry
 * goes stale the first time a consumer adds an L2 — the caller knows which
 * chain the user picked, and that is the only source that can be right.
 *
 * @throws GuardRejection
 */
export function assertSignable(
  plan: TransactionPlan,
  expectedChainId: number,
  options: GuardOptions = {}
): void {
  const { requireFreshness = true, now = Date.now() } = options;

  if (!isChainId(expectedChainId)) {
    throw new GuardRejection("unsupported_chain", `Not a valid chain id: ${expectedChainId}`);
  }

  const tx = plan?.transactionRequest;
  if (!tx || typeof tx !== "object") {
    throw new GuardRejection("no_transaction", "This route came back without a transaction.");
  }

  // The one that matters most, checked first. Same address on every EVM chain
  // means a chain-mismatched signature is not rejected anywhere downstream —
  // it is simply valid on the wrong network.
  if (!isBoundToChain(tx.chainId, expectedChainId)) {
    throw new GuardRejection(
      "chain_mismatch",
      `This transaction is for chain ${tx.chainId}, not ${expectedChainId}. Nothing was signed.`
    );
  }

  if (!isNonZeroAddress(tx.to)) {
    throw new GuardRejection("bad_target", "The destination address is invalid.");
  }
  // A swap or approval is always a contract call. Empty calldata to a router
  // does nothing and burns the gas anyway.
  if (!hasCalldata(tx.data)) {
    throw new GuardRejection("no_calldata", "This route came back without transaction data.");
  }
  if (!isQuantity(tx.value)) {
    throw new GuardRejection("bad_value", "The transaction's value field is malformed.");
  }
  if (tx.gasLimit !== undefined) {
    const gas = parseQuantity(tx.gasLimit);
    if (gas === null || gas === 0n) {
      throw new GuardRejection("bad_gas_limit", "The transaction's gas limit is invalid.");
    }
  }

  if (plan.approvalAddress !== undefined && plan.approvalAddress !== null) {
    if (!isNonZeroAddress(plan.approvalAddress)) {
      throw new GuardRejection("bad_spender", "The approval spender address is invalid.");
    }
    if (!isNonZeroAddress(plan.fromTokenAddress)) {
      throw new GuardRejection("bad_token", "This route needs an approval but didn't name a token.");
    }
    const amount = parseAtomic(plan.fromAmountAtomic);
    if (amount === null) {
      throw new GuardRejection("bad_amount", "The approval amount is invalid.");
    }
    if (amount === 0n) {
      throw new GuardRejection("bad_amount", "This route wants a zero-value approval.");
    }
  }

  if (requireFreshness) assertFresh(plan, now);
}

/** EIP-1559 fee fields, in wei. */
export interface FeeFields {
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  value?: bigint;
  nonce?: bigint;
}

/**
 * Throws unless the computed fee caps are internally consistent.
 *
 * Separate from `assertSignable` because these are derived from live chain
 * state after the plan is validated, not supplied with it.
 *
 * @throws GuardRejection
 */
export function assertFeesSane(fees: FeeFields): void {
  if (fees.gasLimit <= 0n) {
    throw new GuardRejection("bad_gas_limit", "Couldn't estimate gas for this transaction.");
  }
  if (fees.maxFeePerGas <= 0n) {
    throw new GuardRejection("bad_fees", "Couldn't read a gas price for this network.");
  }
  // Every node rejects a tip above the cap. Better to say so than to spend the
  // user's confirmation on a transaction that cannot be accepted.
  if (fees.maxPriorityFeePerGas > fees.maxFeePerGas) {
    throw new GuardRejection("bad_fees", "This network reported an inconsistent gas price.");
  }
  if ((fees.value ?? 0n) < 0n || (fees.nonce ?? 0n) < 0n) {
    throw new GuardRejection("bad_transaction", "The transaction is malformed.");
  }
}

/**
 * Worst-case cost in wei: `value + gasLimit × maxFeePerGas`.
 *
 * Uses the fee CAP rather than the expected price, so a balance check against
 * it cannot pass optimistically and then revert out-of-funds after the user has
 * already authorised — and paid for — the attempt.
 */
export function maximumCostWei(fees: FeeFields): bigint {
  return (fees.value ?? 0n) + fees.gasLimit * fees.maxFeePerGas;
}
