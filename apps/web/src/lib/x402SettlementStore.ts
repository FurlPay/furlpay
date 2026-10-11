import { kvGet, kvSet, kvZAdd, kvZRangeByScore, kvZRem } from "@/lib/kv";

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

/**
 * How long a settlement may stay "pending" before it stops being a wait and
 * becomes an incident.
 *
 * A pending record means the transaction was SUBMITTED — the payer may already
 * be debited and the EIP-3009 nonce is burned either way — but the settler
 * never observed the required depth. On Arbitrum One (~0.25s blocks) a healthy
 * settlement resolves in seconds, so anything still unresolved after this
 * window is not slow, it is dropped, replaced, or stuck. Leaving it "pending"
 * forever is the state that has no owner: the client polls indefinitely and
 * nobody is paged. `abandoned` is terminal and operator-actionable.
 */
export const PENDING_TIMEOUT_MS = 30 * 60_000; // 30 minutes

export type SettlementStatus = "confirmed" | "pending" | "replaced" | "abandoned";

/**
 * The exact EIP-3009 effect we must find in the receipt before a pending
 * settlement can become confirmed. `valueAtomic` stays a decimal string so
 * the durable JSON record does not lose precision.
 */
export interface SettlementExpectedTransfer {
  token: string;
  from: string;
  to: string;
  valueAtomic: string;
  nonce: string;
}

export interface SettlementRecord {
  transaction: string;
  network: string;
  payer: string;
  payTo: string;
  amountAtomic: string;
  /** Persisted at submission time; recovery must never infer this from a receipt. */
  expectedTransfer: SettlementExpectedTransfer;
  resource: string;
  settledAt: string;
  /**
   * "confirmed"  required depth observed — the payment is final.
   * "pending"    submitted on-chain but depth not yet observed; may still
   *              confirm, so the client polls rather than re-signing.
   * "replaced"   a different transaction from the same sender took this
   *              nonce (RBF / speed-up / cancel). The original hash can NEVER
   *              confirm, so polling it forever is pointless; `replacedBy`
   *              carries the hash that actually matters.
   * "abandoned"  still unresolved past PENDING_TIMEOUT_MS. Needs a human.
   * Absent = confirmed (records written before this field existed).
   */
  status?: SettlementStatus;
  /** The transaction that replaced this one, when status is "replaced". */
  replacedBy?: string;
  /** Why it was abandoned — put straight into an alert. */
  abandonedReason?: string;
}

/**
 * Has this pending settlement been waiting long enough to be an incident?
 *
 * Compared against `settledAt`, which is stamped at SUBMISSION for a pending
 * record — the moment the money may have started moving, which is the clock
 * that matters, not the moment we last looked.
 */
export function pendingExpired(record: SettlementRecord, now: number = Date.now()): boolean {
  if (record.status !== "pending") return false;
  const submittedAt = Date.parse(record.settledAt);
  if (!Number.isFinite(submittedAt)) return false;
  return now - submittedAt > PENDING_TIMEOUT_MS;
}

function settlementKey(tx: string): string {
  return `x402fac:settlement:${tx}`;
}

export async function getSettlement(tx: string): Promise<SettlementRecord | undefined> {
  return (await kvGet<SettlementRecord>(settlementKey(tx))) ?? undefined;
}

// Per-network indexes, so the settlement safety controller can answer "what is
// still unresolved on this network?" (recovery is blocked while anything is)
// and the reconciler can re-check recent confirmations for reorgs. Both are
// scored by submission time and maintained here, at the one write path, so no
// caller can update a record without updating its index.
export const unresolvedIndexKey = (network: string) => `x402fac:unresolved:${network}`;
export const confirmedIndexKey = (network: string) => `x402fac:confirmed:${network}`;

export async function recordSettlement(record: SettlementRecord): Promise<void> {
  await kvSet(settlementKey(record.transaction), record, SETTLEMENT_TTL_SECONDS);
  const score = Date.parse(record.settledAt) || Date.now();
  const status = record.status ?? "confirmed";
  if (status === "pending" || status === "abandoned") {
    await kvZAdd(unresolvedIndexKey(record.network), score, record.transaction);
    await kvZRem(confirmedIndexKey(record.network), [record.transaction]);
  } else {
    await kvZRem(unresolvedIndexKey(record.network), [record.transaction]);
    if (status === "confirmed") await kvZAdd(confirmedIndexKey(record.network), score, record.transaction);
    else await kvZRem(confirmedIndexKey(record.network), [record.transaction]);
  }
}

/** Settlements on `network` with no confirmed outcome (pending or abandoned). */
export async function unresolvedSettlements(network: string): Promise<string[]> {
  return kvZRangeByScore(unresolvedIndexKey(network), "-inf", "+inf");
}

/** Confirmed settlements submitted at or after `sinceMs`, oldest first. */
export async function recentConfirmedSettlements(network: string, sinceMs: number): Promise<string[]> {
  return kvZRangeByScore(confirmedIndexKey(network), sinceMs, "+inf");
}
