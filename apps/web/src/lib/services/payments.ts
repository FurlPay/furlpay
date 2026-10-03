import crypto from "crypto";
import { screenAddress } from "./compliance";
import { getChain, gasQuote } from "./chainRegistry";
import { newTx, recordTransaction } from "@/lib/store";
import { recordPaymentWithFee, reverseLedgerTx } from "@/lib/ledger";
import { sendEmail } from "@/lib/email";
import { mockAllowed, IntegrationNotConfiguredError } from "@/lib/integrations";
import { audit } from "@/lib/audit";
import { log } from "@/lib/log";

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
// MOCK: deterministic settlement hashes, no RPC — dev/preview only. In
// production without INTEGRATION_MODE=live, execute/approve/refund fail
// closed with 503 (see lib/integrations.ts) instead of fabricating hashes.
// ---------------------------------------------------------------------------

export const FEE_RATE = 0.005; // 0.5%
const EXPIRY_SECONDS = 900; // 15 min quote validity
const SETTLEMENT_CHAIN = "arbitrum";
const USDC_DECIMALS = 6;
// Bound the in-memory stores (production: Postgres, where this is moot).
const MAX_RECORDS = 10_000;

// Human-in-the-loop (HITL) compliance gateway. A payment that clears sanctions
// screening but crosses a regulatory threshold (large value, elevated risk, or
// a high-risk jurisdiction) is PAUSED for a human compliance officer to approve
// or reject before it settles on-chain.
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
  /** User who created the intent (from session). */
  createdByUserId: string;
  /** User whose signed authorization executed the payment. */
  payerUserId?: string;
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
  /** Ledger transaction id of the SETTLEMENT posting. Never overwritten: the
   *  record's link to the entry that moved the money is part of the audit
   *  trail, and a refund adds a compensating entry rather than replacing it. */
  ledgerTxId?: string;
  /** Ledger transaction id of the refund's compensating entry, once refunded. */
  refundLedgerTxId?: string;
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

// Payments with a settlement or refund in progress on THIS instance.
// settle()/refund await the ledger before setting the terminal status, so
// without a claim taken synchronously before that await, two concurrent
// requests both passed the status check and both posted (finding FP-SET-16).
// Per-process by construction, like the Map above: this store is the
// non-production path (settle and refund refuse in production), and a
// cross-instance rail needs a durable compare-and-set, as /api/v1/payments has.
const inFlight: Set<string> =
  (globalThis as unknown as { __furlpayPaymentInFlight?: Set<string> }).__furlpayPaymentInFlight ??
  ((globalThis as unknown as { __furlpayPaymentInFlight?: Set<string> }).__furlpayPaymentInFlight = new Set());
function claimInFlight(key: string): boolean {
  if (inFlight.has(key)) return false;
  inFlight.add(key);
  return true;
}
function releaseInFlight(key: string): void {
  inFlight.delete(key);
}
// Idempotency-Key → paymentId, SCOPED PER USER (`${userId}:${key}`): two
// tenants supplying the same key must never resolve to each other's intent.
// Under retry storms the same (user, key) resolves to the same payment intent
// instead of minting a duplicate charge.
const idempotency = g.__furlpayIdem ?? (g.__furlpayIdem = new Map());

function idemKey(userId: string, key: string): string {
  return `${userId}:${key}`;
}

/** Evict oldest TERMINAL records when the store exceeds its bound. Active
 *  records (pending/review) are never evicted. */
function boundStores(): void {
  if (payments.size <= MAX_RECORDS) return;
  const terminal: PaymentRecord[] = [];
  for (const p of payments.values()) {
    if (p.status === "settled" || p.status === "refunded" || p.status === "expired" || p.status === "blocked") {
      terminal.push(p);
    }
  }
  terminal.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  for (const p of terminal.slice(0, payments.size - MAX_RECORDS)) {
    payments.delete(p.id);
    if (p.idempotencyKey) idempotency.delete(idemKey(p.createdByUserId, p.idempotencyKey));
  }
}

/**
 * What an UNAUTHENTICATED holder of a payment id may see (GET /api/payments/:id).
 *
 * The id is 96 random bits, so it works as a capability URL, but whoever holds
 * it (the payee, anyone they forward the link to) is not the payer. The full
 * record carries internal identities (createdByUserId, payerUserId, reviewedBy),
 * the caller's idempotency key, the signing nonce, ledger ids and compliance
 * review/blocking reasons; none of that belongs to a link holder.
 */
export function publicPaymentView(r: PaymentRecord) {
  return {
    id: r.id,
    status: r.status,
    amountUsdc: r.amountUsdc,
    feeUsdc: r.feeUsdc,
    sourceChain: r.sourceChain,
    settlementChain: r.settlementChain,
    recipient: r.recipient,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    settledAt: r.settledAt ?? null,
    refundedAt: r.refundedAt ?? null,
    transactionHash: r.transactionHash ?? null,
    refundTransactionHash: r.refundTransactionHash ?? null,
  };
}

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
  /** Acting user (from session) — scopes idempotency and attribution. */
  userId: string;
}

/** The deployed FurlPayRouter the payer's wallet signs against.
 *
 *  Fails closed when unset in production: the previous fallback emitted the
 *  literal "0xFurlPayRouterPendingDeployment" as the EIP-712 `verifyingContract`,
 *  so a live deployment would hand out typed data bound to a non-address. Any
 *  signature collected against it is meaningless, and the domain separator
 *  silently differs from the real contract's — exactly the kind of "looks
 *  settled, signed nothing" state a payments API must never produce. Dev and
 *  preview keep the placeholder so the flow stays clickable without a deploy. */
function routerAddress(): string {
  const configured = process.env.FURLPAY_ROUTER_ADDRESS;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new IntegrationNotConfiguredError("FurlPayRouter (FURLPAY_ROUTER_ADDRESS)");
  }
  return "0xFurlPayRouterPendingDeployment";
}

/** Build the create-intent response (quote + EIP-712 sign data) for a record. */
async function buildCreateResponse(record: PaymentRecord, replayed: boolean) {
  const chain = getChain(SETTLEMENT_CHAIN)!;
  const router = routerAddress();
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
  // Idempotent replay: same (user, key) → same intent, so a dropped-receipt
  // retry or a fan-out of sub-agents sharing a key never mints a duplicate
  // charge. Only a fully expired-and-gone intent falls through to mint fresh.
  const key = params.idempotencyKey?.trim();
  if (key) {
    const existingId = idempotency.get(idemKey(params.userId, key));
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
    createdByUserId: params.userId,
    metadata: params.metadata,
    nonce: "0x" + crypto.randomBytes(32).toString("hex"),
    idempotencyKey: key,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + EXPIRY_SECONDS * 1000).toISOString(),
  };
  payments.set(record.id, record);
  if (key) idempotency.set(idemKey(params.userId, key), record.id);
  boundStores();

  audit("payment.created", params.userId, {
    paymentId: record.id,
    amountUsdc: record.amountUsdc,
    recipient: record.recipient,
  });
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

/** Perform the settlement for a screened, approved payment.
 *
 *  Async because the ledger is now durable: the balanced posting goes to
 *  Postgres and only lands in the in-memory mirror once Postgres accepts it.
 *  A settlement that cannot be recorded must not be reported as settled. */
async function settle(record: PaymentRecord): Promise<ExecuteResult> {
  // Hard stop: the ONLY implementation below is the mock. Until a real relayer
  // lands here, production must never fabricate a settlement hash — even if
  // INTEGRATION_MODE=live was set by mistake.
  if (process.env.NODE_ENV === "production") {
    log.error("settlement attempted in production without a live relayer", { paymentId: record.id });
    return { ok: false, status: 503, error: "settlement_unavailable", record };
  }

  const userId = record.payerUserId ?? record.createdByUserId;

  // Ledger first: one balanced transaction covering payer debit, recipient
  // share, and platform fee. If the posting fails, nothing settles.
  try {
    const entry = await recordPaymentWithFee(
      userId,
      record.amountUsdc,
      record.feeUsdc,
      `Payment ${record.id} to ${short(record.recipient)}`
    );
    record.ledgerTxId = entry.id;
  } catch (e) {
    log.error("settle ledger posting failed", { paymentId: record.id, error: (e as Error).message });
    return { ok: false, status: 500, error: "ledger_error", record };
  }

  // MOCK settlement — LIVE: relayer submits the signed authorization to
  // FurlPayRouter.pay() and waits one Arbitrum confirmation (~250ms).
  record.transactionHash = "0x" + crypto.randomBytes(32).toString("hex");
  record.status = "settled";
  record.settledAt = new Date().toISOString();

  recordTransaction(
    userId,
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
  audit("payment.settled", userId, { paymentId: record.id, amountUsdc: record.amountUsdc });
  return { ok: true, status: 200, record };
}

/** Verify signature + screen both parties, then settle on Arbitrum One. */
export async function executePayment(
  id: string,
  payer: string,
  signature: string,
  actingUserId: string
): Promise<ExecuteResult> {
  // Fail closed in production while settlement is mocked — a fabricated tx
  // hash must never masquerade as a real settlement.
  if (!mockAllowed()) return { ok: false, status: 503, error: "settlement_unavailable" };

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
  // Claimed BEFORE any field is written: a second execute arriving while this
  // one awaits the ledger must neither settle again nor overwrite the payer.
  if (!claimInFlight(record.id)) return { ok: false, status: 409, error: "payment_in_flight", record };
  try {
    return await screenReviewAndSettle(record, payer, actingUserId);
  } finally {
    releaseInFlight(record.id);
  }
}

async function screenReviewAndSettle(record: PaymentRecord, payer: string, actingUserId: string): Promise<ExecuteResult> {

  // OFAC screening on both legs before anything touches the chain.
  const screens: Record<"payer" | "recipient", ReturnType<typeof screenAddress>> = {
    payer: screenAddress(payer),
    recipient: screenAddress(record.recipient),
  };
  for (const [role, screen] of Object.entries(screens) as ["payer" | "recipient", ReturnType<typeof screenAddress>][]) {
    if (screen.sanctioned || screen.risk === "severe") {
      record.status = "blocked";
      record.blockedReason = `${role}_failed_sanctions_screen`;
      audit("payment.blocked", actingUserId, { paymentId: record.id, reason: record.blockedReason });
      return { ok: false, status: 403, error: record.blockedReason, record };
    }
  }

  record.payer = payer;
  record.payerUserId = actingUserId;

  // HITL gateway: pause (don't settle) if the payment crosses a regulatory
  // threshold; a human must approvePayment() before funds move on-chain.
  const reviewReason = reviewReasonFor(record, screens.payer, screens.recipient);
  if (reviewReason) {
    record.status = "pending_review";
    record.reviewReason = reviewReason;
    record.reviewRequestedAt = new Date().toISOString();
    notifyReview(record);
    audit("payment.review_requested", actingUserId, { paymentId: record.id, reason: reviewReason });
    return { ok: false, status: 202, error: "pending_human_review", record, pending: true };
  }

  return settle(record);
}

/** Approve a paused payment and settle it. Caller must be a compliance
 *  officer (enforced by the route via requireRole) and must not be the payer
 *  — separation of duties is the point of the pause. */
export async function approvePayment(id: string, approverUserId: string): Promise<ExecuteResult> {
  if (!mockAllowed()) return { ok: false, status: 503, error: "settlement_unavailable" };

  const record = getPayment(id);
  if (!record) return { ok: false, status: 404, error: "payment_not_found" };
  if (record.status === "settled") return { ok: true, status: 200, record, replayed: true };
  if (record.status !== "pending_review")
    return { ok: false, status: 409, error: `cannot_approve_${record.status}` };
  if (approverUserId === (record.payerUserId ?? record.createdByUserId)) {
    return { ok: false, status: 403, error: "reviewer_cannot_approve_own_payment", record };
  }

  if (!claimInFlight(record.id)) return { ok: false, status: 409, error: "payment_in_flight", record };
  let result: ExecuteResult;
  try {
    record.reviewedAt = new Date().toISOString();
    record.reviewedBy = approverUserId;
    result = await settle(record);
  } finally {
    releaseInFlight(record.id);
  }
  if (result.ok) {
    audit("payment.review_approved", approverUserId, { paymentId: record.id });
  }
  return result;
}

/** Reject a paused payment; it is blocked and can never settle. */
export function rejectPayment(id: string, approverUserId: string, reason?: string): ExecuteResult {
  const record = getPayment(id);
  if (!record) return { ok: false, status: 404, error: "payment_not_found" };
  if (record.status !== "pending_review")
    return { ok: false, status: 409, error: `cannot_reject_${record.status}` };

  record.status = "blocked";
  record.blockedReason = reason ? `rejected_in_review: ${reason}` : "rejected_in_review";
  record.reviewedAt = new Date().toISOString();
  record.reviewedBy = approverUserId;
  audit("payment.review_rejected", approverUserId, { paymentId: record.id, reason: record.blockedReason });
  return { ok: true, status: 200, record };
}

/** List payments awaiting human compliance review (the officer's queue). */
export function listPaymentsForReview(limit = 50): PaymentRecord[] {
  return [...payments.values()]
    .filter((p) => p.status === "pending_review")
    .sort((a, b) => Date.parse(a.reviewRequestedAt || a.createdAt) - Date.parse(b.reviewRequestedAt || b.createdAt))
    .slice(0, limit);
}

/** Notify the compliance inbox that a payment paused. Failures are logged —
 *  a lost notification must be visible, not silent, because an unnoticed
 *  paused payment sits in limbo until someone opens the console. */
function notifyReview(record: PaymentRecord): void {
  sendEmail({
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
  })
    .then((result) => {
      if (!result.ok) {
        log.error("HITL review notification failed", { paymentId: record.id, error: result.error });
      }
    })
    .catch((e) => log.error("HITL review notification failed", { paymentId: record.id, error: (e as Error).message }));
  log.info("payment paused for review", { paymentId: record.id, reason: record.reviewReason });
}

export async function refundPayment(id: string, actingUserId: string): Promise<ExecuteResult> {
  // Same hard stop as settle(): the refund path below is the mock — no
  // production refunds until a live relayer exists.
  if (process.env.NODE_ENV === "production") {
    return { ok: false, status: 503, error: "settlement_unavailable" };
  }

  const record = getPayment(id);
  if (!record) return { ok: false, status: 404, error: "payment_not_found" };
  // Idempotent replay: refunding an already-refunded payment returns the
  // original outcome rather than double-crediting.
  if (record.status === "refunded") return { ok: true, status: 200, record, replayed: true };
  if (record.status !== "settled")
    return { ok: false, status: 409, error: "only_settled_payments_refundable" };

  // Same in-flight claim as execute, so two concurrent refunds cannot both
  // reach the reversal (the durable ledger's unique index on `reverses` also
  // refuses the second, but the in-memory mirror alone would not).
  if (!claimInFlight(`refund:${record.id}`)) return { ok: false, status: 409, error: "refund_in_flight", record };
  try {
    return await reverseAndRecordRefund(record, actingUserId);
  } finally {
    releaseInFlight(`refund:${record.id}`);
  }
}

async function reverseAndRecordRefund(record: PaymentRecord, actingUserId: string): Promise<ExecuteResult> {
  const userId = record.payerUserId ?? record.createdByUserId;

  // Reverse the settlement's balanced ledger entry (compensating transaction,
  // never an edit) so the refund reconciles with the original posting.
  try {
    if (record.ledgerTxId) {
      const entry = await reverseLedgerTx(record.ledgerTxId, `Refund of ${record.id}`);
      // Record the compensating entry ALONGSIDE the settlement, not over it.
      // Overwriting ledgerTxId lost the only link back to the posting that
      // moved the money, and left the field pointing at a reversal — which a
      // second refund attempt would then try to reverse, "un-refunding" it.
      record.refundLedgerTxId = entry.id;
    }
  } catch (e) {
    log.error("refund ledger reversal failed", { paymentId: record.id, error: (e as Error).message });
    return { ok: false, status: 500, error: "ledger_error", record };
  }

  record.refundTransactionHash = "0x" + crypto.randomBytes(32).toString("hex");
  record.status = "refunded";
  record.refundedAt = new Date().toISOString();

  recordTransaction(
    userId,
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
  audit("payment.refunded", actingUserId, { paymentId: record.id, amountUsdc: record.amountUsdc });

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
