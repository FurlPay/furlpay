import { verifyUsdcPayment } from "@/lib/travel/settlementProof";
import { getRampOrder, updateRampOrderStatus, type RampOrder } from "./rampOrder";

// ---------------------------------------------------------------------------
// Hosted on-ramp completion, proven on-chain by FurlPay.
//
// A provider saying "COMPLETED" with a tx hash moves an order to
// CRYPTO_PENDING and no further. This checks that hash ourselves: a USDC
// Transfer to the order's destination wallet, of at least the amount the
// provider reported, at the confirmation depth the verifier requires. Only then
// CRYPTO_CONFIRMED → COMPLETED (hosted_checkout's COMPLETED evidence is the
// chain tx hash, lib/money/lifecycle.ts FLOW_EVIDENCE).
//
// Not enough confirmations yet is not a failure: the order stays at
// CRYPTO_PENDING and the next webhook or GET retries. A transfer that does not
// match goes to MANUAL_REVIEW — the provider and the chain disagree, and a
// person decides.
// ---------------------------------------------------------------------------

export type DeliveryCheck =
  | { status: "confirmed"; order: RampOrder }
  | { status: "pending"; detail: string }
  | { status: "mismatch"; order: RampOrder; detail: string }
  | { status: "not_applicable"; detail: string };

/** USDC decimal string → 6-decimal atomic string, refusing anything malformed. */
export function usdcAtomic(amount: string): string | null {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(amount.trim());
  if (!m) return null;
  return (BigInt(m[1]) * 1_000_000n + BigInt((m[2] ?? "").padEnd(6, "0"))).toString();
}

export async function confirmDeliveryOnChain(orderId: string): Promise<DeliveryCheck> {
  const order = await getRampOrder(orderId);
  if (!order || order.status !== "CRYPTO_PENDING" || order.direction !== "onramp" || order.flowKind !== "hosted_checkout") {
    return { status: "not_applicable", detail: "Order is not awaiting on-chain delivery." };
  }
  if (order.cryptoAsset !== "USDC") {
    return { status: "not_applicable", detail: `No on-chain verifier for ${order.cryptoAsset}.` };
  }
  const txHash = order.refs.chainTxHash;
  const expectedAtomic = order.cryptoAmount ? usdcAtomic(order.cryptoAmount) : null;
  if (!txHash || !order.destinationAddress || !expectedAtomic) {
    const updated = await updateRampOrderStatus(orderId, {
      to: "MANUAL_REVIEW",
      trigger: "system",
      evidence: "Delivery cannot be checked: missing tx hash, destination or amount.",
    });
    return { status: "mismatch", order: updated, detail: "missing delivery evidence" };
  }

  const proof = await verifyUsdcPayment({
    txHash,
    network: order.chain,
    expectedTo: order.destinationAddress,
    expectedAtomic,
  });

  if (proof.ok) {
    await updateRampOrderStatus(orderId, {
      to: "CRYPTO_CONFIRMED",
      trigger: "system",
      evidence: `USDC transfer verified on ${proof.network}: ${proof.confirmations}/${proof.requiredConfirmations} confirmations.`,
    });
    const done = await updateRampOrderStatus(orderId, {
      to: "COMPLETED",
      trigger: "system",
      evidence: `Delivery ${txHash} verified on-chain by FurlPay.`,
    });
    return { status: "confirmed", order: done };
  }

  if (proof.reason === "insufficient_confirmations" || proof.reason === "rpc_unavailable" || proof.reason === "tx_not_found") {
    // Retryable: not deep enough, RPC down, or not yet indexed.
    return { status: "pending", detail: proof.detail };
  }

  const updated = await updateRampOrderStatus(orderId, {
    to: "MANUAL_REVIEW",
    trigger: "system",
    evidence: `Provider-reported delivery did not verify: ${proof.reason}.`,
  });
  return { status: "mismatch", order: updated, detail: proof.detail };
}
