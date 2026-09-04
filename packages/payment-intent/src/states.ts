// ---------------------------------------------------------------------------
// Where a payment is, and which moves are legal.
//
// WHY A STATE MACHINE RATHER THAN A STATUS COLUMN. A status string that any
// caller may assign is not a record of what happened — it is a record of what
// the last writer believed. In a payment path with retries, crashes and
// ambiguous RPC answers, those diverge, and the divergence is invisible until
// somebody audits a month of money and finds a row that went from SETTLED back
// to PAYMENT_SUBMITTED.
//
// So transitions are enumerated, illegal ones are refused, and the refusal is
// an error rather than a silent no-op.
//
// THE THREE RULES THAT MATTER MORE THAN THE DIAGRAM:
//
//   1. UNKNOWN IS NOT FAILURE. An RPC that times out tells you nothing about
//      the chain. Collapsing PAYMENT_UNKNOWN into PAYMENT_FAILED invents a
//      fact — and the customer whose money moved is told it did not.
//
//   2. UNKNOWN IS NOT SUCCESS EITHER. It is a state you leave by observing
//      the chain, not by waiting or by assuming.
//
//   3. NOTHING MOVES BACKWARDS, except out of PAYMENT_UNKNOWN — which is the
//      one state that exists precisely to be resolved later, in either
//      direction, once evidence arrives.
// ---------------------------------------------------------------------------

export type IntentState =
  /** Created from a request. Nothing has been checked yet. */
  | "CREATED"
  /** Policy allowed it. No money and no budget committed. */
  | "POLICY_CHECKED"
  /** Budget headroom taken. Reversible; see `release`. */
  | "BUDGET_RESERVED"
  /** A 402 has been issued and we are waiting for the agent to pay. */
  | "PAYMENT_REQUIRED"
  /** Signed bytes are on the wire. From here a signature may exist on chain
   *  even if this process never learns of it. */
  | "PAYMENT_SUBMITTED"
  /** Seen in a block. NOT yet safe for a large amount. */
  | "PAYMENT_OBSERVED"
  /** Reached the commitment this payment required. */
  | "PAYMENT_CONFIRMED"
  /** The facilitator/rail reports the transfer complete. */
  | "SETTLED"
  /** Budget committed and the ledger written. Terminal success. */
  | "COMMITTED"

  // ── terminal failures ──────────────────────────────────────────────────
  /** Policy said no. No payment was ever requested. */
  | "POLICY_DENIED"
  /** Policy allowed the shape but the agent had no headroom. */
  | "BUDGET_DENIED"
  /** The quote's validity window passed. */
  | "EXPIRED"
  /** The payment payload was refused before reaching a chain. */
  | "PAYMENT_REJECTED"
  /** It reached the chain and failed there. Landing is not success. */
  | "PAYMENT_FAILED"
  /** Settlement failed after a confirmed payment — the worst case, and it is
   *  given its own state so it can never be mistaken for either success or a
   *  clean failure. */
  | "SETTLEMENT_FAILED"

  // ── the honest middle ──────────────────────────────────────────────────
  /**
   * Submitted, and we cannot currently tell what happened.
   *
   * NOT an error state. It is the truthful answer when an RPC times out or
   * every provider is unreachable, and it is deliberately recoverable in both
   * directions — see TRANSITIONS.
   */
  | "PAYMENT_UNKNOWN";

/** States from which nothing further can happen. */
const TERMINAL: readonly IntentState[] = [
  "COMMITTED",
  "POLICY_DENIED",
  "BUDGET_DENIED",
  "EXPIRED",
  "PAYMENT_REJECTED",
  "PAYMENT_FAILED",
  "SETTLEMENT_FAILED",
] as const;

/**
 * Every legal move.
 *
 * Written out rather than derived from a rule, because the interesting edges
 * are the exceptions: a confirmed payment can still fail to settle, and an
 * unknown payment can resolve to anything.
 */
const TRANSITIONS: Record<IntentState, readonly IntentState[]> = {
  CREATED: ["POLICY_CHECKED", "POLICY_DENIED", "EXPIRED"],
  POLICY_CHECKED: ["BUDGET_RESERVED", "BUDGET_DENIED", "EXPIRED"],
  BUDGET_RESERVED: ["PAYMENT_REQUIRED", "EXPIRED", "PAYMENT_REJECTED"],
  PAYMENT_REQUIRED: ["PAYMENT_SUBMITTED", "PAYMENT_REJECTED", "EXPIRED"],

  // Once bytes are on the wire, "we do not know" becomes reachable and stays
  // reachable. This is the edge that keeps the machine honest.
  PAYMENT_SUBMITTED: ["PAYMENT_OBSERVED", "PAYMENT_FAILED", "PAYMENT_UNKNOWN", "EXPIRED"],
  PAYMENT_OBSERVED: ["PAYMENT_CONFIRMED", "PAYMENT_FAILED", "PAYMENT_UNKNOWN"],

  // A confirmed payment can still fail to settle — the rail may reject after
  // the transfer confirmed. Forbidding this would force a lie in that case.
  PAYMENT_CONFIRMED: ["SETTLED", "SETTLEMENT_FAILED", "PAYMENT_UNKNOWN"],
  SETTLED: ["COMMITTED", "SETTLEMENT_FAILED"],

  /**
   * The only state with a backward edge, and the reason the machine is
   * trustworthy. An intent parked here is resolved by OBSERVING the chain, and
   * the observation may say anything: it landed and confirmed, it landed and
   * failed, or the blockhash expired and it never will. Each of those is a
   * legal exit; assuming one of them is not.
   */
  PAYMENT_UNKNOWN: [
    "PAYMENT_OBSERVED",
    "PAYMENT_CONFIRMED",
    "PAYMENT_FAILED",
    "EXPIRED",
  ],

  COMMITTED: [],
  POLICY_DENIED: [],
  BUDGET_DENIED: [],
  EXPIRED: [],
  PAYMENT_REJECTED: [],
  PAYMENT_FAILED: [],
  SETTLEMENT_FAILED: [],
};

export function isTerminal(state: IntentState): boolean {
  return TERMINAL.includes(state);
}

export function canTransition(from: IntentState, to: IntentState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function legalNext(from: IntentState): readonly IntentState[] {
  return TRANSITIONS[from];
}

/**
 * Has this intent reached a point where a signature may exist on chain?
 *
 * THE MOST IMPORTANT PREDICATE IN THIS FILE, because it decides whether a
 * retry may build a new payment. From PAYMENT_SUBMITTED onward the answer is
 * yes — even in PAYMENT_UNKNOWN, especially in PAYMENT_UNKNOWN — and a retry
 * must reconcile the existing signature rather than sign a fresh one. Doing
 * otherwise is how a lost HTTP response becomes a double charge.
 */
export function mayHaveTouchedChain(state: IntentState): boolean {
  return (
    state === "PAYMENT_SUBMITTED" ||
    state === "PAYMENT_OBSERVED" ||
    state === "PAYMENT_CONFIRMED" ||
    state === "PAYMENT_UNKNOWN" ||
    state === "SETTLED" ||
    state === "COMMITTED" ||
    state === "SETTLEMENT_FAILED" ||
    state === "PAYMENT_FAILED"
  );
}

/**
 * Does this state still hold budget that must be released if we abandon it?
 *
 * Everything after the reservation and before the commit. Getting this wrong
 * in either direction is a real cost: releasing a committed intent refunds
 * money that was spent, and failing to release an abandoned one strands an
 * agent's allowance until the reservation TTL expires.
 */
export function holdsReservation(state: IntentState): boolean {
  return (
    state === "BUDGET_RESERVED" ||
    state === "PAYMENT_REQUIRED" ||
    state === "PAYMENT_SUBMITTED" ||
    state === "PAYMENT_OBSERVED" ||
    state === "PAYMENT_CONFIRMED" ||
    state === "PAYMENT_UNKNOWN" ||
    state === "SETTLED"
  );
}
