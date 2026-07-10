import { kvGet, kvSet } from "@/lib/kv";

// ---------------------------------------------------------------------------
// Durable x402 settlement log, backed by Redis (lib/kv.ts). Split out of
// x402Facilitator so BOTH settlement paths can write it without an import
// cycle: x402Facilitator runtime-imports x402 (X402_VERSION at module eval),
// so x402.ts must never runtime-import x402Facilitator back — this module has
// no x402 imports at all.
//
// Serves GET /api/x402/settlement/[tx] — including the recovery poll for a
// settlement that was SUBMITTED on-chain but timed out before the settler
// observed the required confirmation depth ("pending").
// ---------------------------------------------------------------------------

const SETTLEMENT_TTL_SECONDS = 60 * 60 * 24 * 30; // 30d settlement receipt retention

export interface SettlementRecord {
  transaction: string;
  network: string;
  payer: string;
  payTo: string;
  amountAtomic: string;
  resource: string;
  settledAt: string;
  /** "confirmed" = required depth observed; "pending" = submitted on-chain but
   *  the settler timed out before observing depth (may still confirm — the
   *  client recovers via GET /api/x402/settlement/[tx]). Absent = confirmed
   *  (records written before this field existed). */
  status?: "confirmed" | "pending";
}

function settlementKey(tx: string): string {
  return `x402fac:settlement:${tx}`;
}

export async function getSettlement(tx: string): Promise<SettlementRecord | undefined> {
  return (await kvGet<SettlementRecord>(settlementKey(tx))) ?? undefined;
}

export async function recordSettlement(record: SettlementRecord): Promise<void> {
  await kvSet(settlementKey(record.transaction), record, SETTLEMENT_TTL_SECONDS);
}
