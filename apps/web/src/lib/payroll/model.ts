import { z } from "zod";
import { parseUsdc } from "@/lib/payments/merchant/money";

// Payroll settles through FurlPayRouter on its settlement chain. createPayment
// signs every intent for Arbitrum, so a contractor "paid on Base" would in fact
// receive on Arbitrum; only the chain where the USDC actually lands is offered.
export const payrollChainSchema = z.enum(["arbitrum"]);
const evmAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "Enter a 0x wallet address").refine(a => !/^0x0{40}$/.test(a), "The zero address cannot receive payroll");
const amount = z.string().max(20).refine(v => { try { return parseUsdc(v) > 0n; } catch { return false; } }, "Enter an amount above zero and at most 1,000,000 USDC (up to six decimals)");

export const contractorSchema = z.object({
  requestId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  role: z.string().trim().max(80).optional(),
  country: z.string().regex(/^[A-Z]{2}$/, "Use a two-letter country code"),
  payoutChain: payrollChainSchema,
  payoutAddress: evmAddress,
  defaultAmount: amount,
}).strict();
export const contractorPatchSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().email().max(200).optional(),
  role: z.string().trim().max(80).optional(),
  country: z.string().regex(/^[A-Z]{2}$/).optional(),
  payoutChain: payrollChainSchema.optional(),
  payoutAddress: evmAddress.optional(),
  defaultAmount: amount.optional(),
  active: z.boolean().optional(),
}).strict();

export const batchSchema = z.object({
  requestId: z.string().uuid(),
  cycle: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM"),
  chain: payrollChainSchema,
  // Recipients come from the saved roster, never from the request: a batch can
  // only pay addresses the employer stored (and can review) beforehand.
  lines: z.array(z.object({ contractorId: z.string().uuid(), amount: amount.optional() }).strict()).min(1).max(100)
    .refine(l => new Set(l.map(x => x.contractorId)).size === l.length, "Each contractor can appear once per batch"),
}).strict();
export const batchActionSchema = z.discriminatedUnion("action", [
  z.object({ id: z.string().uuid(), action: z.enum(["submit", "cancel", "reissue"]) }).strict(),
  z.object({ id: z.string().uuid(), action: z.literal("sign"), lineId: z.string().uuid(), signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/, "Signature must be 65 bytes") }).strict(),
]);

export type ContractorInput = z.infer<typeof contractorSchema>;
export type ContractorPatch = z.infer<typeof contractorPatchSchema>;
export type BatchInput = z.infer<typeof batchSchema>;
export type PayrollChain = z.infer<typeof payrollChainSchema>;
export type Contractor = { id: string; merchant_id: string; name: string; email: string; role: string; country: string; payout_chain: PayrollChain; payout_address: string; default_amount_units: string; tax_status: "unsubmitted" | "w8ben_signed" | "w9_signed" | "exempt"; tax_form?: "w9" | "w8ben" | null; tin_last4?: string | null; tax_signed_on?: string | null; tax_expires_on?: string | null; active: boolean; created_at: string; updated_at: string };
export type BatchStatus = "draft" | "blocked" | "submitting" | "submitted" | "cancelled";
export type Batch = { id: string; merchant_id: string; cycle: string; chain: PayrollChain; status: BatchStatus; payer_address: string | null; headcount: number; gross_units: string; batch_fee_units: string; seat_fee_units: string; total_quote_units: string; created_at: string; submitted_at: string | null };
export type BatchLine = { id: string; batch_id: string; contractor_id: string | null; name: string; recipient: string; amount_units: string; screening: "clear" | "blocked" | "unavailable"; payment_id: string | null; created_at: string; sign_data: unknown; sign_deadline: string | null; issue_count: number; signature: string | null; signer: string | null; signed_at: string | null };
