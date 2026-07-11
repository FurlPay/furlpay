import { kvListPush, kvListRange, kvIncrBy } from "@/lib/kv";
import type { Rail } from "@/lib/ops/controls";

// ---------------------------------------------------------------------------
// Unified ops event feed. Real money events from every rail append here, so
// the transaction explorer and security center read ONE durable ledger (Redis
// list via lib/kv) rather than fabricated data. Bounded; newest-first.
//
// Two streams:
//   ops:tx        settlement / money-movement records (all rails)
//   ops:security  replay / bad-signature / over-limit / tamper attempts
// Counters (ops:count:*) are incremented alongside so the overview shows
// real totals without scanning the whole list.
// ---------------------------------------------------------------------------

const TX_KEY = "ops:tx";
const SEC_KEY = "ops:security";
const MAX_TX = 5_000;
const MAX_SEC = 5_000;
const COUNTER_WINDOW = 60 * 60 * 24 * 90; // 90d rolling window for counters

export type TxState =
  | "settled"
  | "pending"
  | "failed"
  | "rejected";

export interface OpsTxEvent {
  id: string;
  rail: Rail;
  state: TxState;
  substate?: string;
  amountUsd?: number;
  feeUsd?: number;
  token?: string;
  sourceChain?: string;
  destChain?: string;
  payer?: string;
  recipient?: string;
  txHash?: string;
  userId?: string;
  ts: string;
}

export type SecuritySeverity = "info" | "low" | "medium" | "high" | "critical";
export interface OpsSecurityEvent {
  id: string;
  kind: string; // e.g. "replay_rejected", "bad_signature", "amount_over_limit", "quote_tamper"
  rail: Rail;
  severity: SecuritySeverity;
  detail: string;
  actor?: string; // wallet / ip (truncated by caller)
  ts: string;
  acknowledged?: boolean;
}

function id(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Append a money-movement event (fire-and-forget; never blocks settlement). */
export async function recordTxEvent(e: Omit<OpsTxEvent, "id" | "ts">): Promise<void> {
  const evt: OpsTxEvent = { ...e, id: id("tx"), ts: new Date().toISOString() };
  try {
    await kvListPush(TX_KEY, JSON.stringify(evt), MAX_TX);
    await kvIncrBy(`ops:count:tx:${e.rail}:${e.state}`, 1, COUNTER_WINDOW);
    if (typeof e.amountUsd === "number") await kvIncrBy(`ops:count:vol:${e.rail}`, Math.round(e.amountUsd * 100), COUNTER_WINDOW);
    if (typeof e.feeUsd === "number") await kvIncrBy(`ops:count:fee:${e.rail}`, Math.round(e.feeUsd * 100), COUNTER_WINDOW);
  } catch {
    /* ops feed is best-effort — a KV blip must not fail a real settlement */
  }
}

export async function recordSecurityEvent(e: Omit<OpsSecurityEvent, "id" | "ts">): Promise<void> {
  const evt: OpsSecurityEvent = { ...e, id: id("sec"), ts: new Date().toISOString() };
  try {
    await kvListPush(SEC_KEY, JSON.stringify(evt), MAX_SEC);
    await kvIncrBy(`ops:count:sec:${e.kind}`, 1, COUNTER_WINDOW);
  } catch {
    /* best-effort */
  }
}

function parseList<T>(rows: string[]): T[] {
  const out: T[] = [];
  for (const r of rows) {
    try { out.push(JSON.parse(r) as T); } catch { /* skip corrupt row */ }
  }
  return out;
}

export async function listTxEvents(limit = 200): Promise<OpsTxEvent[]> {
  return parseList<OpsTxEvent>(await kvListRange(TX_KEY, Math.min(limit, MAX_TX)));
}

export async function listSecurityEvents(limit = 200): Promise<OpsSecurityEvent[]> {
  return parseList<OpsSecurityEvent>(await kvListRange(SEC_KEY, Math.min(limit, MAX_SEC)));
}
