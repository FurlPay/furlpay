import {
  canTransition,
  holdsReservation,
  isTerminal,
  legalNext,
  mayHaveTouchedChain,
  type IntentState,
} from "./states.js";

// ---------------------------------------------------------------------------
// The durable record of one payment attempt.
//
// This is the connective tissue between four packages that already exist and
// have never been joined: the gateway decides whether a payment is valid,
// agent-trust decides whether the agent may spend, solana-rpc decides what the
// chain actually did, and ledger records the money. A PaymentIntent is the row
// that survives a crash and lets a retry find out which of those already
// happened.
//
// IT IS THE ANSWER TO ONE QUESTION: an agent retries after a lost HTTP
// response — has this already been paid? Without a durable intent the only
// available answers are "sign another payment" (a double charge) or "refuse"
// (a lost sale). With one, the answer is "here is the signature we already
// broadcast; go and look at it".
//
// MONEY IS A STRING OF INTEGER ATOMIC UNITS. Not a number: 0.1 + 0.2 !== 0.3,
// and beyond 2^53 a JavaScript number silently stops being exact — which USDC
// reaches at about 9 billion units, well inside the range a treasury moves in
// a year. Not a float ever. Arithmetic goes through BigInt.
// ---------------------------------------------------------------------------

export interface PaymentIntent {
  paymentIntentId: string;

  // ── who ──────────────────────────────────────────────────────────────────
  /** The human or organisation that delegated authority. */
  principalId: string;
  /** The agent acting under that authority. */
  agentId: string;

  // ── which request ────────────────────────────────────────────────────────
  requestId: string;
  idempotencyKey: string;
  /** Canonical hash of the request. A reused key with a different body must
   *  never replay this intent — see `matches`. */
  requestHash: string;

  // ── what is being bought ─────────────────────────────────────────────────
  merchant: string;
  resource: string;
  endpoint: string;

  // ── how much ─────────────────────────────────────────────────────────────
  /** Integer atomic units, as a decimal string. Never a float. */
  amountAtomic: string;
  currency: string;
  /** Token mint / contract address. NOT the symbol — a client-supplied
   *  "USDC" is a claim; a mint address is a fact. */
  asset: string;
  network: string;

  payer: string | null;
  payee: string;

  state: IntentState;

  /** Set once budget is reserved; cleared on commit or release. */
  reservationId: string | null;

  /** Set once bytes are broadcast. Its presence is what makes a retry
   *  reconcilable rather than a fresh payment. */
  transactionSignature: string | null;
  confirmationState: string | null;
  settlementState: string | null;

  createdAt: string;
  updatedAt: string;
  expiresAt: string;

  failureCode: string | null;
  failureReason: string | null;
}

export class IntentTransitionError extends Error {
  readonly from: IntentState;
  readonly to: IntentState;
  constructor(from: IntentState, to: IntentState) {
    super(
      `illegal transition ${from} -> ${to}; legal moves from ${from} are [${legalNext(from).join(", ") || "none, it is terminal"}]`
    );
    this.name = "IntentTransitionError";
    this.from = from;
    this.to = to;
  }
}

export interface CreateIntentInput {
  paymentIntentId: string;
  principalId: string;
  agentId: string;
  requestId: string;
  idempotencyKey: string;
  requestHash: string;
  merchant: string;
  resource: string;
  endpoint: string;
  amountAtomic: string;
  currency: string;
  asset: string;
  network: string;
  payee: string;
  /** Seconds until the quote expires. */
  ttlSeconds: number;
  now?: () => number;
}

/** Reject anything that is not a non-negative integer in decimal. */
export function isAtomicAmount(value: string): boolean {
  return /^(0|[1-9]\d*)$/.test(value);
}

export function createIntent(input: CreateIntentInput): PaymentIntent {
  if (!isAtomicAmount(input.amountAtomic)) {
    // Refused at construction rather than at settlement. An intent carrying
    // "0.001" or "1e6" would compare and sum incorrectly everywhere
    // downstream, and the failure would surface as a wrong balance rather
    // than as a bad input.
    throw new RangeError(
      `amountAtomic must be integer atomic units as a decimal string, got "${input.amountAtomic}"`
    );
  }
  const now = (input.now ?? Date.now)();
  const iso = new Date(now).toISOString();
  return {
    paymentIntentId: input.paymentIntentId,
    principalId: input.principalId,
    agentId: input.agentId,
    requestId: input.requestId,
    idempotencyKey: input.idempotencyKey,
    requestHash: input.requestHash,
    merchant: input.merchant,
    resource: input.resource,
    endpoint: input.endpoint,
    amountAtomic: input.amountAtomic,
    currency: input.currency,
    asset: input.asset,
    network: input.network,
    payer: null,
    payee: input.payee,
    state: "CREATED",
    reservationId: null,
    transactionSignature: null,
    confirmationState: null,
    settlementState: null,
    createdAt: iso,
    updatedAt: iso,
    expiresAt: new Date(now + input.ttlSeconds * 1000).toISOString(),
    failureCode: null,
    failureReason: null,
  };
}

export interface TransitionPatch {
  payer?: string;
  reservationId?: string | null;
  transactionSignature?: string;
  confirmationState?: string;
  settlementState?: string;
  failureCode?: string;
  failureReason?: string;
}

/**
 * Move an intent to `to`, returning a NEW object.
 *
 * Immutable on purpose. A mutated intent leaves no trace of what it was, and
 * the whole value of this record is being able to answer "what did we believe,
 * and when?" after something went wrong.
 *
 * THE SIGNATURE IS WRITE-ONCE. Overwriting it would discard evidence of a
 * broadcast that may still be sitting in a block — which is precisely the
 * evidence a retry needs in order not to pay twice.
 */
export function transition(
  intent: PaymentIntent,
  to: IntentState,
  patch: TransitionPatch = {},
  now: () => number = Date.now
): PaymentIntent {
  if (!canTransition(intent.state, to)) {
    throw new IntentTransitionError(intent.state, to);
  }
  if (
    patch.transactionSignature &&
    intent.transactionSignature &&
    patch.transactionSignature !== intent.transactionSignature
  ) {
    throw new Error(
      `refusing to overwrite transactionSignature ${intent.transactionSignature} with ${patch.transactionSignature}; ` +
        "a second signature is a second payment and must be a new intent"
    );
  }
  return {
    ...intent,
    state: to,
    updatedAt: new Date(now()).toISOString(),
    ...(patch.payer !== undefined ? { payer: patch.payer } : {}),
    ...(patch.reservationId !== undefined ? { reservationId: patch.reservationId } : {}),
    ...(patch.transactionSignature !== undefined
      ? { transactionSignature: patch.transactionSignature }
      : {}),
    ...(patch.confirmationState !== undefined
      ? { confirmationState: patch.confirmationState }
      : {}),
    ...(patch.settlementState !== undefined ? { settlementState: patch.settlementState } : {}),
    ...(patch.failureCode !== undefined ? { failureCode: patch.failureCode } : {}),
    ...(patch.failureReason !== undefined ? { failureReason: patch.failureReason } : {}),
  };
}

/**
 * Is this stored intent the one the incoming request is asking about?
 *
 * Principal AND key AND request hash. All three, because:
 *   - key alone collides across tenants,
 *   - key + principal replays the wrong result when a client reuses a key for
 *     a different request, which is the case that hands somebody a $100
 *     receipt for a $1,000 payment they never made.
 */
export function matches(
  intent: PaymentIntent,
  probe: { principalId: string; idempotencyKey: string; requestHash: string }
): boolean {
  return (
    intent.principalId === probe.principalId &&
    intent.idempotencyKey === probe.idempotencyKey &&
    intent.requestHash === probe.requestHash
  );
}

/** Same principal and key, DIFFERENT request. The 422 case. */
export function isKeyReuse(
  intent: PaymentIntent,
  probe: { principalId: string; idempotencyKey: string; requestHash: string }
): boolean {
  return (
    intent.principalId === probe.principalId &&
    intent.idempotencyKey === probe.idempotencyKey &&
    intent.requestHash !== probe.requestHash
  );
}

export function isExpired(intent: PaymentIntent, now: number = Date.now()): boolean {
  return now > Date.parse(intent.expiresAt);
}

/** What a retry should do with an intent it has found. */
export type RecoveryAction =
  /** Terminal success — replay the original result, charge nothing. */
  | { action: "replay" }
  /** A signature exists. Go and look at the chain before doing anything. */
  | { action: "reconcile"; signature: string }
  /** Terminal failure — the caller may legitimately start a new payment. */
  | { action: "restart"; reason: string }
  /** Still in flight in this process. */
  | { action: "in_progress" };

/**
 * The decision a retry makes after finding an existing intent.
 *
 * This is the function that stops a lost HTTP response becoming a double
 * charge, so its bias is explicit: anything that might have touched the chain
 * reconciles rather than restarts. Restarting is offered only from states
 * where no signature can exist, or where one exists and is provably dead.
 */
export function recoveryFor(intent: PaymentIntent): RecoveryAction {
  if (intent.state === "COMMITTED") return { action: "replay" };

  if (intent.transactionSignature && mayHaveTouchedChain(intent.state)) {
    // Includes PAYMENT_FAILED: a failed transaction still consumed a
    // signature, and confirming that from the chain is cheaper than trusting
    // a stored verdict written by a process that then crashed.
    return { action: "reconcile", signature: intent.transactionSignature };
  }

  if (isTerminal(intent.state)) {
    return {
      action: "restart",
      reason: intent.failureReason ?? `previous attempt ended in ${intent.state}`,
    };
  }

  return { action: "in_progress" };
}

/** Does abandoning this intent require releasing budget? */
export function needsRelease(intent: PaymentIntent): boolean {
  return intent.reservationId !== null && holdsReservation(intent.state);
}

/** Sum atomic amounts without ever leaving integer arithmetic. */
export function sumAtomic(amounts: readonly string[]): string {
  return amounts.reduce((total, a) => total + BigInt(a), 0n).toString();
}

export { canTransition, holdsReservation, isTerminal, legalNext, mayHaveTouchedChain };
export type { IntentState };
