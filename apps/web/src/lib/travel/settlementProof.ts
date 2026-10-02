import { createPublicClient, getAddress, keccak256, toHex, type Hex, type Address } from "viem";
import { EVM_CHAINS, rpcTransport } from "@/lib/x402Chains";
import { requiredConfirmations } from "@/lib/x402";
import { USDC_ADDRESS, type UsdcChain } from "@/lib/services/usdcBalances";
import { ARC_USDC_ERC20, arcCreditableTransfers } from "@/lib/chains/arc";
import { log } from "@/lib/log";

// ---------------------------------------------------------------------------
// On-chain payment proof verification for travel settlement.
//
// WHAT THIS EXISTS TO PREVENT
// `/api/travel/settle` previously returned `{ verified: true }` having checked
// nothing at all — no hash, no amount, no recipient. Any authenticated caller
// could confirm any of their own bookings for free. This module is the actual
// check that claim was asserting.
//
// FOUR THINGS MUST ALL HOLD. Dropping any one of them makes the proof
// worthless, and the first is the one most implementations miss:
//
//   1. THE LOG CAME FROM THE REAL USDC CONTRACT.
//      A Transfer event is just an event. Anyone can deploy a token, mint
//      themselves a billion units, send them to our address, and produce a
//      receipt containing a perfectly valid Transfer log for the right amount
//      to the right recipient. Verifying the event without pinning
//      `log.address` to the canonical USDC contract for that chain accepts
//      worthless tokens as payment. This is checked FIRST.
//
//   2. The recipient is OUR address, not merely "an" address.
//
//   3. The value is at least what the booking costs. Compared in atomic
//      integers via BigInt — never a float, and never `===` on a formatted
//      string.
//
//   4. The transaction has the confirmation depth the AMOUNT requires
//      (lib/x402.ts::requiredConfirmations). An L2 can reorg; issuing an
//      irreversible airline ticket against a zero-confirmation transfer means
//      paying the airline for a payment that can still disappear.
//
// A transaction may contain MANY Transfer logs (a swap, a batch, an aggregator
// route). We scan all of them and accept if ANY single log satisfies 1-3.
// Summing multiple logs would be wrong: two unrelated transfers of $50 do not
// constitute payment of a $100 booking by this payer.
// ---------------------------------------------------------------------------

/** keccak256("Transfer(address,address,uint256)") — the ERC-20 Transfer topic. */
export const ERC20_TRANSFER_TOPIC = keccak256(toHex("Transfer(address,address,uint256)"));

export type ProofFailureReason =
  | "malformed_tx_hash"
  | "unsupported_network"
  | "tx_not_found"
  | "tx_reverted"
  | "no_matching_transfer"
  | "payer_mismatch"
  | "insufficient_confirmations"
  | "rpc_unavailable";

export type ProofResult =
  | {
      ok: true;
      txHash: string;
      network: string;
      /** Atomic units actually transferred in the matching log. */
      paidAtomic: string;
      confirmations: number;
      requiredConfirmations: number;
    }
  | {
      ok: false;
      reason: ProofFailureReason;
      detail: string;
      /** Present when the tx exists but is not yet deep enough — retryable. */
      confirmations?: number;
      requiredConfirmations?: number;
    };

export interface VerifyPaymentParams {
  txHash: string;
  /** Chain slug, e.g. "base" | "arbitrum". */
  network: string;
  /** Address the funds must have landed in. */
  expectedTo: string;
  /** Minimum atomic USDC units required (6 decimals). Decimal string. */
  expectedAtomic: string;
  /**
   * The address the funds must have come FROM. Without it, a payment is not
   * bound to its payer: anyone who sees a transfer to our address on-chain can
   * submit that hash first and spend someone else's payment, and the real
   * payer's own submission then fails as "already used".
   */
  expectedFrom?: string;
}

/** Decode a 32-byte indexed address topic into a checksummed address. */
function topicToAddress(topic: Hex): Address | null {
  // An indexed address is left-padded to 32 bytes: 0x + 24 zeros + 40 hex.
  if (!/^0x[0-9a-fA-F]{64}$/.test(topic)) return null;
  try {
    return getAddress(`0x${topic.slice(26)}`);
  } catch {
    return null;
  }
}

/**
 * Verify that `txHash` contains a real USDC transfer of at least
 * `expectedAtomic` to `expectedTo`, confirmed to the depth the amount requires.
 *
 * Read-only: needs an RPC, never the fee-payer key. Every negative outcome is
 * a typed reason rather than a bare false, because "not found yet" and
 * "reverted" demand opposite responses — one is retryable, the other final.
 */
export async function verifyUsdcPayment(params: VerifyPaymentParams): Promise<ProofResult> {
  const { txHash, network, expectedTo, expectedAtomic, expectedFrom } = params;

  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return { ok: false, reason: "malformed_tx_hash", detail: "Transaction hash must be 0x + 64 hex characters." };
  }

  const chain = EVM_CHAINS[network];
  const isArc = network === "arc" || network === "arc-testnet";
  const usdc = isArc ? ARC_USDC_ERC20 : USDC_ADDRESS[network as UsdcChain];
  if (!chain || !usdc || network === "solana") {
    return {
      ok: false,
      reason: "unsupported_network",
      detail: `No EVM USDC verifier for network "${network}".`,
    };
  }

  let expectedValue: bigint;
  let expectedRecipient: Address;
  try {
    expectedValue = BigInt(expectedAtomic);
    expectedRecipient = getAddress(expectedTo);
  } catch {
    return { ok: false, reason: "no_matching_transfer", detail: "Expected amount or recipient is malformed." };
  }
  if (expectedValue <= 0n) {
    return { ok: false, reason: "no_matching_transfer", detail: "Expected amount must be positive." };
  }
  let expectedPayer: Address | null = null;
  if (expectedFrom !== undefined) {
    try {
      expectedPayer = getAddress(expectedFrom);
    } catch {
      return { ok: false, reason: "payer_mismatch", detail: "Expected payer address is malformed." };
    }
  }
  const PAYER_MISMATCH: ProofResult = {
    ok: false,
    reason: "payer_mismatch",
    detail: "A matching USDC transfer exists, but it was not sent from your linked wallet.",
  };

  const client = createPublicClient({ chain, transport: rpcTransport(network) });

  let receipt;
  let confirmations: number;
  try {
    receipt = await client.getTransactionReceipt({ hash: txHash as Hex });
    confirmations = Number(await client.getTransactionConfirmations({ hash: txHash as Hex }));
  } catch (e) {
    // Absence is NOT proof of failure — the tx may still be in the mempool.
    // Reported as retryable so a caller polls rather than failing the booking.
    log.warn("travel settlement proof: receipt lookup failed", {
      txHash,
      network,
      error: (e as Error).message,
    });
    return {
      ok: false,
      reason: "tx_not_found",
      detail: "Transaction not found on-chain yet. It may still be pending.",
    };
  }

  if (receipt.status !== "success") {
    return { ok: false, reason: "tx_reverted", detail: "The transaction reverted on-chain." };
  }

  if (isArc) {
    // Arc implements EIP-7708: native sends emit Transfer from ARC_SYSTEM_EMITTER (18dp),
    // while ERC-20 calls emit from ARC_USDC_ERC20 (6dp).
    // arcCreditableTransfers handles deduplication, normalization to 6dp, and dust tracking.
    const transfers = arcCreditableTransfers(receipt.logs as any);
    const paysUs = (t: (typeof transfers)[number]) => {
      try {
        return getAddress(t.to) === expectedRecipient && t.erc20Value >= expectedValue;
      } catch {
        return false;
      }
    };
    const fromPayer = (t: (typeof transfers)[number]) => {
      if (!expectedPayer) return true;
      try {
        return getAddress(t.from) === expectedPayer;
      } catch {
        return false;
      }
    };
    const match = transfers.find((t) => paysUs(t) && fromPayer(t));

    if (!match && expectedPayer && transfers.some(paysUs)) return PAYER_MISMATCH;
    if (!match) {
      return {
        ok: false,
        reason: "no_matching_transfer",
        detail: "No USDC transfer of the required amount to the expected address was found in this transaction.",
      };
    }

    // Arc finalises deterministically ON INCLUSION, so the depth requirement is
    // 1 rather than the amount-scaled ladder the other chains use — waiting
    // longer buys no safety on a chain with no reorg window.
    //
    // 1 IS STILL CHECKED, THOUGH. This branch previously returned ok:true while
    // reporting requiredConfirmations: 1 without ever comparing against it,
    // which meant it could answer "proven, confirmations: 0, required: 1" — a
    // result that contradicts itself, and the one shape a caller has no way to
    // interpret. The non-Arc path below gates on its own requirement; this now
    // does the same, so `requiredConfirmations` describes an enforced condition
    // on every path rather than an aspiration on one of them.
    //
    // It is not merely cosmetic: a receipt can be served by an RPC whose head
    // has not caught up, and 0 confirmations means the transaction is not yet in
    // a block this node considers canonical. Arc's finality guarantee applies to
    // an included transaction — it is not a licence to skip checking inclusion.
    const ARC_REQUIRED_CONFIRMATIONS = 1;
    if (confirmations < ARC_REQUIRED_CONFIRMATIONS) {
      return {
        ok: false,
        reason: "insufficient_confirmations",
        detail: `Transaction has ${confirmations} of ${ARC_REQUIRED_CONFIRMATIONS} required confirmations.`,
        confirmations,
        requiredConfirmations: ARC_REQUIRED_CONFIRMATIONS,
      };
    }

    return {
      ok: true,
      txHash,
      network,
      // The 6dp figure, which is what the rest of the system means by "atomic
      // USDC". `match.dust` holds the sub-6dp remainder the ERC-20 view cannot
      // express; it is deliberately not added here, because a payment record
      // must state an amount the ERC-20 interface could actually move. The dust
      // is always in the payer's favour (we received marginally more than we
      // record), so recording the truncated figure never over-credits.
      paidAtomic: match.erc20Value.toString(),
      confirmations,
      requiredConfirmations: ARC_REQUIRED_CONFIRMATIONS,
    };
  }

  const usdcAddress = getAddress(usdc);

  const paysUs = (entry: (typeof receipt.logs)[number]) => {
    // (1) THE CONTRACT. Checked before anything else — a Transfer log from a
    // token we did not name is not a payment, however well-formed it looks.
    let emitter: Address;
    try {
      emitter = getAddress(entry.address);
    } catch {
      return false;
    }
    if (emitter !== usdcAddress) return false;

    if (entry.topics[0] !== ERC20_TRANSFER_TOPIC) return false;
    // topics: [signature, from, to]; a non-standard log missing `to` is not a
    // transfer we can attribute.
    if (entry.topics.length < 3) return false;

    // (2) THE RECIPIENT.
    const to = topicToAddress(entry.topics[2] as Hex);
    if (!to || to !== expectedRecipient) return false;

    // (3) THE AMOUNT, in atomic integers.
    let value: bigint;
    try {
      value = BigInt(entry.data);
    } catch {
      return false;
    }
    return value >= expectedValue;
  };
  // (5) THE PAYER, when one is required: topics[1] is the sender.
  const fromPayer = (entry: (typeof receipt.logs)[number]) =>
    !expectedPayer || topicToAddress(entry.topics[1] as Hex) === expectedPayer;
  const match = receipt.logs.find((entry) => paysUs(entry) && fromPayer(entry));

  if (!match && expectedPayer && receipt.logs.some(paysUs)) return PAYER_MISMATCH;
  if (!match) {
    return {
      ok: false,
      reason: "no_matching_transfer",
      detail: "No USDC transfer of the required amount to the expected address was found in this transaction.",
    };
  }

  // (4) THE DEPTH.
  const needed = requiredConfirmations(expectedAtomic);
  if (confirmations < needed) {
    return {
      ok: false,
      reason: "insufficient_confirmations",
      detail: `Transaction has ${confirmations} of ${needed} required confirmations.`,
      confirmations,
      requiredConfirmations: needed,
    };
  }

  return {
    ok: true,
    txHash,
    network,
    paidAtomic: BigInt(match.data).toString(),
    confirmations,
    requiredConfirmations: needed,
  };
}

/** Convert a USD amount to atomic USDC units without float drift. */
export function usdToAtomicUsdc(amountUsd: number): string {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    throw new Error(`amountUsd must be a positive finite number, got ${amountUsd}`);
  }
  // Round to cents FIRST, then scale by the remaining 10^4. Doing
  // `amountUsd * 1e6` directly turns 420.07 into 420069999.99999994, which
  // floors to one atomic unit short and fails an exact-amount comparison.
  const cents = Math.round(amountUsd * 100);
  return (BigInt(cents) * 10_000n).toString();
}
