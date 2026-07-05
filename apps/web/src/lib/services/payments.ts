import crypto from "crypto";
import { screenAddress } from "./compliance";
import { getChain, gasQuote } from "./chainRegistry";
import { newTx, recordTransaction } from "@/lib/store";

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

export type PaymentStatus =
  | "pending_signature"
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
  createdAt: string;
  expiresAt: string;
  settledAt?: string;
  refundedAt?: string;
  transactionHash?: string;
  refundTransactionHash?: string;
  blockedReason?: string;
}

// In-memory store (production: Postgres). Survives hot-reload via globalThis.
const g = globalThis as unknown as { __furlpayPayments?: Map<string, PaymentRecord> };
const payments = g.__furlpayPayments ?? (g.__furlpayPayments = new Map());

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
}

export async function createPayment(params: CreateParams) {
  const chain = getChain(SETTLEMENT_CHAIN)!;
  const router = process.env.FURLPAY_ROUTER_ADDRESS || "0xFurlPayRouterPendingDeployment";
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
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + EXPIRY_SECONDS * 1000).toISOString(),
  };
  payments.set(record.id, record);

  const gas = await gasQuote(chain);
  return {
    record,
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

export interface ExecuteResult {
  ok: boolean;
  status: number;
  error?: string;
  record?: PaymentRecord;
}

/** Verify signature + screen both parties, then settle on Arbitrum One. */
export function executePayment(id: string, payer: string, signature: string): ExecuteResult {
  const record = getPayment(id);
  if (!record) return { ok: false, status: 404, error: "payment_not_found" };
  if (record.status === "expired") return { ok: false, status: 410, error: "payment_expired" };
  if (record.status !== "pending_signature")
    return { ok: false, status: 409, error: `payment_already_${record.status}` };
  if (!/^0x[0-9a-fA-F]{64,}$/.test(signature))
    return { ok: false, status: 400, error: "invalid_signature" };

  // OFAC screening on both legs before anything touches the chain.
  for (const [role, address] of [["payer", payer], ["recipient", record.recipient]] as const) {
    const screen = screenAddress(address);
    if (screen.sanctioned || screen.risk === "severe") {
      record.status = "blocked";
      record.blockedReason = `${role}_failed_sanctions_screen`;
      return { ok: false, status: 403, error: record.blockedReason, record };
    }
  }

  // MOCK settlement — LIVE: relayer submits the signed authorization to
  // FurlPayRouter.pay() and waits one Arbitrum confirmation (~250ms).
  record.payer = payer;
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

  return { ok: true, status: 200, record };
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
