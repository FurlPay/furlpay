import { z } from "zod";
import { sbRpc, sbSelect } from "@/lib/supabase";
import { screenAddressRisk } from "@/lib/compliance/addressScreening";
import { parseUsdc } from "./money";
import { paymentChain, requiredConfirmations, type PaymentChainId } from "./registry";
import { requireStorage } from "./repository";
import { blockSchema, hash, hex, rpc, verifyChain } from "./rpc";
import { fetchSuiTransaction, usdcDelta } from "./sui";
import { TRANSFER, logSchema } from "./verifier";
import { arcCreditableTransfers } from "@/lib/chains/arc";
import type { MerchantIntent } from "./model";

// Merchant refunds (migration 0045). FurlPay reserves and accounts; the custody
// provider that controls the collection addresses sends. A refund is completed
// only from the chain's own record of that transfer, never from a claim.
export class RefundRejected extends Error {}
export type Refund = { id: string; intent_id: string; merchant_id: string; chain: PaymentChainId; amount_units: string; from_hold_units: string; from_merchant_units: string; to_address: string; reason: string; status: "requested" | "pending_external_execution" | "completed" | "cancelled"; tx_hash: string | null; created_at: string; approved_at: string | null; completed_at: string | null };

export const refundRequestSchema = z.object({
  requestId: z.string().uuid(),
  intentId: z.string().uuid(),
  amount: z.string().max(20).refine(v => { try { return parseUsdc(v) > 0n; } catch { return false; } }, "Enter an exact USDC amount"),
  toAddress: z.string().trim().max(100).optional(),
  reason: z.string().trim().min(3).max(500),
}).strict();

const SQL_ERRORS: Record<string, string> = {
  intent_missing: "Payment not found",
  not_refundable: "Only payments that received funds can be refunded",
  exceeds_refundable: "That is more than remains refundable for this payment",
  refund_address_not_payer: "Refunds can only go to an address that paid this payment",
  request_conflict: "That request ID was already used for a different refund",
  not_cancellable: "Only a refund that operations has not approved can be cancelled",
  refund_missing: "Refund not found",
  not_approvable: "Only a requested refund can be approved",
  not_approved: "Operations must approve the refund before it can be completed",
  amount_mismatch: "The transfer amount differs from the refund",
  party_mismatch: "The transfer is not from this payment's address to the refund address",
  transfer_predates_refund: "The transfer happened before the refund was requested",
  transfer_is_a_payment: "That transfer is a customer payment, not a refund",
  already_completed: "This refund was completed by a different transfer",
};
async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  try { return await sbRpc<T>(fn, args); }
  catch (e) {
    const key = Object.keys(SQL_ERRORS).find(k => (e as Error).message?.includes(k));
    if (key) throw new RefundRejected(SQL_ERRORS[key]);
    throw e;
  }
}
const canon = (chain: PaymentChainId, a: string) => paymentChain(chain).family === "evm" ? a.toLowerCase() : a;

export async function requestRefund(owner: string, actor: string, input: z.infer<typeof refundRequestSchema>) {
  requireStorage();
  const intent = (await sbSelect<MerchantIntent>("merchant_payment_intents", `id=eq.${input.intentId}&merchant_id=eq.${owner}&limit=1`))[0];
  if (!intent) throw new RefundRejected("Payment not found");
  const payers = [...new Set((await sbSelect<{ payer: string }>("merchant_payment_receipts", `select=payer&intent_id=eq.${intent.id}&limit=50`)).map(r => r.payer))];
  // Default to the payer when there is exactly one; otherwise the merchant must choose one of them.
  const to = input.toAddress ? canon(intent.chain, input.toAddress) : payers.length === 1 ? payers[0] : null;
  if (!to) throw new RefundRejected("This payment has several payers: choose which one to refund");
  let risk;
  try { risk = await screenAddressRisk(to, intent.chain); } catch { throw new RefundRejected("Address screening is unavailable; try again later"); }
  if (risk.action !== "allow") throw new RefundRejected("This address cannot receive a refund. Contact support.");
  return call<Refund>("merchant_refund_request", { p_id: input.requestId, p_merchant: owner, p_intent: intent.id, p_amount: parseUsdc(input.amount).toString(), p_to: to, p_reason: input.reason, p_actor: actor });
}

export async function listRefunds(owner: string, intentId?: string) {
  requireStorage();
  return sbSelect<Refund>("merchant_refunds", `merchant_id=eq.${owner}${intentId ? `&intent_id=eq.${intentId}` : ""}&order=created_at.desc&limit=200`);
}
export async function cancelRefund(owner: string, id: string) { requireStorage(); return call<Refund>("merchant_refund_cancel", { p_id: id, p_merchant: owner }); }
export async function approveRefund(actor: string, id: string) { requireStorage(); return call<Refund>("merchant_refund_approve", { p_id: id, p_actor: actor }); }
export async function pendingRefunds() {
  requireStorage();
  return sbSelect<Refund>("merchant_refunds", "status=in.(requested,pending_external_execution)&order=created_at.asc&limit=200");
}

type Transfer = { log: number; amount: bigint; from: string; to: string; block: string; time: number };
/** Read the refund transfer from the chain: success, canonical, at depth, USDC only. */
export async function readRefundTransfer(chain: PaymentChainId, txHash: string, from: string, to: string): Promise<Transfer> {
  const c = paymentChain(chain);
  if (c.family === "sui") {
    const tx = await fetchSuiTransaction(txHash);
    if (!tx || tx.effects.status !== "SUCCESS" || !tx.effects.checkpoint || !tx.effects.timestamp) throw new RefundRejected("That Sui transaction is not a successful, checkpointed transaction");
    const sent = -usdcDelta(tx, from), received = usdcDelta(tx, to);
    if (sent <= 0n || received <= 0n) throw new RefundRejected("That transaction did not move USDC from the payment address to the refund address");
    // Netted per owner: the refund address must receive exactly what the collection address sent.
    if (sent !== received) throw new RefundRejected("That transaction moved USDC to other parties as well; refund in a dedicated transfer");
    return { log: 0, amount: received, from, to, block: String(tx.effects.checkpoint.sequenceNumber), time: Date.parse(tx.effects.timestamp) };
  }
  if (c.family !== "evm") throw new RefundRejected(`Refund completion on ${c.name} is not supported yet; record it with FurlPay operations`);
  if (!hash.safeParse(txHash).success) throw new RefundRejected("Enter the transaction hash");
  await verifyChain(chain);
  const receipt = z.object({ status: hex, blockNumber: hex, blockHash: hash, logs: z.array(logSchema) }).nullable().parse(await rpc(chain, "eth_getTransactionReceipt", [txHash]));
  if (!receipt) throw new RefundRejected("That transaction is not on-chain yet; try again shortly");
  if (BigInt(receipt.status) !== 1n) throw new RefundRejected("That transaction reverted");
  const head = BigInt(hex.parse(await rpc(chain, "eth_blockNumber", [])));
  const depth = Number(head - BigInt(receipt.blockNumber) + 1n), needed = requiredConfirmations(chain) ?? 1;
  if (depth < needed) throw new RefundRejected(`Waiting for confirmations (${depth} of ${needed})`);
  const block = blockSchema.parse(await rpc(chain, "eth_getBlockByNumber", [receipt.blockNumber, false]));
  if (block.hash.toLowerCase() !== receipt.blockHash.toLowerCase()) throw new RefundRejected("That block was reorganized out; wait and retry");
  const time = Number(BigInt(block.timestamp)) * 1000;
  if (chain === "arc") {
    // A custody provider may refund on Arc with a plain native send (system-emitter log only).
    const moves = arcCreditableTransfers(receipt.logs).filter(m => m.from === from.toLowerCase() && m.to === to.toLowerCase());
    if (moves.length !== 1) throw new RefundRejected(moves.length ? "That transaction contains several transfers to the refund address" : "That transaction has no USDC transfer from the payment address to the refund address");
    if (moves[0].dust !== 0n || moves[0].logIndex === undefined) throw new RefundRejected("That transfer is not a whole number of USDC micro-units");
    return { log: Number(BigInt(moves[0].logIndex)), amount: moves[0].erc20Value, from, to, block: BigInt(receipt.blockNumber).toString(), time };
  }
  const pad = (a: string) => `0x${a.slice(2).toLowerCase().padStart(64, "0")}`;
  const matches = receipt.logs.filter(l => !l.removed && l.address.toLowerCase() === c.token.toLowerCase() && l.topics.length === 3
    && l.topics[0].toLowerCase() === TRANSFER && l.topics[1].toLowerCase() === pad(from) && l.topics[2].toLowerCase() === pad(to));
  if (matches.length !== 1) throw new RefundRejected(matches.length ? "That transaction contains several transfers to the refund address" : "That transaction has no USDC transfer from the payment address to the refund address");
  return { log: Number(BigInt(matches[0].logIndex)), amount: BigInt(matches[0].data), from, to, block: BigInt(receipt.blockNumber).toString(), time };
}

export async function completeRefund(id: string, txHash: string) {
  requireStorage();
  const refund = (await sbSelect<Refund>("merchant_refunds", `id=eq.${id}&limit=1`))[0];
  if (!refund) throw new RefundRejected("Refund not found");
  if (refund.status !== "pending_external_execution" && refund.status !== "completed") throw new RefundRejected(SQL_ERRORS.not_approved);
  const intent = (await sbSelect<MerchantIntent>("merchant_payment_intents", `id=eq.${refund.intent_id}&limit=1`))[0];
  const t = await readRefundTransfer(refund.chain, txHash, intent.recipient, refund.to_address);
  return call<Refund>("merchant_refund_complete", { p_id: id, p_tx: paymentChain(refund.chain).family === "evm" ? txHash.toLowerCase() : txHash, p_log: t.log, p_amount: t.amount.toString(), p_from: t.from, p_to: t.to, p_block: t.block, p_time: new Date(t.time).toISOString() });
}
