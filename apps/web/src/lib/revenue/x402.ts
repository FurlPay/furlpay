import { log } from "@/lib/log";
import { recordRevenue, minor } from "./record";

// ---------------------------------------------------------------------------
// x402 revenue.
//
// ── WHAT IS AND IS NOT OURS ────────────────────────────────────────────────
//
// FurlPay's x402 surface does two different jobs, and only one of them earns:
//
//   1. It SELLS its own priced resources. The payment goes to FurlPay's
//      treasury (PAY_TO) and the whole amount is ours.
//   2. It FACILITATES third-party resources registered by other hosts. Those
//      carry the registrant's own payTo, and the money is theirs. FurlPay
//      currently takes no cut of those.
//
// So the test is `payTo === PAY_TO`. Recording a facilitated payment as
// revenue would book someone else's income as ours — the same class of error
// as reporting TPV as revenue, and harder to spot because the number looks
// plausible.
//
// ── WHY THE WHOLE AMOUNT IS `fee` AND `volume` IS NULL ─────────────────────
//
// This is a sale, not a take. FurlPay is not skimming a percentage of a flow
// passing through it; it is selling an API call for $0.01 and keeping $0.01.
// Giving it a volume equal to its fee would report a 100% take rate and drag
// the blended rate for every genuine transaction engine upward.
//
// ── ONLY CONFIRMED SETTLEMENTS ─────────────────────────────────────────────
//
// A "pending" settlement is a submitted transaction that may still be replaced
// or abandoned. It is not money, and it is not recorded — the caller books
// revenue when depth is observed, which is the same evidence standard the rest
// of the money layer uses.
// ---------------------------------------------------------------------------

/** USDC asset id per settlement network. x402 settles in 6-decimal USDC. */
const USDC_BY_NETWORK: Record<string, string> = {
  ethereum: "USDC.ethereum",
  arbitrum: "USDC.arbitrum",
  base: "USDC.base",
  polygon: "USDC.polygon",
  solana: "USDC.solana",
  tempo: "USDC.tempo",
};

export interface X402RevenueInput {
  /** On-chain transaction hash — the idempotency anchor. */
  transaction: string;
  network: string;
  /** Recipient on the settlement. Compared against FurlPay's treasury. */
  payTo: string;
  /** FurlPay's treasury address for this deployment. */
  treasury: string;
  /** Amount in the asset's minor units, as the protocol reports it. */
  amountAtomic: string;
  /** The resource that was paid for. */
  resource: string;
  payer?: string;
}

/**
 * Record a confirmed x402 payment as API revenue, when it was paid to us.
 *
 * Returns false without recording when the payment belongs to a third-party
 * registrant, when the network is unknown, or when the amount is not a
 * positive integer. Never throws: this runs immediately after a settlement
 * that has already happened on-chain, and a reporting failure must not turn a
 * completed payment into an error response.
 */
export async function recordX402Revenue(input: X402RevenueInput): Promise<boolean> {
  // Not ours — a facilitated resource belonging to another host.
  if (input.payTo.toLowerCase() !== input.treasury.toLowerCase()) return false;

  const assetId = USDC_BY_NETWORK[input.network];
  if (!assetId) {
    log.warn("x402 revenue skipped: unknown settlement network", { network: input.network });
    return false;
  }

  let amount: bigint;
  try {
    amount = BigInt(input.amountAtomic);
  } catch {
    log.warn("x402 revenue skipped: non-integer amount", { amount: input.amountAtomic });
    return false;
  }
  if (amount <= 0n) return false;

  try {
    await recordRevenue({
      source: "x402_payment",
      status: "realized",
      externalRef: input.transaction,
      fee: minor(amount, assetId),
      // No volume: a sale, not a take. See the note above.
      volume: null,
      userId: null, // x402 payers are wallets, not FurlPay accounts.
      chain: input.network,
      metadata: {
        resource: input.resource,
        payer: input.payer ?? null,
        network: input.network,
      },
    });
    return true;
  } catch (e) {
    log.error("x402 revenue not recorded", {
      transaction: input.transaction,
      error: (e as Error).message,
    });
    return false;
  }
}
