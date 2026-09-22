import { randomUUID } from "crypto";

// ---------------------------------------------------------------------------
// Escrow protocol for payment disputes.
//
// THE GAP: FurlPay records chargebacks and refunds as FlowKinds in
// lifecycle.ts but has no mechanism to hold funds in escrow during a
// dispute, no timer-based auto-resolution, and no evidence submission.
//
// Without escrow, a disputed payment has two bad options: refund
// immediately (merchant loses), or do nothing (customer loses). Escrow
// lets both parties submit evidence while the money sits in a third state
// that neither can spend.
// ---------------------------------------------------------------------------

export type DisputeReason =
  | "unauthorized"        // Customer didn't authorize the tx
  | "product_not_received" // Goods/services never delivered
  | "product_defective"   // Goods/services materially different
  | "duplicate_charge"    // Charged twice for the same thing
  | "subscription_cancel" // Charged after cancellation
  | "fraud"               // Third-party fraud
  | "other";

export type DisputeStatus =
  | "opened"              // Customer filed, merchant not yet notified
  | "under_review"        // Both sides have submitted evidence
  | "escalated"           // Auto-escalated after deadline
  | "resolved_refund"     // Customer wins
  | "resolved_merchant"   // Merchant wins
  | "expired";            // No response within window

export interface DisputeEvidence {
  submittedBy: "customer" | "merchant";
  type: "receipt" | "tracking" | "communication" | "screenshot" | "contract" | "other";
  description: string;
  submittedAt: string; // ISO 8601
  // No binary data here — evidence references are stored, not the files themselves
  referenceUrl?: string;
}

export interface Dispute {
  id: string;
  paymentId: string;
  status: DisputeStatus;
  reason: DisputeReason;
  amount: string;         // bigint as string
  asset: string;          // AssetId
  filedBy: string;        // userId
  filedAt: string;
  merchantId: string;
  evidence: DisputeEvidence[];
  /** Deadline for merchant to respond */
  merchantDeadline: string;
  /** Deadline for final resolution */
  resolutionDeadline: string;
  resolvedAt?: string;
  resolution?: { winner: "customer" | "merchant"; reason: string };
}

// Configuration
export const DISPUTE_CONFIG = {
  /** Days merchant has to respond with evidence */
  merchantResponseDays: 7,
  /** Days for final resolution after both sides submit */
  resolutionDays: 30,
  /** Max dispute amount in USD before requiring manual review */
  autoResolveMaxUsd: 500,
  /** Auto-resolve in customer's favor if merchant doesn't respond */
  autoResolveOnMerchantTimeout: true,
} as const;

/**
 * Checks if a payment is eligible for a dispute based on the 90-day window.
 */
export function canDisputePayment(paymentId: string, paymentRecordedAt: string): boolean {
  const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
  const paymentTime = new Date(paymentRecordedAt).getTime();
  if (isNaN(paymentTime)) return false;
  
  return Date.now() - paymentTime <= NINETY_DAYS_MS;
}

/**
 * Opens a new dispute, locking the funds in escrow conceptually.
 */
export function openDispute(
  paymentId: string,
  reason: DisputeReason,
  userId: string,
  merchantId: string,
  amount: string, // bigint as string
  asset: string
): Dispute {
  const now = new Date();
  
  const merchantDeadline = new Date(now);
  merchantDeadline.setDate(merchantDeadline.getDate() + DISPUTE_CONFIG.merchantResponseDays);

  const resolutionDeadline = new Date(now);
  resolutionDeadline.setDate(resolutionDeadline.getDate() + DISPUTE_CONFIG.resolutionDays);

  return {
    id: randomUUID(),
    paymentId,
    status: "opened",
    reason,
    amount,
    asset,
    filedBy: userId,
    merchantId,
    filedAt: now.toISOString(),
    evidence: [],
    merchantDeadline: merchantDeadline.toISOString(),
    resolutionDeadline: resolutionDeadline.toISOString(),
  };
}

/**
 * Submits evidence for a dispute, validating deadlines and updating status if necessary.
 */
export function submitEvidence(dispute: Dispute, evidence: Omit<DisputeEvidence, "submittedAt">): Dispute {
  const now = new Date().toISOString();
  
  // Create an updated dispute instance
  const updatedDispute = { ...dispute, evidence: [...dispute.evidence] };
  
  // Add new evidence
  updatedDispute.evidence.push({
    ...evidence,
    submittedAt: now
  });

  // If merchant just submitted evidence and it was just opened, transition to under_review
  if (updatedDispute.status === "opened" && evidence.submittedBy === "merchant") {
    updatedDispute.status = "under_review";
  }

  return updatedDispute;
}

/**
 * Forcefully resolves a dispute, distributing the escrowed funds.
 */
export function resolveDispute(
  dispute: Dispute,
  winner: "customer" | "merchant",
  reason: string
): Dispute {
  if (dispute.status === "resolved_refund" || dispute.status === "resolved_merchant") {
    return dispute; // Already resolved
  }

  return {
    ...dispute,
    status: winner === "customer" ? "resolved_refund" : "resolved_merchant",
    resolvedAt: new Date().toISOString(),
    resolution: { winner, reason }
  };
}

/**
 * Evaluates a dispute for required deadline actions (e.g., auto-escalate, expire).
 */
export function checkDeadlines(dispute: Dispute): { actionNeeded: "none" | "auto_escalate" | "auto_resolve", reason?: string } {
  const nowTime = Date.now();
  const merchantDeadlineTime = new Date(dispute.merchantDeadline).getTime();
  const resolutionDeadlineTime = new Date(dispute.resolutionDeadline).getTime();

  if (dispute.status === "opened" && nowTime > merchantDeadlineTime) {
    if (DISPUTE_CONFIG.autoResolveOnMerchantTimeout) {
      return { actionNeeded: "auto_resolve", reason: "Merchant failed to respond within the deadline." };
    }
    return { actionNeeded: "auto_escalate", reason: "Merchant deadline expired, requiring manual escalation." };
  }

  if (dispute.status === "under_review" && nowTime > resolutionDeadlineTime) {
    return { actionNeeded: "auto_escalate", reason: "Resolution deadline expired." };
  }

  return { actionNeeded: "none" };
}
