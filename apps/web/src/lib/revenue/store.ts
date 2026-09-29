import { sbInsert, sbSelect, supabaseBackend } from "@/lib/supabase";
import { log } from "@/lib/log";
import type { RevenueEvent } from "./types";

// ---------------------------------------------------------------------------
// Persistence for revenue events.
//
// ── IDEMPOTENCY IS ENFORCED BY THE DATABASE, NOT BY A CHECK ────────────────
//
// The naive shape is "SELECT, and INSERT if absent". That is a read-modify-
// write with a gap in the middle, and two concurrent webhook redeliveries on
// two serverless instances both read absent and both insert. The row is the
// money, so the gap is a double count.
//
// Instead the event id IS the idempotency key (primary key), and a duplicate
// insert is REJECTED BY POSTGRES. The handler treats that rejection as
// success, because it means the event was already recorded — which is exactly
// what the caller wanted.
//
// This mirrors the pattern the settlement routes already rely on
// (dividend_once_per_user) and is the reason schemaProbe.ts exists: a
// constraint the code depends on has to be verified present, not assumed.
//
// ── APPEND-ONLY ────────────────────────────────────────────────────────────
//
// Nothing here updates or deletes. A refund does not mutate the original
// event; it appends a separate `reversed` event that negates it. Accounting
// records that can be edited cannot be audited, and "the number changed and
// nobody knows when" is not a state a payments company can be in.
// ---------------------------------------------------------------------------

const TABLE = "revenue_events";

/**
 * Process-local fallback used when no Supabase backend is configured (local
 * dev, tests, the in-memory demo store). Same idempotency semantics — first
 * write wins — so behaviour does not change shape between environments, but it
 * is per-instance and non-durable, which is why `durable()` is exported for
 * callers and the ops surface to report honestly.
 */
const memory = new Map<string, RevenueEvent>();

export function revenueDurable(): boolean {
  return supabaseBackend === "supabase";
}

/** Reset the in-memory store. Tests only. */
export function __resetRevenueMemory(): void {
  memory.clear();
}

interface RevenueRow {
  id: string;
  created_at: string;
  user_id: string | null;
  organization_id: string | null;
  source: string;
  engine: string;
  status: string;
  asset: string;
  chain: string | null;
  fee_minor: string;
  volume_minor: string | null;
  fee_bps: number | null;
  external_ref: string | null;
  metadata: Record<string, unknown> | null;
}

function toRow(e: RevenueEvent): RevenueRow {
  return {
    id: e.id,
    created_at: new Date(e.createdAt).toISOString(),
    user_id: e.userId,
    organization_id: e.organizationId,
    source: e.source,
    engine: e.engine,
    status: e.status,
    asset: e.asset,
    chain: e.chain,
    fee_minor: e.feeMinor,
    volume_minor: e.volumeMinor,
    fee_bps: e.feeBps,
    external_ref: e.externalRef,
    metadata: e.metadata,
  };
}

function fromRow(r: RevenueRow): RevenueEvent {
  return {
    id: r.id,
    createdAt: Date.parse(r.created_at),
    userId: r.user_id,
    organizationId: r.organization_id,
    source: r.source as RevenueEvent["source"],
    engine: r.engine as RevenueEvent["engine"],
    status: r.status as RevenueEvent["status"],
    asset: r.asset,
    chain: r.chain,
    feeMinor: r.fee_minor,
    volumeMinor: r.volume_minor,
    feeBps: r.fee_bps,
    externalRef: r.external_ref,
    metadata: (r.metadata ?? {}) as RevenueEvent["metadata"],
  };
}

/** A unique-violation from Postgres — the event already exists. */
function isDuplicate(e: unknown): boolean {
  const msg = (e as Error)?.message ?? "";
  // PostgREST surfaces 23505 (unique_violation) with the constraint name.
  return /23505|duplicate key|already exists/i.test(msg);
}

export interface WriteOutcome {
  /** True when this call created the row; false when it already existed. */
  created: boolean;
  /** False when the write could not be persisted durably. */
  durable: boolean;
}

/**
 * Append an event. Safe to call repeatedly with the same id.
 *
 * Returns `created: false` for a duplicate rather than throwing, because every
 * caller is a webhook or a retry-able handler for which "already recorded" is
 * the success case. Throwing would push them toward swallowing errors, which
 * is how a genuine write failure becomes invisible.
 */
export async function appendRevenueEvent(event: RevenueEvent): Promise<WriteOutcome> {
  if (!revenueDurable()) {
    if (memory.has(event.id)) return { created: false, durable: false };
    memory.set(event.id, event);
    return { created: true, durable: false };
  }

  try {
    await sbInsert<RevenueRow>(TABLE, toRow(event));
    return { created: true, durable: true };
  } catch (e) {
    if (isDuplicate(e)) return { created: false, durable: true };
    // A real write failure. Surfaced, not swallowed: an unrecorded fee is a
    // reporting hole, and silently dropping it is how the books drift.
    log.error("revenue event write failed", {
      id: event.id,
      source: event.source,
      error: (e as Error).message,
    });
    throw e;
  }
}

export interface RevenueQuery {
  /** Inclusive lower bound, epoch millis. */
  from?: number;
  /** Exclusive upper bound, epoch millis. */
  to?: number;
  limit?: number;
}

/** Read events for aggregation. Newest first. */
export async function listRevenueEvents(q: RevenueQuery = {}): Promise<RevenueEvent[]> {
  const limit = Math.min(q.limit ?? 5000, 20_000);

  if (!revenueDurable()) {
    return [...memory.values()]
      .filter((e) => (q.from == null || e.createdAt >= q.from) && (q.to == null || e.createdAt < q.to))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  const parts = [`order=created_at.desc`, `limit=${limit}`];
  if (q.from != null) parts.push(`created_at=gte.${new Date(q.from).toISOString()}`);
  if (q.to != null) parts.push(`created_at=lt.${new Date(q.to).toISOString()}`);
  const rows = await sbSelect<RevenueRow>(TABLE, parts.join("&"));
  return rows.map(fromRow);
}
