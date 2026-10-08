import { z } from "zod";
import { parseUsdc, feeSplit } from "./money";
export const chainSchema = z.enum(["arc", "base", "arbitrum", "solana", "polygon", "ethereum", "optimism", "avalanche"]);
const amountSchema = z.string().max(20).refine(v => { try { return parseUsdc(v) > 0n; } catch { return false; } }, "Enter an amount above zero and at most 1,000,000 USDC (up to six decimals)");
export const linkSchema = z.object({
  requestId: z.string().uuid(), title: z.string().trim().min(1).max(120), description: z.string().trim().max(500),
  amount: amountSchema, chains: z.array(chainSchema).min(1).max(8).refine(v => new Set(v).size === v.length),
  reusable: z.boolean(), feePayer: z.enum(["merchant", "customer"]),
  expiresAt: z.string().datetime().nullable(), kind: z.enum(["link", "invoice", "terminal"]),
  reference: z.string().trim().max(80),
  lines: z.array(z.object({ description: z.string().trim().min(1).max(120), quantity: z.number().int().positive().max(10000), unitPrice: amountSchema }).strict()).max(50),
}).strict().superRefine((v, ctx) => {
  if (v.kind !== "link" && v.reusable) ctx.addIssue({ code: "custom", path: ["reusable"], message: "Invoices and terminal requests are single-use" });
  if (v.kind === "invoice" && !v.lines.length) ctx.addIssue({ code: "custom", path: ["lines"], message: "Add an invoice line" });
  if (v.kind !== "invoice" && v.lines.length) ctx.addIssue({ code: "custom", path: ["lines"], message: "Line items belong to invoices" });
  if (v.lines.length) {
    try { if (v.lines.reduce((n,l) => n + parseUsdc(l.unitPrice) * BigInt(l.quantity), 0n) !== parseUsdc(v.amount)) ctx.addIssue({ code: "custom", path: ["amount"], message: "Invoice total must equal its line items" }); } catch { /* field errors already reported */ }
  }
});
export type LinkInput = z.infer<typeof linkSchema>;
export type MerchantLink = { id: string; merchant_id: string; merchant_name: string; slug: string; title: string; description: string; amount_units: string; processing_bps: number; fee_payer: "merchant" | "customer"; chains: z.infer<typeof chainSchema>[]; reusable: boolean; active: boolean; kind: LinkInput["kind"]; reference: string; lines: LinkInput["lines"]; expires_at: string | null; created_at: string };
export type PaymentStatus = "awaiting_payment" | "confirming" | "underpaid" | "paid" | "overpaid" | "expired" | "review";
export type MerchantIntent = { id: string; link_id: string; merchant_id: string; chain: z.infer<typeof chainSchema>; recipient: string; reference: string; status: PaymentStatus; gross_units: string; fee_units: string; charge_units: string; net_units: string; received_units: string; start_block: string; scan_block: string; created_at: string; expires_at: string; paid_at: string | null; transaction_hash: string | null; confirmations: number; ledger_tx_id: string | null };
export const checkoutSchema = z.object({ requestId: z.string().uuid(), chain: chainSchema }).strict();
export function publicLink(link: MerchantLink) {
  return { slug: link.slug, title: link.title, description: link.description, merchantName: link.merchant_name, kind: link.kind, reference: link.reference, lines: link.lines, amount: link.amount_units, chains: link.chains, reusable: link.reusable, active: link.active, expiresAt: link.expires_at, feePayer: link.fee_payer, pricing: feeSplit(BigInt(link.amount_units), link.processing_bps, link.fee_payer) };
}
export function publicIntent(intent: MerchantIntent) {
  return { id: intent.id, chain: intent.chain, recipient: intent.recipient, reference: intent.reference, status: intent.status, charge: intent.charge_units, fee: intent.fee_units, received: intent.received_units, expiresAt: intent.expires_at, paidAt: intent.paid_at, transactionHash: intent.transaction_hash, confirmations: intent.confirmations };
}
export type PublicLink = ReturnType<typeof publicLink>;
export type PublicIntent = ReturnType<typeof publicIntent>;
export const isPaid = (s: PaymentStatus) => s === "paid" || s === "overpaid";
