import { z } from "zod";
import { sbRpc, sbSelect } from "@/lib/supabase";
import { paymentChain, type PaymentChainId } from "./registry";
import { hash, hex, rpc, verifyChain } from "./rpc";
import { decodeTransfer, logSchema } from "./verifier";
import { fetchSuiTransaction, usdcDelta } from "./sui";
import { arcCreditableTransfers } from "@/lib/chains/arc";
import type { MerchantIntent } from "./model";

// Three-way reconciliation: chain receipt vs intent vs ledger. The intent and
// ledger legs run in SQL (merchant_reconcile, migration 0042). The chain leg is
// here: every recently recorded receipt is re-read from the network and must
// still be a successful, canonical USDC transfer of the recorded amount to the
// intent's address. Findings become alerts for operations. Nothing here edits an
// intent, reverses a journal or touches merchant balances. Solana receipts are
// checked for finality and success only; their amount was proven from token
// balance deltas when credited.
export type Receipt = { chain: PaymentChainId; tx_hash: string; log_index: number; intent_id: string; amount_units: string; block_hash: string };
export type Finding = { intent: string; kind: "receipt_failed" | "amount_mismatch" | "rpc_unavailable"; detail: string };

const evmReceipt = z.object({ status: hex, blockHash: hash, logs: z.array(z.unknown()) });

/** Re-read one receipt from the chain. Returns null when it still matches. */
export async function checkReceipt(r: Receipt, intent: MerchantIntent): Promise<Finding | null> {
  const where = `${r.chain} ${r.tx_hash}:${r.log_index}`;
  try {
    await verifyChain(r.chain);
    if (paymentChain(r.chain).family === "sui") {
      const tx = await fetchSuiTransaction(r.tx_hash);
      if (!tx || tx.effects.status !== "SUCCESS") return { intent: r.intent_id, kind: "receipt_failed", detail: `${where} is not a successful Sui transaction` };
      if (tx.effects.checkpoint?.digest !== r.block_hash) return { intent: r.intent_id, kind: "receipt_failed", detail: `${where} is in checkpoint ${tx.effects.checkpoint?.digest ?? "none"}, recorded ${r.block_hash}` };
      const credited = usdcDelta(tx, intent.recipient);
      if (credited.toString() !== r.amount_units) return { intent: r.intent_id, kind: "amount_mismatch", detail: `${where} credited ${credited} units; recorded ${r.amount_units}` };
      return null;
    }
    if (paymentChain(r.chain).family === "solana") {
      const tx = z.object({ meta: z.object({ err: z.unknown() }) }).nullable().parse(await rpc(r.chain, "getTransaction", [r.tx_hash, { commitment: "finalized", maxSupportedTransactionVersion: 0, encoding: "jsonParsed" }]));
      if (!tx) return { intent: r.intent_id, kind: "receipt_failed", detail: `${where} is not a finalized transaction` };
      if (tx.meta.err !== null) return { intent: r.intent_id, kind: "receipt_failed", detail: `${where} failed on-chain` };
      return null;
    }
    const raw = await rpc(r.chain, "eth_getTransactionReceipt", [r.tx_hash]);
    if (raw === null) return { intent: r.intent_id, kind: "receipt_failed", detail: `${where} has no receipt (reorged out?)` };
    const receipt = evmReceipt.parse(raw);
    if (BigInt(receipt.status) !== 1n) return { intent: r.intent_id, kind: "receipt_failed", detail: `${where} reverted` };
    if (receipt.blockHash.toLowerCase() !== r.block_hash.toLowerCase()) return { intent: r.intent_id, kind: "receipt_failed", detail: `${where} is now in block ${receipt.blockHash}, recorded ${r.block_hash}` };
    if (r.chain === "arc") {
      // ARC-P2-003: Arc receipts are keyed on the system-emitter log and may have no ERC-20 log at all.
      const logs = receipt.logs.map(l => logSchema.safeParse(l)).flatMap(l => l.success ? [l.data] : []);
      const m = arcCreditableTransfers(logs).find(x => x.logIndex !== undefined && BigInt(x.logIndex) === BigInt(r.log_index));
      if (!m || m.to !== intent.recipient.toLowerCase()) return { intent: r.intent_id, kind: "receipt_failed", detail: `${where} no longer moves USDC to this payment's address` };
      if (m.dust !== 0n || m.erc20Value.toString() !== r.amount_units) return { intent: r.intent_id, kind: "amount_mismatch", detail: `${where} moved ${m.erc20Value} units (+${m.dust} wei dust); recorded ${r.amount_units}` };
      return null;
    }
    const log = receipt.logs.map(l => logSchema.safeParse(l)).find(l => l.success && BigInt(l.data.logIndex) === BigInt(r.log_index));
    if (!log?.success) return { intent: r.intent_id, kind: "receipt_failed", detail: `${where} has no such log` };
    const transfer = decodeTransfer(intent, log.data);
    if (transfer.amount !== r.amount_units) return { intent: r.intent_id, kind: "amount_mismatch", detail: `${where} moved ${transfer.amount} units; recorded ${r.amount_units}` };
    return null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    // A transfer that no longer decodes as USDC to this intent is a finding; a reader outage is not proof of anything.
    if (/canonical USDC|Malformed|Wrong recipient|Invalid payment/.test(msg)) return { intent: r.intent_id, kind: "receipt_failed", detail: `${where}: ${msg}` };
    return { intent: r.intent_id, kind: "rpc_unavailable", detail: `${where}: could not re-read (${msg.slice(0, 120)})` };
  }
}

export async function reconcile(sinceMs = 7 * 86_400_000, chainLimit = 20) {
  const since = new Date(Date.now() - sinceMs).toISOString();
  const database = await sbRpc<number>("merchant_reconcile", { p_since: since });
  // Liveness (0046): stuck confirmations, a stopped scanner, unreviewed holds.
  const liveness = await sbRpc<number>("merchant_liveness", {});
  const receipts = await sbSelect<Receipt>("merchant_payment_receipts", `created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=${chainLimit}`);
  const ids = [...new Set(receipts.map(r => r.intent_id))];
  const intents = ids.length ? await sbSelect<MerchantIntent>("merchant_payment_intents", `id=in.(${ids.join(",")})&limit=${ids.length}`) : [];
  const byId = new Map(intents.map(i => [i.id, i]));
  let chain = 0, unavailable = 0;
  for (const r of receipts) {
    const intent = byId.get(r.intent_id); if (!intent) continue;
    const f = await checkReceipt(r, intent);
    if (!f) continue;
    if (f.kind === "rpc_unavailable") unavailable++;
    const created = await sbRpc<boolean>("merchant_reconciliation_alert", { p_intent: f.intent, p_kind: f.kind, p_detail: f.detail, p_severity: f.kind === "rpc_unavailable" ? "medium" : "high" });
    if (created) chain++;
  }
  return { databaseAlerts: database, livenessAlerts: liveness, chainAlerts: chain, receiptsChecked: receipts.length, unavailable };
}
