import { sbSelect } from "@/lib/supabase";
import { bvnkClient, BvnkApiError, type ClientDeps } from "./client";
import { bvnkApiConfig } from "./config";
import { decimalString } from "./amount";
import { isTerminal, recordFromTransfer, upsertBvnkRecord, type BvnkRecordRow } from "./records";

// Reconciliation: re-read every open transfer and payout from BVNK's API and
// record the authoritative state (source 'api'). Webhooks are notifications;
// this is the confirmation BVNK's own guidance asks for. Read-only towards
// BVNK, records-only towards FurlPay: it changes no balance and starts nothing.

const STALE_AFTER_MS = 10 * 60_000;
const PER_PASS = 50;

export type ReconcileResult = { checked: number; updated: number; unchanged: number; notFound: number; failed: number };

export async function reconcileOpenBvnkRecords(opts: { now?: number; expired?: () => boolean; deps?: ClientDeps } = {}): Promise<ReconcileResult> {
  const now = opts.now ?? Date.now();
  // Refuse up front without credentials (the cron answers 503) rather than
  // reading the table and counting every row as a failure.
  bvnkApiConfig(opts.deps?.env ?? process.env);
  const client = bvnkClient(opts.deps);
  const before = new Date(now - STALE_AFTER_MS).toISOString();
  const open = await sbSelect<BvnkRecordRow>("bvnk_records",
    `select=kind,provider_id,direction,status,provider_updated_at&kind=in.(transfer,payout)&provider_updated_at=lt.${encodeURIComponent(before)}&order=provider_updated_at.asc&limit=${PER_PASS * 4}`);
  const todo = open.filter((r) => !isTerminal(r.kind, r.status)).slice(0, PER_PASS);
  const out: ReconcileResult = { checked: 0, updated: 0, unchanged: 0, notFound: 0, failed: 0 };
  for (const r of todo) {
    if (opts.expired?.()) break;
    out.checked++;
    try {
      let row: BvnkRecordRow;
      if (r.kind === "transfer") {
        row = { ...recordFromTransfer(await client.getTransfer(r.provider_id), new Date(now).toISOString()), direction: r.direction };
      } else {
        const p = await client.getPayout(r.provider_id);
        row = {
          kind: "payout", provider_id: p.id, direction: r.direction, reference: p.reference ?? null, status: p.status, method: p.method,
          wallet_id: p.originator.walletId, originator_amount: decimalString(p.originator.amount, "originator.amount"), originator_currency: p.originator.currency,
          beneficiary_amount: decimalString(p.beneficiary.amount, "beneficiary.amount"), beneficiary_currency: p.beneficiary.currency,
          provider_updated_at: p.updatedAt, source: "api",
        };
      }
      (await upsertBvnkRecord(row)) === "stale" ? out.unchanged++ : out.updated++;
    } catch (e) {
      if (e instanceof BvnkApiError && e.httpStatus === 404) out.notFound++;
      else out.failed++;
    }
  }
  return out;
}
