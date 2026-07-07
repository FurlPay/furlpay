import crypto from "crypto";
import { screenAddress } from "./compliance";
import { getChain, gasQuote } from "./chainRegistry";
import { newTx, recordTransaction } from "@/lib/store";
import { sendEmail } from "@/lib/email";

// ---------------------------------------------------------------------------
// Unified USDC payment service — the chain-native counterpart to the Stripe
// intent flow. Accepts USDC from any supported chain, settles on Arbitrum One
// via FurlPayRouter, charges the 0.5% platform fee (vs 1.5-3.5% card
// interchange). Every payment is OFAC-screened before execution.
//
// Flow: create (quote + EIP-712 sign data) → execute (signature → settle) →
// receipt (tx hash + explorer link). Refund reverses a settled payment.
//
// LIVE: FurlPayRouter.pay() via a relayer/paymaster on Arbitrum One.
// MOCK: deterministic settlement hashes, no RPC (default).
// ---------------------------------------------------------------------------

export const FEE_RATE = 0.005; // 0.5%
const EXPIRY_SECONDS = 900; // 15 min quote validity
const SETTLEMENT_CHAIN = "arbitrum";
const USDC_DECIMALS = 6;

// Human-in-the-loop (HITL) compliance gateway. A payment that clears sanctions
// screening but crosses a regulatory threshold (large value, elevated risk, or
// a high-risk jurisdiction) is PAUSED for a human compliance officer to approve
// or reject before it settles on-chain — the boundary the analysis calls out:
// agents research/flag, humans make the filing/approval decision.
const HITL_THRESHOLD_USD = Number(process.env.FURLPAY_HITL_THRESHOLD_USD || 3000);
const HIGH_RISK_JURISDICTIONS = new Set(
  (process.env.FURLPAY_HIGH_RISK_JURISDICTIONS || "IR,KP,SY,CU,RU")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean)
);

export type PaymentStatus =
  | "pending_signature"
  | "pending_review"
  | "settled"
  | "refunded"
  | "expired"
  | "blocked";

export interface PaymentRecord {
  id: string;
  status: PaymentStatus;
  amountUsdc: number;
  feeUsdc: number;
  sourceChain: string;
  settlementChain: string;
  recipient: string;
  payer?: string;
  metadata?: Record<string, string>;
  nonce: string;
  idempotencyKey?: string;
  createdAt: string;
  expiresAt: string;
  settledAt?: string;
  refundedAt?: string;
  transactionHash?: string;
  refundTransactionHash?: string;
  blockedReason?: string;
  // HITL compliance review
  reviewReason?: string;
  reviewRequestedAt?: string;
  reviewedAt?: string;
  reviewedBy?: string;
}

// In-memory store (production: Postgres). Survives hot-reload via globalThis.
const g = globalThis as unknown as {
  __furlpayPayments?: Map<string, PaymentRecord>;
  __furlpayIdem?: Map<string, string>;
};
const payments = g.__furlpayPayments ?? (g.__furlpayPayments = new Map());
// Idempotency-Key → paymentId. Under retry storms (an agent resubmits after a
// dropped receipt, or parallel sub-agents share a coordinated key) the same key
// must resolve to the same payment intent instead of minting a duplicate
// charge. Key = a client-supplied Idempotency-Key header; a well-behaved agent
// derives it deterministically, e.g. hash(merchant‖session‖value‖nonce).
const idempotency = g.__furlpayIdem ?? (g.__furlpayIdem = new Map());

export function getPayment(id: string): PaymentRecord | undefined {
  const p = payments.get(id);
  if (p && p.status === "pending_signature" && Date.parse(p.expiresAt) < Date.now()) {
    p.status = "expired";
  }
  return p;
}

export function listPayments(limit = 50): PaymentRecord[] {
  return [...payments.values()]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, limit);
}

export interface CreateParams {
  amount: number;
  sourceChain: string;
  recipient: string;
  metadata?: Record<string, string>;
  /** Idempotency-Key: a retry with the same key returns the same intent. */
  idempotencyKey?: string;
}

/** Build the create-intent response (quote + EIP-712 sign data) for a record. */
async function buildCreateResponse(record: PaymentRecord, replayed: boolean) {
  const chain = getChain(SETTLEMENT_CHAIN)!;
  const router = process.env.FURLPAY_ROUTER_ADDRESS || "0xFurlPayRouterPendingDeployment";
  const gas = await gasQuote(chain);
  return {
    record,
    replayed,
    gasEstimateUsd: gas.transferCostUsd,
    contract: router,
    chainId: chain.chainId,
    // EIP-712 typed data the payer's wallet signs (verified on-chain by
    // FurlPayRouter; the nonce makes each authorization single-use).
    signData: {
      domain: { name: "FurlPayRouter", version: "1", chainId: chain.chainId, verifyingContract: router },
      types: {
        Payment: [
          { name: "paymentId", type: "string" },
          { name: "recipient", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "fee", type: "uint256" },
          { name: "nonce", type: "bytes32" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "Payment",
      message: {
        paymentId: record.id,
        recipient: record.recipient,
        amount: atomic(record.amountUsdc),
        fee: atomic(record.feeUsdc),
        nonce: record.nonce,
        deadline: Math.floor(Date.parse(record.expiresAt) / 1000),
      },
    },
  };
}

export async function createPayment(params: CreateParams) {
  // Idempotent replay: same key → same intent, so a dropped-receipt retry or a
  // fan-out of sub-agents sharing a key never mints a duplicate charge. Only a
  // fully expired-and-gone intent falls through to mint a fresh one.
  const key = params.idempotencyKey?.trim();
  if (key) {
    const existingId = idempotency.get(key);
    if (existingId) {
      const existing = getPayment(existingId);
      if (existing && existing.status !== "expired") {
        return buildCreateResponse(existing, true);
      }
    }
  }

  const fee = round(params.amount * FEE_RATE);
  const now = Date.now();
  const record: PaymentRecord = {
    id: `pay_${crypto.randomBytes(12).toString("hex")}`,
    status: "pending_signature",
    amountUsdc: params.amount,
    feeUsdc: fee,
    sourceChain: params.sourceChain,
    settlementChain: SETTLEMENT_CHAIN,
    recipient: params.recipient,
    metadata: params.metadata,
    nonce: "0x" + crypto.randomBytes(32).toString("hex"),
    idempotencyKey: key,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + EXPIRY_SECONDS * 1000).toISOString(),
  };
  payments.set(record.id, record);
  if (key) idempotency.set(key, record.id);

  return buildCreateResponse(record, false);
}

export interface ExecuteResult {
  ok: boolean;
  status: number;
  error?: string;
  record?: PaymentRecord;
  /** True when the payment is paused awaiting human compliance approval. */
  pending?: boolean;
  /** True when this response replays an already-settled payment (idempotent). */
  replayed?: boolean;
}

/** Does this payment need a human compliance officer before it can settle? */
function reviewReasonFor(
  record: PaymentRecord,
  payerScreen: ReturnType<typeof screenAddress>,
  recipientScreen: ReturnType<typeof screenAddress>
): string | null {
  if (record.amountUsdc >= HITL_THRESHOLD_USD) {
    return `amount_over_threshold_$${HITL_THRESHOLD_USD}`;
  }
  if (payerScreen.risk === "high" || recipientScreen.risk === "high") {
    return "elevated_counterparty_risk";
  }
  const jurisdiction = (record.metadata?.jurisdiction || "").trim().toUpperCase();
  if (jurisdiction && HIGH_RISK_JURISDICTIONS.has(jurisdiction)) {
    return `high_risk_jurisdiction_${jurisdiction}`;
  }
  return null;
}

/** Perform the on-chain settlement for a screened, approved payment. */
function settle(record: PaymentRecord): void {
  // MOCK settlement — LIVE: relayer submits the signed authorization to
  // FurlPayRouter.pay() and waits one Arbitrum confirmation (~250ms).
  record.transactionHash = "0x" + crypto.randomBytes(32).toString("hex");
  record.status = "settled";
  record.settledAt = new Date().toISOString();

  recordTransaction(
    newTx({
      category: "transfer",
      direction: "out",
      title: record.metadata?.description || `USDC payment to ${short(record.recipient)}`,
      subtitle: `FurlPayRouter · ${record.sourceChain} → arbitrum · fee $${record.feeUsdc.toFixed(2)}`,
      amountUsd: record.amountUsdc,
      token: "USDC",
      chain: "arbitrum",
      status: "settled",
    })
  );
}

/** Verify signature + screen both parties, then settle on Arbitrum One. */
export function executePayment(id: string, payer: string, signature: string): ExecuteResult {
  const record = getPayment(id);
  if (!record) return { ok: false, status: 404, error: "payment_not_found" };
  // Idempotent replay: a retry after a dropped receipt returns the original
  // outcome instead of erroring, so a retry storm never double-charges.
  if (record.status === "settled") return { ok: true, status: 200, record, replayed: true };
  if (record.status === "pending_review")
    return { ok: false, status: 202, error: "pending_human_review", record, pending: true };
  if (record.status === "expired") return { ok: false, status: 410, error: "payment_expired" };
  if (record.status !== "pending_signature")
    return { ok: false, status: 409, error: `payment_already_${record.status}` };
  if (!/^0x[0-9a-fA-F]{64,}$/.test(signature))
    return { ok: false, status: 400, error: "invalid_signature" };

  // OFAC screening on both legs before anything touches the chain.
  const screens: Record<"payer" | "recipient", ReturnType<typeof screenAddress>> = {
    payer: screenAddress(payer),
    recipient: screenAddress(record.recipient),
  };
  for (const [role, screen] of Object.entries(screens) as ["payer" | "recipient", ReturnType<typeof screenAddress>][]) {
    if (screen.sanctioned || screen.risk === "severe") {
      record.status = "blocked";
      record.blockedReason = `${role}_failed_sanctions_screen`;
      return { ok: false, status: 403, error: record.blockedReason, record };
    }
  }

  record.payer = payer;

  // HITL gateway: pause (don't settle) if the payment crosses a regulatory
  // threshold; a human must approvePayment() before funds move on-chain.
  const reviewReason = reviewReasonFor(record, screens.payer, screens.recipient);
  if (reviewReason) {
    record.status = "pending_review";
    record.reviewReason = reviewReason;
    record.reviewRequestedAt = new Date().toISOString();
    notifyReview(record);
    return { ok: false, status: 202, error: "pending_human_review", record, pending: true };
  }

  settle(record);
  return { ok: true, status: 200, record };
}

/** Approve a paused payment and settle it. Caller must be a human officer. */
export function approvePayment(id: string, approver: string): ExecuteResult {
  const record = getPayment(id);
  if (!record) return { ok: false, status: 404, error: "payment_not_found" };
  if (record.status === "settled") return { ok: true, status: 200, record, replayed: true };
  if (record.status !== "pending_review")
    return { ok: false, status: 409, error: `cannot_approve_${record.status}` };

  record.reviewedAt = new Date().toISOString();
  record.reviewedBy = approver;
  settle(record);
  return { ok: true, status: 200, record };
}

/** Reject a paused payment; it is blocked and can never settle. */
export function rejectPayment(id: string, approver: string, reason?: string): ExecuteResult {
  const record = getPayment(id);
  if (!record) return { ok: false, status: 404, error: "payment_not_found" };
  if (record.status !== "pending_review")
    return { ok: false, status: 409, error: `cannot_reject_${record.status}` };

  record.status = "blocked";
  record.blockedReason = reason ? `rejected_in_review: ${reason}` : "rejected_in_review";
  record.reviewedAt = new Date().toISOString();
  record.reviewedBy = approver;
  return { ok: true, status: 200, record };
}

/** List payments awaiting human compliance review (the officer's queue). */
export function listPaymentsForReview(limit = 50): PaymentRecord[] {
  return [...payments.values()]
    .filter((p) => p.status === "pending_review")
    .sort((a, b) => Date.parse(a.reviewRequestedAt || a.createdAt) - Date.parse(b.reviewRequestedAt || b.createdAt))
    .slice(0, limit);
}

/** Fire-and-forget notification to the compliance inbox that a payment paused. */
function notifyReview(record: PaymentRecord): void {
  void sendEmail({
    to: process.env.FURLPAY_COMPLIANCE_INBOX || process.env.AMBASSADORS_INBOX || "compliance@furlpay.com",
    subject: `[HITL] Payment ${record.id} paused: ${record.reviewReason}`,
    html: `<p>A USDC payment is paused for compliance approval.</p>
<ul>
<li>Payment: ${record.id}</li>
<li>Amount: $${record.amountUsdc.toFixed(2)} USDC</li>
<li>Payer: ${record.payer || "n/a"}</li>
<li>Recipient: ${record.recipient}</li>
<li>Reason: ${record.reviewReason}</li>
</ul>
<p>Approve or reject in the compliance console before it can settle.</p>`,
    text: `Payment ${record.id} paused (${record.reviewReason}): $${record.amountUsdc} USDC ${record.payer} → ${record.recipient}`,
  });
  console.log(`[payments][HITL] ${record.id} paused for review: ${record.reviewReason}`);
}

export function refundPayment(id: string): ExecuteResult {
  const record = getPayment(id);
  if (!record) return { ok: false, status: 404, error: "payment_not_found" };
  if (record.status !== "settled")
    return { ok: false, status: 409, error: "only_settled_payments_refundable" };

  record.refundTransactionHash = "0x" + crypto.randomBytes(32).toString("hex");
  record.status = "refunded";
  record.refundedAt = new Date().toISOString();

  recordTransaction(
    newTx({
      category: "transfer",
      direction: "in",
      title: `Refund from ${short(record.recipient)}`,
      subtitle: `Reversal of ${record.id}`,
      amountUsd: record.amountUsdc,
      token: "USDC",
      chain: "arbitrum",
      status: "settled",
    })
  );

  return { ok: true, status: 200, record };
}

export async function estimateFees(amount: number, sourceChain: string) {
  const chain = getChain(SETTLEMENT_CHAIN)!;
  const gas = await gasQuote(chain);
  const fee = round(amount * FEE_RATE);
  const cardFee = round(amount * 0.035);
  return {
    amountUsdc: amount,
    sourceChain,
    settlementChain: SETTLEMENT_CHAIN,
    furlpayFeeUsdc: fee,
    feeRate: FEE_RATE,
    gasEstimateUsd: gas.transferCostUsd,
    totalCostUsd: round(fee + gas.transferCostUsd),
    cardInterchangeComparisonUsd: cardFee,
    savingsVsCardsUsd: round(cardFee - fee - gas.transferCostUsd),
  };
}

function atomic(usdc: number): string {
  return String(Math.round(usdc * 10 ** USDC_DECIMALS));
}

function short(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
