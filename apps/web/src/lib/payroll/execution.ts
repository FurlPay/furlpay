import { decodeEventLog, getAddress, toEventSelector } from "viem";
import { ROUTER_ABI } from "./routerAbi";
import { z } from "zod";
import { sbRpc } from "@/lib/supabase";
import { rpc, verifyChain, hash, hex } from "@/lib/payments/merchant/rpc";
import { requiredConfirmations } from "@/lib/payments/merchant/registry";
import { configuredRouter } from "@/lib/services/payments";
import { batchDetail, PayrollConflict, requireStorage } from "./repository";
import type { BatchLine } from "./model";
import type { SignData } from "./signing";

// Recording that a payroll batch was executed on FurlPayRouter.
//
// The transaction hash comes from the employer's browser, so it is only a
// pointer. A line is marked executed only after the server re-reads the
// receipt from the batch's chain and finds a PaymentExecuted event, emitted by
// the configured router, whose paymentId, payer, recipient, amount, fee and
// nonce equal what the employer signed for that line — at the deposit-policy
// depth, in a block that is still canonical. Anything less records nothing.
const EXECUTED = toEventSelector("PaymentExecuted(string,address,address,uint256,uint256,bytes32)");
const receiptSchema = z.object({
  status: hex, to: z.string().nullable(), blockNumber: hex, blockHash: hash,
  logs: z.array(z.object({ address: z.string(), topics: z.array(hash), data: z.string() })),
});

export type Executed = { paymentId: string; payer: string; recipient: string; amount: bigint; fee: bigint; nonce: string };
export function executedEvents(logs: { address: string; topics: string[]; data: string }[], router: string): Executed[] {
  const out: Executed[] = [];
  for (const l of logs) {
    if (l.address.toLowerCase() !== router.toLowerCase() || l.topics[0]?.toLowerCase() !== EXECUTED) continue;
    const e = decodeEventLog({ abi: ROUTER_ABI, data: l.data as `0x${string}`, topics: l.topics as [`0x${string}`, ...`0x${string}`[]] });
    if (e.eventName !== "PaymentExecuted") continue;
    out.push({ paymentId: e.args.paymentId, payer: e.args.payer, recipient: e.args.recipient, amount: e.args.amount, fee: e.args.fee, nonce: e.args.nonce });
  }
  return out;
}

/** Does this event execute exactly what the employer signed for this line? */
export function matchesLine(e: Executed, line: BatchLine, payer: string): boolean {
  const m = (line.sign_data as SignData | null)?.message;
  if (!m || !line.signature) return false;
  return e.paymentId === m.paymentId && e.payer.toLowerCase() === payer.toLowerCase()
    && getAddress(e.recipient) === getAddress(m.recipient) && e.amount === BigInt(m.amount) && e.fee === BigInt(m.fee)
    && e.nonce.toLowerCase() === m.nonce.toLowerCase();
}

export async function recordExecution(owner: string, batchId: string, txHash: string) {
  requireStorage();
  const detail = await batchDetail(owner, batchId);
  if (!detail) return null;
  const { batch, lines } = detail;
  if (batch.status !== "submitted" && batch.status !== "completed") throw new PayrollConflict("This batch is not awaiting execution");
  if (!batch.payer_address) throw new PayrollConflict("No line of this batch has been signed");
  const router = configuredRouter(batch.chain);
  if (!router || !/^0x[0-9a-fA-F]{40}$/.test(router)) throw new PayrollConflict(`No FurlPayRouter is configured on ${batch.chain}`);

  await verifyChain(batch.chain);
  const raw = await rpc(batch.chain, "eth_getTransactionReceipt", [txHash]);
  if (raw === null) throw new PayrollConflict("That transaction is not on-chain yet; try again shortly");
  const receipt = receiptSchema.parse(raw);
  if (BigInt(receipt.status) !== 1n) throw new PayrollConflict("That transaction reverted; nothing was paid");
  if (receipt.to?.toLowerCase() !== router.toLowerCase()) throw new PayrollConflict("That transaction was not sent to FurlPayRouter");
  const head = BigInt(hex.parse(await rpc(batch.chain, "eth_blockNumber", [])));
  const depth = Number(head - BigInt(receipt.blockNumber) + 1n);
  const needed = requiredConfirmations(batch.chain) ?? 1;
  if (depth < needed) throw new PayrollConflict(`Waiting for confirmations (${depth} of ${needed})`);
  const canonical = z.object({ hash }).parse(await rpc(batch.chain, "eth_getBlockByNumber", [receipt.blockNumber, false]));
  if (canonical.hash.toLowerCase() !== receipt.blockHash.toLowerCase()) throw new PayrollConflict("That block was reorganized out; wait and retry");

  const events = executedEvents(receipt.logs, router);
  const executedAt = new Date().toISOString();
  const already = lines.filter(l => l.executed_tx).length;
  let matched = 0;
  for (const line of lines) {
    if (line.executed_tx) continue;
    const event = events.find(e => matchesLine(e, line, batch.payer_address!));
    if (!event || !line.payment_id) continue;
    // Compare-and-set on executed_tx, and the fee the router sent to FurlPay's
    // treasury journaled in the same database transaction (migration 0048).
    let recorded: boolean;
    try {
      recorded = await sbRpc<boolean>("payroll_line_executed", { p_batch: batch.id, p_line: line.id, p_tx: txHash.toLowerCase(), p_block: BigInt(receipt.blockNumber).toString(), p_payment_id: line.payment_id, p_fee: event.fee.toString(), p_at: executedAt });
    } catch (e) {
      // The database's own checks (signed fee, signature present, batch state) are refusals, not outages.
      const m = /fee_mismatch|line_unsigned|batch_not_submitted|line_missing/.exec(e instanceof Error ? e.message : "");
      if (m) throw new PayrollConflict(`The database refused to record this line (${m[0]})`);
      throw e;
    }
    if (recorded) matched++;
  }
  if (matched === 0 && already < lines.length) throw new PayrollConflict("That transaction executed none of this batch's outstanding payments");
  // `completed` is set by payroll_line_executed under the batch lock once no line
  // is outstanding; a partially executed batch stays `submitted`.
  return { matched, executed: already + matched, total: lines.length, detail: await batchDetail(owner, batchId) };
}
