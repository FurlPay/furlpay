// ---------------------------------------------------------------------------
// Brokerage trade-event ingestion.
//
// A CORRECTION UP FRONT, because the architecture depends on it. Alpaca does
// NOT offer an HMAC-signed webhook for trade events. Its trade updates are a
// Server-Sent Events stream (`/v2/events/trades`), authenticated by the same
// API key headers as every other call and delivered over a long-lived
// connection. Building a `/api/webhooks/alpaca` route with a signature check
// would be inventing a contract the provider does not have — the endpoint
// would sit there verifying a header nobody sends.
//
// So this module is the transport-agnostic HALF: normalise, deduplicate,
// order-guard and apply. Three things can feed it, and all three converge here:
//
//   1. POLLING (the production path on serverless). A scheduled job reads open
//      orders back from the provider and feeds their current state through.
//      Unglamorous, and the only thing that works when no process can hold a
//      socket open for hours — which is exactly the case on Vercel functions.
//
//   2. SSE, from a long-lived worker outside the serverless runtime. Feeds the
//      same function, event for event.
//
//   3. A SIGNED WEBHOOK, for a future provider that offers one. `verifyHmac`
//      below is here for that case and is deliberately unused by Alpaca.
//
// WHY DEDUPLICATION IS NOT OPTIONAL. Alpaca's event stream is replayable by
// design — you reconnect with `since` and receive events you have already
// seen. Applying a `fill` twice would book the same shares twice. The dedupe
// key is the provider's own `execution_id` where present, because that is the
// only identifier guaranteed unique per execution; two partial fills of the
// same order share an order id and differ only there.
// ---------------------------------------------------------------------------

import { createHmac, timingSafeEqual } from "crypto";
import { kvGet, kvSet, kvSetNx } from "@/lib/kv";
import { log } from "@/lib/log";
import { applyProviderOrder, getOrderRecord, type OrderRecord } from "./orderStore";
import type { BrokerageOrder, OrderStatus } from "./types";

/** Events are retained long enough to cover any realistic replay window. */
const EVENT_TTL_SECONDS = 30 * 24 * 3600;
/** How long a claimed event id blocks a duplicate. */
const DEDUPE_TTL_SECONDS = 30 * 24 * 3600;

const eventKey = (id: string) => `brokerage:event:${id}`;
const dedupeKey = (id: string) => `brokerage:event:seen:${id}`;
const deadLetterKey = (id: string) => `brokerage:event:dead:${id}`;

/**
 * A normalised trade event.
 *
 * `raw` is kept verbatim. When a fill is disputed months later, the provider's
 * own payload is the evidence — a re-serialised version of our interpretation
 * of it is not.
 */
export interface TradeEvent {
  /** Stable, unique per event. See `eventIdFor`. */
  id: string;
  provider: string;
  /** The provider's own event name, unmapped. */
  kind: string;
  /** The order state this event implies. */
  status: OrderStatus;
  clientOrderId: string;
  providerOrderId: string | null;
  symbol: string;
  /** Cumulative filled quantity AFTER this event, as the provider reports it. */
  filledQty: number | null;
  filledAvgPrice: number | null;
  /** This execution's own quantity and price, when the event is a fill. */
  executionQty: number | null;
  executionPrice: number | null;
  /** Provider timestamp. The ordering guard reads it. */
  occurredAt: string | null;
  receivedAt: string;
  raw: unknown;
}

export type IngestOutcome =
  | { result: "applied"; record: OrderRecord }
  | { result: "duplicate" }
  | { result: "unknown_order" }
  | { result: "out_of_order"; detail: string }
  | { result: "rejected"; detail: string }
  | { result: "error"; detail: string };

/**
 * The dedupe identity of an event.
 *
 * `execution_id` first: it is unique per execution, and two partial fills of
 * one order are distinguishable ONLY by it. Falling back to the order id would
 * make the second partial fill look like a replay of the first and silently
 * drop real shares.
 *
 * Without one, the fallback composes order id + event kind + timestamp. Weaker,
 * but deterministic — the same event replayed produces the same key.
 */
export function eventIdFor(payload: {
  execution_id?: string | null;
  event?: string;
  at?: string | null;
  timestamp?: string | null;
  order?: { id?: string; client_order_id?: string };
}): string | null {
  if (payload.execution_id) return `exec:${payload.execution_id}`;
  const orderId = payload.order?.id ?? payload.order?.client_order_id;
  if (!orderId) return null;
  const at = payload.at ?? payload.timestamp ?? "";
  const kind = payload.event ?? "unknown";
  return `ord:${orderId}:${kind}:${at}`;
}

/**
 * Claim an event id.
 *
 * `kvSetNx` is atomic, so two workers racing on the same replayed event have
 * exactly one winner. A non-atomic get-then-set would let both pass and book
 * the fill twice — the precise bug this guard exists to prevent.
 *
 * A KV failure returns FALSE (treat as duplicate, do not apply). Skipping an
 * event costs a delay that the reconciler closes; applying one twice costs
 * money.
 */
async function claim(eventId: string): Promise<boolean> {
  try {
    return await kvSetNx(dedupeKey(eventId), 1, DEDUPE_TTL_SECONDS);
  } catch (e) {
    log.error("brokerage event dedupe unavailable — refusing to apply", {
      eventId,
      error: (e as Error).message,
    });
    return false;
  }
}

/** Persist the raw event before anything acts on it. */
async function persist(event: TradeEvent): Promise<void> {
  try {
    await kvSet(eventKey(event.id), event, EVENT_TTL_SECONDS);
  } catch (e) {
    // Not fatal: the order record is the operative state and reconciliation is
    // the backstop. Losing the audit copy is worth logging loudly, not
    // dropping a real fill over.
    log.error("brokerage event could not be persisted", { eventId: event.id, error: (e as Error).message });
  }
}

/** Park an event that could not be applied, for an operator to inspect. */
async function deadLetter(event: TradeEvent, reason: string): Promise<void> {
  try {
    await kvSet(deadLetterKey(event.id), { event, reason, at: new Date().toISOString() }, EVENT_TTL_SECONDS);
  } catch {
    /* already logged by the caller */
  }
  log.error("brokerage event dead-lettered", {
    eventId: event.id,
    clientOrderId: event.clientOrderId,
    reason,
  });
}

/**
 * Ingest one event.
 *
 * ORDER OF OPERATIONS, and each step is where it is for a reason:
 *
 *   1. claim  — atomic, before any side effect, so a replay stops here
 *   2. persist — the raw payload is evidence and is stored before it is acted on
 *   3. apply   — through the order store's state machine, which refuses an
 *                illegal transition rather than overwriting
 *
 * An event for an order we have never seen is NOT an error. It means the order
 * exists at the provider and not here — the single most important thing
 * reconciliation looks for — so it is dead-lettered loudly instead of being
 * silently dropped or, worse, used to conjure an order record we cannot
 * attribute to a user.
 */
export async function ingestTradeEvent(event: TradeEvent): Promise<IngestOutcome> {
  if (!(await claim(event.id))) return { result: "duplicate" };

  await persist(event);

  const record = await getOrderRecord(event.clientOrderId);
  if (!record) {
    await deadLetter(
      event,
      "No local order record. The provider has an order this deployment did not create, " +
        "or the record was lost. Reconciliation is required — an order cannot be attributed to a user from an event alone."
    );
    return { result: "unknown_order" };
  }

  // Ordering guard. Events arrive out of order routinely; the state machine in
  // applyProviderOrder catches backwards status moves, and this catches the
  // subtler case of an event that is simply older than what we already applied.
  if (event.occurredAt && record.updatedAt && event.occurredAt < record.updatedAt) {
    const stale = isStrictlyStale(event, record);
    if (stale) {
      return {
        result: "out_of_order",
        detail: `Event occurred at ${event.occurredAt}, older than the record's ${record.updatedAt}, and carries no new fill.`,
      };
    }
  }

  const asOrder = toBrokerageOrder(event, record);
  const applied = await applyProviderOrder(event.clientOrderId, asOrder, `event:${event.kind}`);

  if (!applied.applied) {
    if (applied.reason === "illegal_transition") {
      // Expected under replay and reordering — not an incident. Recorded so
      // a spike in these is visible, since a spike means something else.
      return {
        result: "out_of_order",
        detail: `${record.status} → ${asOrder.status} is not a legal transition; the event describes an earlier moment.`,
      };
    }
    await deadLetter(event, `Could not apply: ${applied.reason}`);
    return { result: "error", detail: applied.reason };
  }

  return { result: "applied", record: applied.record };
}

/**
 * Is this older event genuinely superseded?
 *
 * A late event that reports MORE filled quantity than we have recorded is not
 * stale in the way that matters — it carries information we are missing, and
 * dropping it on a timestamp comparison would lose a real fill. Only an event
 * that adds nothing is discarded.
 */
function isStrictlyStale(event: TradeEvent, record: OrderRecord): boolean {
  if (event.filledQty == null) return true;
  if (record.filledQty == null) return false;
  return event.filledQty <= record.filledQty;
}

/** Shape an event as the provider order view the store expects. */
function toBrokerageOrder(event: TradeEvent, record: OrderRecord): BrokerageOrder {
  return {
    clientOrderId: event.clientOrderId,
    providerOrderId: event.providerOrderId ?? record.providerOrderId,
    symbol: event.symbol || record.symbol,
    side: record.side,
    type: record.type as BrokerageOrder["type"],
    timeInForce: record.timeInForce as BrokerageOrder["timeInForce"],
    status: event.status,
    qty: record.qty,
    notional: record.notional,
    limitPrice: record.limitPrice,
    stopPrice: record.stopPrice,
    filledQty: event.filledQty,
    filledAvgPrice: event.filledAvgPrice,
    submittedAt: record.submittedAt,
    filledAt: event.status === "filled" ? event.occurredAt : null,
    canceledAt: event.status === "canceled" ? event.occurredAt : null,
    expiredAt: event.status === "expired" ? event.occurredAt : null,
    rejectReason: null,
    raw: event.raw,
  };
}

// ---------------------------------------------------------------------------
// Alpaca normalisation
// ---------------------------------------------------------------------------

/**
 * Alpaca trade-event names, mapped to our order statuses.
 *
 * Two entries deserve comment:
 *
 *   trade_bust     an execution was REVERSED by the exchange. It is not a
 *                  status change and must never be mapped to one — a busted
 *                  trade needs a compensating ledger entry, not a state
 *                  transition. It maps to `unknown` so it cannot quietly
 *                  advance an order, and is surfaced for a human.
 *   trade_correct  the price or quantity of a completed execution was amended.
 *                  Same treatment, same reason.
 */
const ALPACA_EVENT_STATUS: Record<string, OrderStatus> = {
  new: "accepted",
  accepted: "accepted",
  pending_new: "submitted",
  partial_fill: "partially_filled",
  fill: "filled",
  canceled: "canceled",
  expired: "expired",
  rejected: "rejected",
  done_for_day: "expired",
  replaced: "canceled",
  pending_cancel: "pending_cancel",
  pending_replace: "accepted",
  suspended: "accepted",
  calculated: "accepted",
  stopped: "accepted",
  order_cancel_rejected: "accepted",
  order_replace_rejected: "accepted",
  trade_bust: "unknown",
  trade_correct: "unknown",
};

/** Events that AMEND a completed execution rather than advancing an order.
 *  These require a compensating ledger entry and human review. */
export const AMENDING_EVENTS: ReadonlySet<string> = new Set(["trade_bust", "trade_correct"]);

interface AlpacaTradeEvent {
  event?: string;
  execution_id?: string | null;
  at?: string | null;
  timestamp?: string | null;
  price?: string | number | null;
  qty?: string | number | null;
  position_qty?: string | number | null;
  order?: {
    id?: string;
    client_order_id?: string;
    symbol?: string;
    status?: string;
    filled_qty?: string | null;
    filled_avg_price?: string | null;
  };
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalise one Alpaca trade event.
 *
 * Returns null when the payload carries no client order id — without one the
 * event cannot be attributed to an order we created, and guessing at the
 * attribution is how a fill lands on the wrong account.
 */
export function normalizeAlpacaEvent(payload: unknown): TradeEvent | null {
  const p = payload as AlpacaTradeEvent;
  const clientOrderId = p.order?.client_order_id;
  if (!clientOrderId) return null;

  const id = eventIdFor(p);
  if (!id) return null;

  const kind = (p.event ?? "unknown").toLowerCase();

  return {
    id,
    provider: "alpaca",
    kind,
    // The event name is authoritative for what just happened; the embedded
    // order status is a secondary read of the same fact. Prefer the event, and
    // fall back to the order's own status when the name is unrecognised.
    status: ALPACA_EVENT_STATUS[kind] ?? mapOrderStatus(p.order?.status),
    clientOrderId,
    providerOrderId: p.order?.id ?? null,
    symbol: (p.order?.symbol ?? "").toUpperCase(),
    filledQty: num(p.order?.filled_qty),
    filledAvgPrice: num(p.order?.filled_avg_price),
    executionQty: num(p.qty),
    executionPrice: num(p.price),
    occurredAt: p.at ?? p.timestamp ?? null,
    receivedAt: new Date().toISOString(),
    raw: payload,
  };
}

function mapOrderStatus(raw: string | undefined): OrderStatus {
  if (!raw) return "unknown";
  return ALPACA_EVENT_STATUS[raw.toLowerCase()] ?? "unknown";
}

// ---------------------------------------------------------------------------
// Signed-webhook verification, for a provider that offers one
// ---------------------------------------------------------------------------

/**
 * Constant-time HMAC-SHA256 verification over the RAW body, with a freshness
 * bound on the timestamp.
 *
 * Unused by Alpaca — see the header. It exists because the next brokerage
 * adapter may sign its callbacks, and a verification routine written under
 * deadline is a verification routine with a `==` in it.
 *
 * Two properties that a naive implementation misses:
 *   - the RAW body, not a re-serialised parse. `JSON.parse` then
 *     `JSON.stringify` reorders keys and changes whitespace, so the digest
 *     never matches and the fix people reach for is to stop verifying.
 *   - a timestamp bound. Without one, a captured valid request replays forever.
 */
export function verifyHmac(opts: {
  rawBody: string;
  signatureHeader: string | null;
  timestampHeader: string | null;
  secret: string;
  toleranceSeconds?: number;
}): { ok: true } | { ok: false; reason: string } {
  const { rawBody, signatureHeader, timestampHeader, secret, toleranceSeconds = 300 } = opts;
  if (!signatureHeader) return { ok: false, reason: "missing_signature" };
  if (!secret) return { ok: false, reason: "not_configured" };

  if (timestampHeader) {
    const ts = Number(timestampHeader);
    if (!Number.isFinite(ts)) return { ok: false, reason: "bad_timestamp" };
    const ageSeconds = Math.abs(Date.now() / 1000 - ts);
    if (ageSeconds > toleranceSeconds) return { ok: false, reason: "stale_timestamp" };
  }

  const signedPayload = timestampHeader ? `${timestampHeader}.${rawBody}` : rawBody;
  const expected = createHmac("sha256", secret).update(signedPayload).digest();

  let given: Buffer;
  try {
    given = Buffer.from(signatureHeader.replace(/^sha256=/, ""), "hex");
  } catch {
    return { ok: false, reason: "malformed_signature" };
  }

  // Length check first: timingSafeEqual THROWS on a length mismatch, and an
  // uncaught throw here is an unverified request taking down the route.
  if (given.length !== expected.length) return { ok: false, reason: "signature_mismatch" };
  if (!timingSafeEqual(given, expected)) return { ok: false, reason: "signature_mismatch" };
  return { ok: true };
}

/** Read a stored event back, for the ops console. */
export async function getStoredEvent(eventId: string): Promise<TradeEvent | null> {
  try {
    return await kvGet<TradeEvent>(eventKey(eventId));
  } catch {
    return null;
  }
}
