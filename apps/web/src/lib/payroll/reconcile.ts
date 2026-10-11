import { z } from "zod";
import { raiseAlert } from "@/lib/alerts";
import { sbRpc, sbSelect } from "@/lib/supabase";
import { hash, hex, rpc } from "@/lib/payments/merchant/rpc";
import { configuredRouter } from "@/lib/services/payments";
import { executedEvents } from "./execution";
import type { Batch, BatchLine } from "./model";

// Payroll reconciliation. Three checks, all read-only; findings become alerts
// and nothing here edits a batch, a line or a journal. A reorged or reverted
// execution is never "fixed" automatically: reversing a fee journal is an
// operator decision (ledger_post with p_reverses), as in merchant reconciliation.
//
//   1. Books: every executed line's signed fee is journaled exactly once under
//      its key, and no payroll fee journal lacks an execution (SQL, 0048).
//   2. Chain: recently executed lines are re-read — the receipt must still be
//      successful, in a canonical block, and still contain this line's
//      PaymentExecuted event from the configured router.
//   3. Liveness: a batch submitted more than a day ago with lines still
//      unexecuted is partial, and is reported as partial, never as paid.
const receiptSchema = z.object({ status: hex, blockNumber: hex, blockHash: hash, logs: z.array(z.object({ address: z.string(), topics: z.array(hash), data: z.string() })) });
export type PayrollFinding = { kind: "fee_journal" | "execution_not_on_chain" | "chain_unavailable" | "batch_partial"; batch: string | null; detail: string };

/** Re-read one executed line from its chain. Exported for tests. */
export async function checkExecutedLine(line: BatchLine, batch: Batch): Promise<PayrollFinding | null> {
  const where = `${batch.chain} ${line.executed_tx}`;
  const router = configuredRouter(batch.chain);
  if (!router || !/^0x[0-9a-fA-F]{40}$/.test(router)) return { kind: "chain_unavailable", batch: batch.id, detail: `${where}: no router configured to verify against` };
  try {
    const raw = await rpc(batch.chain, "eth_getTransactionReceipt", [line.executed_tx]);
    if (raw === null) return { kind: "execution_not_on_chain", batch: batch.id, detail: `${where}: receipt no longer found (reorganized?)` };
    const r = receiptSchema.parse(raw);
    if (BigInt(r.status) !== 1n) return { kind: "execution_not_on_chain", batch: batch.id, detail: `${where}: receipt now reports failure` };
    const block = z.object({ hash }).parse(await rpc(batch.chain, "eth_getBlockByNumber", [r.blockNumber, false]));
    if (block.hash.toLowerCase() !== r.blockHash.toLowerCase()) return { kind: "execution_not_on_chain", batch: batch.id, detail: `${where}: block is no longer canonical` };
    if (!executedEvents(r.logs, router).some(e => e.paymentId === line.payment_id)) return { kind: "execution_not_on_chain", batch: batch.id, detail: `${where}: no PaymentExecuted for ${line.payment_id}` };
    return null;
  } catch (e) {
    return { kind: "chain_unavailable", batch: batch.id, detail: `${where}: could not re-read (${(e instanceof Error ? e.message : "error").slice(0, 120)})` };
  }
}

export async function reconcilePayroll(sinceMs = 7 * 86_400_000, chainLimit = 20, now = Date.now()) {
  const since = new Date(now - sinceMs).toISOString();
  const findings: PayrollFinding[] = [];

  for (const f of await sbRpc<{ batch_id: string | null; line_id: string | null; problem: string }[]>("payroll_fee_reconcile", { p_since: since })) {
    findings.push({ kind: "fee_journal", batch: f.batch_id, detail: f.line_id ? `${f.problem} (line ${f.line_id})` : f.problem });
  }

  const executed = await sbSelect<BatchLine>("payroll_batch_lines", `executed_at=gte.${encodeURIComponent(since)}&order=executed_at.desc&limit=${chainLimit}`);
  const batchIds = [...new Set(executed.map(l => l.batch_id))];
  const batches = batchIds.length ? await sbSelect<Batch>("payroll_batches", `id=in.(${batchIds.join(",")})&limit=${batchIds.length}`) : [];
  const byId = new Map(batches.map(b => [b.id, b]));
  for (const l of executed) {
    const b = byId.get(l.batch_id); if (!b) continue;
    const f = await checkExecutedLine(l, b);
    if (f) findings.push(f);
  }

  const stale = new Date(now - 86_400_000).toISOString();
  const partial = await sbSelect<Batch>("payroll_batches", `status=eq.submitted&submitted_at=lt.${encodeURIComponent(stale)}&order=submitted_at.asc&limit=50`);
  for (const b of partial) {
    const lines = await sbSelect<BatchLine>("payroll_batch_lines", `batch_id=eq.${b.id}&select=id,executed_tx&limit=100`);
    const done = lines.filter(l => l.executed_tx).length;
    findings.push({ kind: "batch_partial", batch: b.id, detail: `${done} of ${lines.length} payments executed; submitted ${b.submitted_at}` });
  }

  for (const f of findings) {
    await raiseAlert({
      kind: `payroll.${f.kind}`,
      severity: f.kind === "execution_not_on_chain" || f.kind === "fee_journal" ? "critical" : f.kind === "chain_unavailable" ? "medium" : "high",
      title: f.kind === "fee_journal" ? "Payroll fee journal does not match executions"
        : f.kind === "execution_not_on_chain" ? "A recorded payroll payment is no longer on-chain as recorded"
        : f.kind === "batch_partial" ? "Payroll batch only partly executed" : "Payroll execution could not be re-verified",
      detail: f.detail,
      dimensions: { batch: f.batch ?? "books" },
      context: { batch: f.batch },
    });
  }
  return { findings: findings.length, byKind: findings.reduce<Record<string, number>>((m, f) => ({ ...m, [f.kind]: (m[f.kind] ?? 0) + 1 }), {}), linesChecked: executed.length };
}
