import { randomUUID } from "crypto";
import { kvListPush, kvListRange, kvIncrBy } from "@/lib/kv";
import type { Rail } from "@/lib/ops/controls";
import { sbInsert, sbSelect, supabaseBackend } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Unified ops event feed. Supabase is the append-only durable record when
// configured; Redis remains the bounded, newest-first hot feed for dashboards
// and counters. No fabricated data is written here.
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
  | "prepared"
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
  return `${prefix}_${randomUUID()}`;
}

interface OpsTxEventRow {
  id: string;
  rail: Rail;
  state: TxState;
  substate: string | null;
  amount_usd: number | string | null;
  fee_usd: number | string | null;
  token: string | null;
  source_chain: string | null;
  dest_chain: string | null;
  payer: string | null;
  recipient: string | null;
  tx_hash: string | null;
  user_id: string | null;
  created_at: string;
}

interface OpsSecurityEventRow {
  id: string;
  kind: string;
  rail: Rail;
  severity: SecuritySeverity;
  detail: string;
  actor: string | null;
  created_at: string;
  acknowledged: boolean;
}

const maybeNumber = (value: number | string | null): number | undefined =>
  value === null ? undefined : Number(value);

function txEventFromRow(row: OpsTxEventRow): OpsTxEvent {
  return {
    id: row.id,
    rail: row.rail,
    state: row.state,
    substate: row.substate ?? undefined,
    amountUsd: maybeNumber(row.amount_usd),
    feeUsd: maybeNumber(row.fee_usd),
    token: row.token ?? undefined,
    sourceChain: row.source_chain ?? undefined,
    destChain: row.dest_chain ?? undefined,
    payer: row.payer ?? undefined,
    recipient: row.recipient ?? undefined,
    txHash: row.tx_hash ?? undefined,
    userId: row.user_id ?? undefined,
    ts: row.created_at,
  };
}

function securityEventFromRow(row: OpsSecurityEventRow): OpsSecurityEvent {
  return {
    id: row.id,
    kind: row.kind,
    rail: row.rail,
    severity: row.severity,
    detail: row.detail,
    actor: row.actor ?? undefined,
    ts: row.created_at,
    acknowledged: row.acknowledged,
  };
}

async function persistTxEvent(evt: OpsTxEvent): Promise<void> {
  if (supabaseBackend !== "supabase") return;
  await sbInsert<OpsTxEventRow>("ops_tx_events", {
    id: evt.id,
    rail: evt.rail,
    state: evt.state,
    substate: evt.substate ?? null,
    amount_usd: evt.amountUsd ?? null,
    fee_usd: evt.feeUsd ?? null,
    token: evt.token ?? null,
    source_chain: evt.sourceChain ?? null,
    dest_chain: evt.destChain ?? null,
    payer: evt.payer ?? null,
    recipient: evt.recipient ?? null,
    tx_hash: evt.txHash ?? null,
    user_id: evt.userId ?? null,
    created_at: evt.ts,
  });
}

async function persistSecurityEvent(evt: OpsSecurityEvent): Promise<void> {
  if (supabaseBackend !== "supabase") return;
  await sbInsert<OpsSecurityEventRow>("ops_security_events", {
    id: evt.id,
    kind: evt.kind,
    rail: evt.rail,
    severity: evt.severity,
    detail: evt.detail,
    actor: evt.actor ?? null,
    created_at: evt.ts,
    acknowledged: !!evt.acknowledged,
  });
}

/** Append an ops transaction event. Critical callers can require Supabase
 *  durability before returning success; Redis stays best-effort hot telemetry. */
export async function recordTxEvent(e: Omit<OpsTxEvent, "id" | "ts">, opts: { requireDurable?: boolean } = {}): Promise<void> {
  const evt: OpsTxEvent = { ...e, id: id("tx"), ts: new Date().toISOString() };
  try {
    await persistTxEvent(evt);
  } catch (err) {
    if (opts.requireDurable) throw err;
  }
  try {
    await kvListPush(TX_KEY, JSON.stringify(evt), MAX_TX);
    await kvIncrBy(`ops:count:tx:${e.rail}:${e.state}`, 1, COUNTER_WINDOW);
    if (typeof e.amountUsd === "number") await kvIncrBy(`ops:count:vol:${e.rail}`, Math.round(e.amountUsd * 100), COUNTER_WINDOW);
    if (typeof e.feeUsd === "number") await kvIncrBy(`ops:count:fee:${e.rail}`, Math.round(e.feeUsd * 100), COUNTER_WINDOW);
  } catch {
    /* ops feed is best-effort — a KV blip must not fail a real settlement */
  }
}

export async function recordSecurityEvent(e: Omit<OpsSecurityEvent, "id" | "ts">, opts: { requireDurable?: boolean } = {}): Promise<void> {
  const evt: OpsSecurityEvent = { ...e, id: id("sec"), ts: new Date().toISOString() };
  try {
    await persistSecurityEvent(evt);
  } catch (err) {
    if (opts.requireDurable) throw err;
  }
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
  if (supabaseBackend === "supabase") {
    try {
      const rows = await sbSelect<OpsTxEventRow>(
        "ops_tx_events",
        `select=*&order=created_at.desc&limit=${Math.min(limit, MAX_TX)}`
      );
      return rows.map(txEventFromRow);
    } catch {
      /* fall back to Redis hot feed */
    }
  }
  return parseList<OpsTxEvent>(await kvListRange(TX_KEY, Math.min(limit, MAX_TX)));
}

export async function listSecurityEvents(limit = 200): Promise<OpsSecurityEvent[]> {
  if (supabaseBackend === "supabase") {
    try {
      const rows = await sbSelect<OpsSecurityEventRow>(
        "ops_security_events",
        `select=*&order=created_at.desc&limit=${Math.min(limit, MAX_SEC)}`
      );
      return rows.map(securityEventFromRow);
    } catch {
      /* fall back to Redis hot feed */
    }
  }
  return parseList<OpsSecurityEvent>(await kvListRange(SEC_KEY, Math.min(limit, MAX_SEC)));
}
