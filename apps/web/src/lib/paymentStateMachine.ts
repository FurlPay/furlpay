// ---------------------------------------------------------------------------
// Payment state machine (Circle / Coinbase pattern). Replaces ad-hoc status
// strings with an explicit finite-state machine so an illegal transition
// (e.g. COMPLETED → PROCESSING, or reversing a FAILED payment) throws instead
// of silently corrupting a record. Terminal states have no outgoing edges.
//
// The Transaction.status the UI shows (`settled | pending | escrow | declined`)
// is a projection of these states — see toTxStatus(). This module is the
// authority for what transitions are legal.
// ---------------------------------------------------------------------------

export type PaymentState =
  | "CREATED"
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "REVERSED"
  | "EXPIRED";

export type PaymentEvent = "SUBMIT" | "BROADCAST" | "CONFIRM" | "FAIL" | "REVERSE" | "EXPIRE";

/** Legal (state → event → next state) edges. Anything absent is illegal. */
const TRANSITIONS: Record<PaymentState, Partial<Record<PaymentEvent, PaymentState>>> = {
  CREATED: { SUBMIT: "PENDING", EXPIRE: "EXPIRED", FAIL: "FAILED" },
  PENDING: { BROADCAST: "PROCESSING", FAIL: "FAILED", EXPIRE: "EXPIRED" },
  PROCESSING: { CONFIRM: "COMPLETED", FAIL: "FAILED" },
  COMPLETED: { REVERSE: "REVERSED" },
  FAILED: {},
  REVERSED: {},
  EXPIRED: {},
};

const TERMINAL: ReadonlySet<PaymentState> = new Set(["FAILED", "REVERSED", "EXPIRED"]);

export function isTerminal(state: PaymentState): boolean {
  return TERMINAL.has(state);
}

export function canTransition(current: PaymentState, event: PaymentEvent): boolean {
  return TRANSITIONS[current]?.[event] !== undefined;
}

/** Apply an event; throws on an illegal transition (fail closed). */
export function transition(current: PaymentState, event: PaymentEvent): PaymentState {
  const next = TRANSITIONS[current]?.[event];
  if (!next) throw new Error(`Illegal payment transition: ${current} + ${event}`);
  return next;
}

export interface PaymentTransitionLog {
  event: PaymentEvent;
  from: PaymentState;
  to: PaymentState;
  at: string; // ISO
  metadata?: Record<string, unknown>;
}

export interface PaymentRecord {
  id: string;
  state: PaymentState;
  amountUsd: number;
  currency: string;
  fromAddress?: string;
  toAddress?: string;
  txHash?: string;
  history: PaymentTransitionLog[];
  createdAt: string;
  updatedAt: string;
}

/** Advance a record in place (returns it) with an appended history entry.
 *  Pass an ISO `at` — callers stamp the timestamp so this stays pure/testable. */
export function applyEvent(
  record: PaymentRecord,
  event: PaymentEvent,
  at: string,
  metadata?: Record<string, unknown>
): PaymentRecord {
  const to = transition(record.state, event);
  record.history.push({ event, from: record.state, to, at, metadata });
  record.state = to;
  record.updatedAt = at;
  return record;
}

/** Project an FSM state onto the UI-facing Transaction.status vocabulary. */
export function toTxStatus(state: PaymentState): "settled" | "pending" | "escrow" | "declined" {
  switch (state) {
    case "COMPLETED":
      return "settled";
    case "PROCESSING":
      return "escrow";
    case "FAILED":
    case "REVERSED":
    case "EXPIRED":
      return "declined";
    case "CREATED":
    case "PENDING":
    default:
      return "pending";
  }
}
