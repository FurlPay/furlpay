import type { MoneyStatus } from "@/components/furl";

// ---------------------------------------------------------------------------
// The canonical money-movement state machine.
//
// Before this, three separate vocabularies described the same thing: the outbox
// row state (queued/sending/failed), the presentation badge (14 MoneyStatus
// values) and whatever string a given API happened to return. Nothing mapped
// them, so "did this actually go through?" had three possible answers.
//
// THE ONE RULE THIS FILE ENFORCES:
//
//     A client-side send is NOT a success.
//
// `SUBMITTED` means the request left the device. Only the SERVER can move a
// transaction to `PROCESSING` or `COMPLETED`. There is deliberately no
// transition from `CREATED` or `SUBMITTED` straight to `COMPLETED`, so the UI
// cannot be made to show a green tick because a fetch resolved.
//
//   CREATED ──▶ SUBMITTED ──▶ PROCESSING ──▶ COMPLETED
//      │            │              │
//      │            └──▶ FAILED    ├──▶ FAILED
//      │                           └──▶ REVERSED
//      └──▶ CANCELLED
//
// CANCELLED is reachable only from CREATED: once a request has left the device
// the client can no longer promise it will not land, so "cancelled" would be a
// lie. A user-initiated stop after submission is a server-side reversal.
// ---------------------------------------------------------------------------

export type TxState =
  /** Built and authorized locally. Nothing has left the device. */
  | "CREATED"
  /** The request left the device. The outcome is UNKNOWN, not successful. */
  | "SUBMITTED"
  /** The server acknowledged it and is working on it. */
  | "PROCESSING"
  /** Terminal, good. */
  | "COMPLETED"
  /** Terminal, bad. Money did not move. */
  | "FAILED"
  /** Terminal. Money moved and was then returned. */
  | "REVERSED"
  /** Terminal. Abandoned before submission. */
  | "CANCELLED";

export const TX_STATES: readonly TxState[] = [
  "CREATED",
  "SUBMITTED",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "REVERSED",
  "CANCELLED",
] as const;

/** Legal transitions. Anything absent here is a bug, not an edge case. */
const TRANSITIONS: Record<TxState, readonly TxState[]> = {
  CREATED: ["SUBMITTED", "CANCELLED"],
  // No CREATED->COMPLETED and no SUBMITTED->COMPLETED: a completion must be
  // observed from the server, which always reports PROCESSING first.
  SUBMITTED: ["PROCESSING", "FAILED"],
  PROCESSING: ["COMPLETED", "FAILED", "REVERSED"],
  COMPLETED: ["REVERSED"], // a settled payment can still be charged back
  FAILED: [],
  REVERSED: [],
  CANCELLED: [],
};

export function canTransition(from: TxState, to: TxState): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Terminal for the purposes of "can this still change on its own?". */
export function isTerminalState(s: TxState): boolean {
  // COMPLETED is deliberately NOT terminal here: a chargeback can still reverse
  // it. It IS terminal for the user's immediate purposes, which is what
  // `isSettled` answers.
  return s === "FAILED" || s === "REVERSED" || s === "CANCELLED";
}

/** True when the user's money question is answered and the answer is good. */
export function isSettled(s: TxState): boolean {
  return s === "COMPLETED";
}

/**
 * True while the outcome is genuinely unknown to the client.
 *
 * This is the state the UI most often gets wrong. SUBMITTED and PROCESSING both
 * mean "we do not know yet" — the copy must say so rather than implying either
 * success or failure.
 */
export function isPending(s: TxState): boolean {
  return s === "SUBMITTED" || s === "PROCESSING";
}

/**
 * True when a retry could produce a SECOND movement of money unless the
 * original idempotency key is reused.
 *
 * SUBMITTED is the dangerous one: the request may have landed. Any retry from
 * here MUST reuse the original key (which the outbox does — see lib/sync.ts).
 */
export function requiresIdempotentRetry(s: TxState): boolean {
  return s === "SUBMITTED" || s === "PROCESSING";
}

export class IllegalTransitionError extends Error {
  constructor(
    readonly from: TxState,
    readonly to: TxState
  ) {
    super(`Illegal transaction transition ${from} -> ${to}.`);
    this.name = "IllegalTransitionError";
  }
}

/**
 * Apply a transition, or throw.
 *
 * Throwing rather than clamping is deliberate. A machine that silently ignores
 * an illegal transition hides the bug and leaves the UI showing a state the
 * backend does not agree with — which for money is worse than a crash report.
 */
export function transition(from: TxState, to: TxState): TxState {
  if (from === to) return from; // idempotent re-delivery of the same event
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
  return to;
}

/**
 * Map a server status string onto the machine.
 *
 * Returns `null` for anything unrecognized. NEVER guesses, and in particular
 * never defaults to COMPLETED — reporting an unknown state as success is the
 * single worst failure mode available here.
 */
export function parseTxState(raw: string | null | undefined): TxState | null {
  if (!raw) return null;
  const k = raw.trim().toUpperCase().replace(/[\s-]+/g, "_");
  switch (k) {
    case "CREATED":
    case "DRAFT":
    case "QUEUED":
      return "CREATED";
    case "SUBMITTED":
    case "SENDING":
    case "SENT":
    case "ACCEPTED":
      return "SUBMITTED";
    case "PROCESSING":
    case "PENDING":
    case "IN_PROGRESS":
    case "CONFIRMING":
      return "PROCESSING";
    case "COMPLETED":
    case "COMPLETE":
    case "SETTLED":
    case "CONFIRMED":
    case "SUCCESS":
    case "SUCCEEDED":
      return "COMPLETED";
    case "FAILED":
    case "FAILURE":
    case "DECLINED":
    case "REJECTED":
    case "ERROR":
      return "FAILED";
    case "REVERSED":
    case "REFUNDED":
    case "CHARGEBACK":
      return "REVERSED";
    case "CANCELLED":
    case "CANCELED":
    case "EXPIRED":
      return "CANCELLED";
    default:
      return null;
  }
}

/** Presentation mapping. The badge vocabulary is a VIEW of this machine. */
export function toMoneyStatus(s: TxState): MoneyStatus {
  switch (s) {
    case "CREATED":
      return "queued";
    case "SUBMITTED":
      return "processing";
    case "PROCESSING":
      return "pending";
    case "COMPLETED":
      return "completed";
    case "FAILED":
      return "failed";
    case "REVERSED":
      return "reversed";
    case "CANCELLED":
      return "cancelled";
  }
}

/**
 * i18n key for the sentence shown to the user.
 *
 * Separate from the badge because the badge is a word and this is a promise
 * about their money. SUBMITTED and PROCESSING both say "we do not know yet".
 */
export function statusMessageKey(s: TxState): string {
  switch (s) {
    case "CREATED":
      return "tx.created";
    case "SUBMITTED":
      return "tx.submitted";
    case "PROCESSING":
      return "tx.processing";
    case "COMPLETED":
      return "tx.completed";
    case "FAILED":
      return "tx.failed";
    case "REVERSED":
      return "tx.reversed";
    case "CANCELLED":
      return "tx.cancelled";
  }
}

/**
 * Whether the UI may offer a "try again" button.
 *
 * Only from FAILED. Offering retry while SUBMITTED or PROCESSING invites the
 * user to create a second payment for the same intent — the exact duplicate
 * this whole file exists to prevent.
 */
export function canUserRetry(s: TxState): boolean {
  return s === "FAILED";
}

/** Whether the UI may offer "cancel". Only before anything left the device. */
export function canUserCancel(s: TxState): boolean {
  return s === "CREATED";
}
