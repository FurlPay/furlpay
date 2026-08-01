// ---------------------------------------------------------------------------
// Chain binding.
//
// THE FAILURE THIS PREVENTS. The same address exists on every EVM chain. A
// transaction built for chain A but signed while the user believes they are on
// chain B is not a rejected transaction — it is a VALID, broadcastable
// transaction on A, spendable against whatever balance the user holds there.
//
// Nothing downstream catches it. The signature is correct, the address is
// correct, the nonce is plausible, and the wallet has no reason to complain.
// The only place to catch it is before signing, by comparing the transaction's
// declared chainId against the chain the user actually chose.
//
// This module is deliberately chain-agnostic: no built-in registry of networks,
// no hardcoded list. A library that ships its own chain table goes stale the
// first time a consumer adds an L2, and then has to be republished for someone
// else's roadmap.
// ---------------------------------------------------------------------------

/**
 * Confirmations before a receipt should be treated as final.
 *
 * One confirmation is a probability, not a fact, and the probability differs
 * enormously by chain — so a single global default is wrong somewhere by
 * construction. These are conservative starting points, not guarantees:
 * Ethereum L1 reorgs of one or two blocks are routine; rollups with a single
 * sequencer are settled at one for practical purposes.
 *
 * Exported as a suggestion. Consumers should override per their risk appetite.
 */
export const SUGGESTED_CONFIRMATIONS: Record<number, number> = {
  1: 3, // Ethereum mainnet
  137: 2, // Polygon PoS — historically deeper reorgs than the rollups
  42161: 1, // Arbitrum One
  8453: 1, // Base
  10: 1, // OP Mainnet
};

/** Confirmations to wait for on `chainId`, falling back to a safe default. */
export function confirmationsFor(chainId: number, fallback = 2): number {
  return SUGGESTED_CONFIRMATIONS[chainId] ?? fallback;
}

/** A plausible EVM chain id: a positive, safe integer. */
export function isChainId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/**
 * True when a transaction is bound to the chain the user chose.
 *
 * Both arguments are required and neither has a default — a signature that
 * defaults to "probably mainnet" is exactly the bug this file exists to stop.
 */
export function isBoundToChain(txChainId: unknown, expectedChainId: unknown): boolean {
  return isChainId(txChainId) && isChainId(expectedChainId) && txChainId === expectedChainId;
}
