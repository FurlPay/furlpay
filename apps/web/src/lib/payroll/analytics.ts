import { sbSelect } from "@/lib/supabase";
import { requireStorage } from "./repository";
import type { Batch, BatchLine, PayrollChain } from "./model";

// Payroll analytics for one employer, computed from what is stored — nothing
// estimated, nothing projected.
//
// Three different amounts, never mixed:
//   paid      — lines with executed_tx: the server re-read the receipt on the
//               batch's chain and matched the PaymentExecuted event to what the
//               employer signed (lib/payroll/execution.ts). The only figure
//               that means money moved.
//   pending   — lines of submitted batches not yet executed: signing requests.
//   prepared  — gross of draft and blocked batches: nothing issued yet.
// Fees are the QUOTES recorded with each batch; billing is not connected, so
// they are reported as quoted, not charged. Cancelled batches count nowhere.
// Amounts are USDC micro-units as decimal strings (BigInt-safe).

const eq = (v: string) => encodeURIComponent(v);
type LineRow = Pick<BatchLine, "batch_id" | "contractor_id" | "name" | "amount_units" | "executed_tx" | "executed_at">;

export type CycleSummary = { cycle: string; batches: number; paidUnits: string; pendingUnits: string; preparedUnits: string; quotedFeeUnits: string; paidLines: number };
export type ContractorSummary = { contractorId: string | null; name: string; paidUnits: string; paidLines: number; lastPaidAt: string | null };
export type PayrollAnalytics = {
  from: string;
  totals: { paidUnits: string; pendingUnits: string; preparedUnits: string; quotedFeeUnits: string; batches: number; paidLines: number };
  byStatus: Record<string, number>;
  byChain: Partial<Record<PayrollChain, { paidUnits: string; batches: number }>>;
  byCycle: CycleSummary[];
  topContractors: ContractorSummary[];
};

/** First cycle (YYYY-MM) of a window of `months` months ending this month (UTC). */
export function windowStart(months: number, now = Date.now()): string {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - (months - 1), 1)).toISOString().slice(0, 7);
}

/** Pure aggregation; separated from storage so it is testable on fixtures. */
export function summarize(from: string, batches: Batch[], lines: LineRow[], topN = 10): PayrollAnalytics {
  const live = batches.filter((b) => b.status !== "cancelled");
  const status = new Map(live.map((b) => [b.id, b]));
  const byStatus: Record<string, number> = {};
  for (const b of batches) byStatus[b.status] = (byStatus[b.status] ?? 0) + 1;

  const cycles = new Map<string, { batches: number; paid: bigint; pending: bigint; prepared: bigint; fee: bigint; paidLines: number }>();
  const cyc = (c: string) => {
    let v = cycles.get(c);
    if (!v) cycles.set(c, (v = { batches: 0, paid: 0n, pending: 0n, prepared: 0n, fee: 0n, paidLines: 0 }));
    return v;
  };
  const chains = new Map<PayrollChain, { paid: bigint; batches: number }>();
  for (const b of live) {
    const c = cyc(b.cycle);
    c.batches++;
    c.fee += BigInt(String(b.batch_fee_units)) + BigInt(String(b.seat_fee_units));
    if (b.status === "draft" || b.status === "blocked") c.prepared += BigInt(String(b.gross_units));
    const ch = chains.get(b.chain) ?? { paid: 0n, batches: 0 };
    ch.batches++;
    chains.set(b.chain, ch);
  }

  const people = new Map<string, { contractorId: string | null; name: string; paid: bigint; n: number; last: string | null }>();
  for (const l of lines) {
    const b = status.get(l.batch_id);
    if (!b) continue; // a cancelled batch, or one outside the window
    const units = BigInt(String(l.amount_units));
    const c = cyc(b.cycle);
    if (l.executed_tx) {
      c.paid += units;
      c.paidLines++;
      chains.get(b.chain)!.paid += units;
      const key = l.contractor_id ?? `name:${l.name}`;
      const p = people.get(key) ?? { contractorId: l.contractor_id, name: l.name, paid: 0n, n: 0, last: null };
      p.paid += units;
      p.n++;
      if (l.executed_at && (!p.last || l.executed_at > p.last)) p.last = l.executed_at;
      people.set(key, p);
    } else if (b.status === "submitted" || b.status === "submitting") {
      c.pending += units;
    }
  }

  const byCycle: CycleSummary[] = [...cycles.entries()].sort(([a], [b]) => (a < b ? 1 : -1)).map(([cycle, v]) => ({
    cycle, batches: v.batches, paidUnits: v.paid.toString(), pendingUnits: v.pending.toString(),
    preparedUnits: v.prepared.toString(), quotedFeeUnits: v.fee.toString(), paidLines: v.paidLines,
  }));
  const sum = (k: "paid" | "pending" | "prepared" | "fee") => [...cycles.values()].reduce((s, v) => s + v[k], 0n).toString();
  return {
    from,
    totals: {
      paidUnits: sum("paid"), pendingUnits: sum("pending"), preparedUnits: sum("prepared"), quotedFeeUnits: sum("fee"),
      batches: live.length, paidLines: [...cycles.values()].reduce((s, v) => s + v.paidLines, 0),
    },
    byStatus,
    byChain: Object.fromEntries([...chains.entries()].map(([k, v]) => [k, { paidUnits: v.paid.toString(), batches: v.batches }])),
    byCycle,
    topContractors: [...people.values()]
      .sort((a, b) => (a.paid === b.paid ? 0 : a.paid > b.paid ? -1 : 1))
      .slice(0, topN)
      .map((p) => ({ contractorId: p.contractorId, name: p.name, paidUnits: p.paid.toString(), paidLines: p.n, lastPaidAt: p.last })),
  };
}

const MAX_BATCHES = 500;

export async function payrollAnalytics(owner: string, months: number, now = Date.now()): Promise<PayrollAnalytics & { truncated: boolean }> {
  requireStorage();
  const from = windowStart(months, now);
  const batches = await sbSelect<Batch>("payroll_batches",
    `select=id,merchant_id,cycle,chain,status,headcount,gross_units,batch_fee_units,seat_fee_units,total_quote_units,created_at,submitted_at&merchant_id=eq.${eq(owner)}&cycle=gte.${eq(from)}&order=created_at.desc&limit=${MAX_BATCHES}`);
  const lines: LineRow[] = [];
  // Lines are fetched per chunk of batch ids so no request URL grows unbounded.
  const ids = batches.filter((b) => b.status !== "cancelled").map((b) => b.id);
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    lines.push(...(await sbSelect<LineRow>("payroll_batch_lines",
      `select=batch_id,contractor_id,name,amount_units,executed_tx,executed_at&batch_id=in.(${chunk.map(eq).join(",")})&limit=5000`)));
  }
  return { ...summarize(from, batches, lines), truncated: batches.length >= MAX_BATCHES };
}
