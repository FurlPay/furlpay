import { z } from "zod";

// Schemas for the BVNK contracts FurlPay uses, transcribed from BVNK's
// published OpenAPI definitions (docs.bvnk.com, api-explorer). BVNK asks
// integrators not to strictly deserialise fields they do not use ("No strict
// serialisation", Webhooks API), so every object here requires only the fields
// FurlPay reads and lets the rest pass through. Status enums are the documented
// sets; an unknown status is a parse failure, not a guess.

const money = z.object({ amount: z.number(), currency: z.string().min(1).max(12) }).passthrough();

/** Common envelope of every BVNK webhook (BaseWebhookEvent). */
export const webhookEnvelope = z.object({
  event: z.string().min(1).max(200),
  eventId: z.string().min(1).max(100),
  timestamp: z.string().min(1).max(64),
  data: z.unknown().optional(),
}).passthrough();
export type BvnkWebhookEnvelope = z.infer<typeof webhookEnvelope>;

// ── payments (v2 pay-in / payout) ────────────────────────────────────────────
export const PAYIN_V2 = "payment:v2:payin:status-change";
export const PAYOUT_V2 = "payment:v2:payout:status-change";
export const TRANSFER_V3 = "payment:v3:transfer:status-change";
export const WALLET_V2 = "ledger:v2:wallet:status-change";
export const CUSTOMER_STATUS = "platform:accounts:customer:status-change";

export const payinStatuses = ["COMPLETED"] as const;
export const payoutStatuses = ["PENDING", "PROCESSING", "PENDING_APPROVAL", "ON_HOLD", "COMPLETED", "EXPIRED", "CANCELLED", "FAILED", "RETURNED"] as const;
export const transferStatuses = ["PROCESSING", "PENDING_QUOTE_ACCEPTANCE", "EXPIRED", "COMPLETED", "FAILED"] as const;
export const walletStatuses = ["ACTIVE", "INACTIVE", "TERMINATED"] as const;

const paymentData = z.object({
  id: z.string().min(1).max(100),
  method: z.string().min(1).max(40),
  direction: z.enum(["IN", "OUT"]),
  createdAt: z.string(),
  updatedAt: z.string(),
  reference: z.string().max(200).optional(),
  fees: z.object({ processingFee: money.optional(), customerFee: money.optional() }).passthrough().optional(),
  originator: z.object({ amount: z.number(), currency: z.string(), walletId: z.string().optional(), customerId: z.string().optional() }).passthrough(),
  beneficiary: z.object({ amount: z.number(), currency: z.string(), walletId: z.string().optional(), customerId: z.string().optional() }).passthrough(),
}).passthrough();

export const payinEvent = webhookEnvelope.extend({
  event: z.literal(PAYIN_V2),
  data: paymentData.extend({ status: z.enum(payinStatuses) }),
});
export const payoutEvent = webhookEnvelope.extend({
  event: z.literal(PAYOUT_V2),
  data: paymentData.extend({ status: z.enum(payoutStatuses) }),
});

// ── Transfers v3 ─────────────────────────────────────────────────────────────
const conversion = z.object({
  type: z.enum(["QUOTE", "AUTO_CONVERSION"]).optional(),
  allInRate: z.number().optional(),
  baseRate: z.number().optional(),
  digest: z.string().max(1000).optional(),
  expiresAt: z.string().optional(),
  spread: z.object({ percentage: z.number().optional(), amount: z.number().optional(), currency: z.string().optional() }).passthrough().optional(),
}).passthrough();

export const transfer = z.object({
  id: z.string().min(1).max(100),
  reference: z.string().min(1).max(200),
  status: z.enum(transferStatuses),
  fees: z.object({ processingFee: money.optional() }).passthrough().optional(),
  originator: z.object({ amount: z.number(), currency: z.string(), walletId: z.string() }).passthrough(),
  beneficiary: z.object({ amount: z.number(), currency: z.string(), walletId: z.string() }).passthrough(),
  conversion: conversion.optional(),
  expiresAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
}).passthrough();
export type BvnkTransfer = z.infer<typeof transfer>;

export const transferEvent = webhookEnvelope.extend({
  event: z.literal(TRANSFER_V3),
  data: transfer.extend({ direction: z.enum(["IN", "OUT"]), updatedAt: z.string() }),
});

// ── Wallets v2 ───────────────────────────────────────────────────────────────
export const wallet = z.object({
  id: z.string().min(1).max(100),
  name: z.string().optional(),
  customer: z.object({ id: z.string().optional(), name: z.string().optional() }).passthrough().optional(),
  status: z.enum(walletStatuses),
  balance: z.object({ amount: z.union([z.number(), z.string()]), currency: z.string() }).passthrough().optional(),
  paymentInstruments: z.array(z.object({
    type: z.string(),
    accountNumber: z.string().optional(),
    accountNumberFormat: z.string().optional(),
    accountHolderName: z.string().optional(),
    remittanceInformationPrefix: z.string().optional(),
  }).passthrough()).optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
}).passthrough();
export type BvnkWallet = z.infer<typeof wallet>;

export const walletPage = z.object({
  content: z.array(wallet),
  hasNext: z.boolean().optional(),
  pageable: z.object({ pageNumber: z.number().optional(), pageSize: z.number().optional() }).passthrough().optional(),
}).passthrough();

export const walletEvent = webhookEnvelope.extend({
  event: z.literal(WALLET_V2),
  data: wallet.extend({ updatedAt: z.string() }),
});

// ── Payout (read) ────────────────────────────────────────────────────────────
export const payout = z.object({
  id: z.string().min(1).max(100),
  reference: z.string().optional(),
  status: z.enum(payoutStatuses),
  method: z.string(),
  originator: z.object({ amount: z.number(), currency: z.string(), walletId: z.string() }).passthrough(),
  beneficiary: z.object({ amount: z.number(), currency: z.string() }).passthrough(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).passthrough();

// ── Customers ────────────────────────────────────────────────────────────────
export const customerEvent = webhookEnvelope.extend({
  event: z.literal(CUSTOMER_STATUS),
  data: z.object({ id: z.string().optional(), status: z.string().optional(), customerType: z.string().optional() }).passthrough(),
});

/** BVNK's error body (docs: api-overview/errors). */
export const problem = z.object({
  code: z.string().optional(),
  status: z.string().optional(),
  message: z.string().optional(),
}).passthrough();
