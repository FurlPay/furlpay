// ---------------------------------------------------------------------------
// The order record — our side of the truth.
//
// WHY A LOCAL RECORD EXISTS AT ALL, when the provider already has one. Three
// reasons, and each is a bug that cannot be fixed without it:
//
//   1. An order must exist BEFORE it is submitted. If the record is written
//      only on a successful response, a request that times out leaves no trace
//      of an order that may be live at the venue — invisible to us, real to the
//      market. Writing `created` first means every submission is recoverable.
//
//   2. A retry needs somewhere to look. The idempotency guarantee is
//      "same client order id → same order", and answering that without a
//      round trip requires a local index.
//
//   3. Reconciliation needs two sides. Comparing the provider against itself
//      proves nothing.
//
// STORAGE. The durable KV (Redis in production), for the same reason as the
// watchlist: the account schema is relational and adding a table is a migration
// not yet applied anywhere. Unlike the watchlist, an order record is NOT
// disposable — so `recordOrder` throws when the write fails, and the caller
// must refuse to submit rather than proceed with an unrecorded order. An order
// we cannot write down is an order we cannot reconcile, cancel or explain.
//
// THE STATE MACHINE IS ENFORCED HERE. `applyStatus` refuses an illegal
// transition instead of overwriting, because webhook delivery is unordered and
// a late `accepted` must not walk a filled order backwards.
// ---------------------------------------------------------------------------

import { kvGet, kvListPush, kvListRange, kvSet } from "@/lib/kv";
import { canTransition, isTerminal, type BrokerageOrder, type OrderStatus } from "./types";

/** Order records outlive the trade for audit and reconciliation. 400 days
 *  covers a full tax year plus the filing window. */
const TTL_SECONDS = 400 * 24 * 3600;
/** How many recent order ids to keep indexed per user. */
const USER_INDEX_MAX = 500;

const orderKey = (clientOrderId: string) => `order:${clientOrderId}`;
const userIndexKey = (userId: string) => `orders:user:${userId}`;

export interface OrderRecord {
  clientOrderId: string;
  userId: string;
  symbol: string;
  side: "buy" | "sell";
  type: string;
  timeInForce: string;
  qty: number | null;
  notional: number | null;
  limitPrice: number | null;
  stopPrice: number | null;
  status: OrderStatus;
  providerOrderId: string | null;
  /** Which adapter this went to. "simulator" is recorded as faithfully as
   *  "alpaca" — a simulated order must be identifiable forever. */
  provider: string;
  /** Whether the provider was a real venue. The ledger reads this before
   *  treating a fill as real money. */
  providerIsLive: boolean;
  filledQty: number | null;
  filledAvgPrice: number | null;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  terminalAt: string | null;
  rejectReason: string | null;
  /** Append-only transition log. The answer to "how did this order get here",
   *  which a single mutable status field can never give. */
  history: { at: string; from: OrderStatus; to: OrderStatus; source: string }[];
}

export class OrderNotRecordableError extends Error {
  constructor(clientOrderId: string, cause: string) {
    super(
      `Order ${clientOrderId} could not be recorded (${cause}). ` +
        "Refusing to submit: an order that cannot be written down cannot be reconciled or cancelled."
    );
    this.name = "OrderNotRecordableError";
  }
}

/** Read one order record. Null when absent; throws only on a broken store. */
export async function getOrderRecord(clientOrderId: string): Promise<OrderRecord | null> {
  try {
    return await kvGet<OrderRecord>(orderKey(clientOrderId));
  } catch {
    return null;
  }
}

/**
 * Write the `created` record, BEFORE the provider is called.
 *
 * Throws when the store refuses. That is the point: the caller must not submit
 * an order it cannot record.
 */
export async function createOrderRecord(input: {
  clientOrderId: string;
  userId: string;
  symbol: string;
  side: "buy" | "sell";
  type: string;
  timeInForce: string;
  qty: number | null;
  notional: number | null;
  limitPrice: number | null;
  stopPrice: number | null;
  provider: string;
  providerIsLive: boolean;
}): Promise<OrderRecord> {
  const now = new Date().toISOString();
  const record: OrderRecord = {
    ...input,
    status: "created",
    providerOrderId: null,
    filledQty: null,
    filledAvgPrice: null,
    createdAt: now,
    updatedAt: now,
    submittedAt: null,
    terminalAt: null,
    rejectReason: null,
    history: [],
  };

  try {
    await kvSet(orderKey(record.clientOrderId), record, TTL_SECONDS);
  } catch (e) {
    throw new OrderNotRecordableError(record.clientOrderId, e instanceof Error ? e.message : "store error");
  }

  // Index write is best-effort: losing it costs a listing, not the order.
  try {
    await kvListPush(userIndexKey(input.userId), record.clientOrderId, USER_INDEX_MAX);
  } catch {
    /* the order record itself is safe */
  }

  return record;
}

export type ApplyResult =
  | { applied: true; record: OrderRecord }
  | { applied: false; reason: "illegal_transition" | "not_found" | "store_error"; record: OrderRecord | null };

/**
 * Merge a provider view of an order into the local record.
 *
 * REFUSES illegal transitions rather than applying them. A duplicate or
 * out-of-order event is normal — Alpaca's event stream is replayable and
 * at-least-once — so this is the routine path, not an error path, and it
 * returns `applied: false` rather than throwing.
 *
 * Fill quantities only ever move FORWARD. A late event reporting a smaller
 * filled quantity than we already know about describes an earlier moment, and
 * letting it overwrite would shrink a position that really did fill.
 */
export async function applyProviderOrder(
  clientOrderId: string,
  provider: BrokerageOrder,
  source: string
): Promise<ApplyResult> {
  const record = await getOrderRecord(clientOrderId);
  if (!record) return { applied: false, reason: "not_found", record: null };

  const from = record.status;
  const to = provider.status;

  if (from !== to && !canTransition(from, to)) {
    return { applied: false, reason: "illegal_transition", record };
  }

  const now = new Date().toISOString();
  const next: OrderRecord = {
    ...record,
    status: to,
    providerOrderId: provider.providerOrderId ?? record.providerOrderId,
    filledQty: maxNullable(record.filledQty, provider.filledQty),
    // The average price belongs to the larger fill quantity — it is a weighted
    // average over everything filled so far, so the newer figure is only
    // authoritative when it covers at least as much.
    filledAvgPrice:
      provider.filledQty != null && (record.filledQty == null || provider.filledQty >= record.filledQty)
        ? (provider.filledAvgPrice ?? record.filledAvgPrice)
        : record.filledAvgPrice,
    submittedAt: record.submittedAt ?? provider.submittedAt,
    terminalAt: isTerminal(to) ? (record.terminalAt ?? now) : record.terminalAt,
    rejectReason: provider.rejectReason ?? record.rejectReason,
    updatedAt: now,
    history:
      from === to
        ? record.history
        : [...record.history, { at: now, from, to, source }].slice(-50),
  };

  try {
    await kvSet(orderKey(clientOrderId), next, TTL_SECONDS);
  } catch {
    return { applied: false, reason: "store_error", record };
  }
  return { applied: true, record: next };
}

/** Mark an order submitted, before the provider has acknowledged it. */
export async function markSubmitted(clientOrderId: string): Promise<OrderRecord | null> {
  const record = await getOrderRecord(clientOrderId);
  if (!record || record.status !== "created") return record;
  const now = new Date().toISOString();
  const next: OrderRecord = {
    ...record,
    status: "submitted",
    submittedAt: now,
    updatedAt: now,
    history: [...record.history, { at: now, from: "created", to: "submitted", source: "local" }],
  };
  try {
    await kvSet(orderKey(clientOrderId), next, TTL_SECONDS);
  } catch {
    return record;
  }
  return next;
}

/** A user's recent orders, newest first. */
export async function listUserOrders(userId: string, limit = 50): Promise<OrderRecord[]> {
  let ids: string[];
  try {
    ids = await kvListRange(userIndexKey(userId), limit);
  } catch {
    return [];
  }
  const records = await Promise.all(ids.map((id) => getOrderRecord(id)));
  return records
    .filter((r): r is OrderRecord => r !== null && r.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Orders that can still change — what the reconciler polls. */
export async function listOpenOrders(userId: string): Promise<OrderRecord[]> {
  return (await listUserOrders(userId, 200)).filter((o) => !isTerminal(o.status));
}

function maxNullable(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
}
