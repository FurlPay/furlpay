import { getDb } from "@/lib/db";
import { addBreadcrumb } from "@/lib/observability";
import {
  isTerminalState,
  parseTxState,
  requiresIdempotentRetry,
  transition,
  type TxState,
} from "./transactionState";

// ---------------------------------------------------------------------------
// Durable money-movement state.
//
// THE INVARIANT THIS FILE EXISTS FOR:
//
//   If the user presses Send and the app dies one millisecond later, the app
//   must still know, on next launch, WHICH transaction it attempted, WHICH
//   idempotency key belongs to it, WHAT state it is in, and whether the money
//   moved — without creating a second transaction.
//
// Before this, `txState` lived in React state. A process death between
// "request sent" and "reply received" erased the only record that anything had
// been attempted, and the next attempt minted a fresh idempotency key — which
// is precisely how one intent becomes two payments.
//
// The UI never touches rows directly; every read and write goes through this
// module, so the ordering rules below hold in one place rather than in each
// screen.
// ---------------------------------------------------------------------------

export type MoneyOperation =
  | "send"
  | "swap"
  | "withdraw"
  | "bill"
  | "earn"
  | "invest"
  | "card_order"
  | "agent";

export interface MoneyTransaction {
  id: string;
  idempotencyKey: string;
  operation: MoneyOperation;
  state: TxState;
  amountUsd: number;
  currency: string | null;
  /** Chain address, bank reference or provider — never a secret. */
  destination: string | null;
  /** Human label for the receipt ("Coffee — Blue Bottle"). */
  reference: string | null;
  quoteId: string | null;
  quoteExpiresAt: number | null;
  transactionHash: string | null;
  lastError: string | null;
  /** Coarse classification, used to decide retryability. */
  errorClass: "transport" | "timeout" | "server" | "client" | "declined" | null;
  /** True when the outcome is unknown and must be resolved against the server. */
  reconcileRequired: boolean;
  reconcileAttempts: number;
  createdAt: number;
  updatedAt: number;
}

interface Row {
  id: string;
  idempotency_key: string;
  operation: string;
  state: string;
  amount_usd: number;
  currency: string | null;
  destination: string | null;
  reference: string | null;
  quote_id: string | null;
  quote_expires_at: number | null;
  transaction_hash: string | null;
  last_error: string | null;
  error_class: string | null;
  reconcile_required: number;
  reconcile_attempts: number;
  created_at: number;
  updated_at: number;
}

function hydrate(r: Row): MoneyTransaction {
  return {
    id: r.id,
    idempotencyKey: r.idempotency_key,
    operation: r.operation as MoneyOperation,
    // A row whose state is unreadable is treated as needing reconciliation
    // rather than as complete. Guessing "COMPLETED" from a corrupt row is the
    // one failure mode that silently tells a user their money arrived.
    state: parseTxState(r.state) ?? "PROCESSING",
    amountUsd: r.amount_usd,
    currency: r.currency,
    destination: r.destination,
    reference: r.reference,
    quoteId: r.quote_id,
    quoteExpiresAt: r.quote_expires_at,
    transactionHash: r.transaction_hash,
    lastError: r.last_error,
    errorClass: (r.error_class as MoneyTransaction["errorClass"]) ?? null,
    reconcileRequired: r.reconcile_required === 1,
    reconcileAttempts: r.reconcile_attempts,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface CreateInput {
  operation: MoneyOperation;
  /**
   * The idempotency key this transaction will be submitted under.
   *
   * Passed IN rather than minted here, because the caller derives it from the
   * payload fingerprint (Send) or the quote id (Swap) so that re-attempting
   * the same intent reuses it. Minting it here would break that.
   */
  idempotencyKey: string;
  amountUsd: number;
  currency?: string | null;
  destination?: string | null;
  reference?: string | null;
  quoteId?: string | null;
  quoteExpiresAt?: number | null;
}

/**
 * Record an intent, BEFORE anything is submitted.
 *
 * Returns the existing row when one already exists for this idempotency key —
 * a re-attempt of the same intent is the SAME transaction, not a new one. That
 * makes this safe to call on every execute(), including after a restart.
 */
export function createTransaction(input: CreateInput, now: number = Date.now()): MoneyTransaction {
  const existing = getByIdempotencyKey(input.idempotencyKey);
  if (existing) return existing;

  const tx: MoneyTransaction = {
    id: `tx_${crypto.randomUUID()}`,
    idempotencyKey: input.idempotencyKey,
    operation: input.operation,
    state: "CREATED",
    amountUsd: input.amountUsd,
    currency: input.currency ?? null,
    destination: input.destination ?? null,
    reference: input.reference ?? null,
    quoteId: input.quoteId ?? null,
    quoteExpiresAt: input.quoteExpiresAt ?? null,
    transactionHash: null,
    lastError: null,
    errorClass: null,
    reconcileRequired: false,
    reconcileAttempts: 0,
    createdAt: now,
    updatedAt: now,
  };

  getDb().runSync(
    `INSERT INTO money_transactions
       (id, idempotency_key, operation, state, amount_usd, currency, destination,
        reference, quote_id, quote_expires_at, transaction_hash, last_error,
        error_class, reconcile_required, reconcile_attempts, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    tx.id, tx.idempotencyKey, tx.operation, tx.state, tx.amountUsd, tx.currency,
    tx.destination, tx.reference, tx.quoteId, tx.quoteExpiresAt, tx.transactionHash,
    tx.lastError, tx.errorClass, 0, 0, tx.createdAt, tx.updatedAt
  );

  // Structured lifecycle logging. The amount is included (it is the user's own
  // figure and is what makes a report diagnosable); the destination is NOT —
  // observability scrubbing would redact it anyway, so it is never sent.
  addBreadcrumb("money", "TX_CREATED", {
    transactionId: tx.id,
    operation: tx.operation,
    amountUsd: tx.amountUsd,
  });
  return tx;
}

export function getTransaction(id: string): MoneyTransaction | null {
  const row = getDb().getFirstSync<Row>("SELECT * FROM money_transactions WHERE id = ?", id);
  return row ? hydrate(row) : null;
}

export function getByIdempotencyKey(key: string): MoneyTransaction | null {
  const row = getDb().getFirstSync<Row>(
    "SELECT * FROM money_transactions WHERE idempotency_key = ?",
    key
  );
  return row ? hydrate(row) : null;
}

export interface StateUpdate {
  transactionHash?: string | null;
  lastError?: string | null;
  errorClass?: MoneyTransaction["errorClass"];
  reconcileRequired?: boolean;
}

/**
 * Move a transaction to a new state, durably.
 *
 * Goes through `transition()`, so an illegal move throws rather than being
 * written. A row that disagrees with the state machine is worse than a crash:
 * it is a persistent lie about money that survives restarts.
 */
export function updateTransactionState(
  id: string,
  next: TxState,
  update: StateUpdate = {},
  now: number = Date.now()
): MoneyTransaction {
  const current = getTransaction(id);
  if (!current) throw new Error(`Unknown transaction ${id}`);

  const state = transition(current.state, next);

  const reconcile =
    update.reconcileRequired ?? (isTerminalState(state) || state === "COMPLETED" ? false : current.reconcileRequired);

  getDb().runSync(
    `UPDATE money_transactions
        SET state = ?, transaction_hash = COALESCE(?, transaction_hash),
            last_error = ?, error_class = ?, reconcile_required = ?, updated_at = ?
      WHERE id = ?`,
    state,
    update.transactionHash ?? null,
    update.lastError ?? null,
    update.errorClass ?? null,
    reconcile ? 1 : 0,
    now,
    id
  );

  addBreadcrumb("money", `TX_${state}`, {
    transactionId: id,
    operation: current.operation,
    from: current.state,
    to: state,
    ...(update.errorClass ? { errorClass: update.errorClass } : {}),
  });

  return getTransaction(id)!;
}

/**
 * Mark a transaction as having an UNKNOWN outcome.
 *
 * This is the timeout case, and it is deliberately NOT a failure. The request
 * may have landed; the reply was lost. PROCESSING + reconcileRequired is the
 * honest representation, and it reuses the existing state model rather than
 * adding a new financial state.
 */
export function markUnknownOutcome(
  id: string,
  reason: string,
  errorClass: MoneyTransaction["errorClass"] = "timeout",
  now: number = Date.now()
): MoneyTransaction {
  const current = getTransaction(id);
  if (!current) throw new Error(`Unknown transaction ${id}`);
  // Only meaningful once the request has actually left. Before that, nothing
  // is in doubt: the transaction was simply abandoned.
  const next: TxState = requiresIdempotentRetry(current.state) ? "PROCESSING" : current.state;
  return updateTransactionState(
    id,
    next,
    { lastError: reason, errorClass, reconcileRequired: true },
    now
  );
}

/** Every transaction whose outcome is not yet settled. */
export function getPendingTransactions(): MoneyTransaction[] {
  const rows = getDb().getAllSync<Row>(
    `SELECT * FROM money_transactions
      WHERE state IN ('CREATED', 'SUBMITTED', 'PROCESSING')
      ORDER BY updated_at DESC`
  );
  return rows.map(hydrate);
}

/**
 * Transactions that must be resolved against the server on launch/resume.
 *
 * CREATED is excluded ON PURPOSE: nothing ever left the device, so there is
 * nothing to ask about and asking would be a request with no subject.
 */
export function getRecoverableTransactions(): MoneyTransaction[] {
  const rows = getDb().getAllSync<Row>(
    `SELECT * FROM money_transactions
      WHERE state IN ('SUBMITTED', 'PROCESSING')
      ORDER BY created_at ASC`
  );
  return rows.map(hydrate);
}

/** Record the outcome of a reconciliation attempt. */
export function markReconciled(
  id: string,
  resolved: TxState,
  update: StateUpdate = {},
  now: number = Date.now()
): MoneyTransaction {
  return updateTransactionState(id, resolved, { ...update, reconcileRequired: false }, now);
}

export function noteReconcileAttempt(id: string, now: number = Date.now()): void {
  getDb().runSync(
    "UPDATE money_transactions SET reconcile_attempts = reconcile_attempts + 1, updated_at = ? WHERE id = ?",
    now,
    id
  );
}

/**
 * Abandon a CREATED transaction.
 *
 * Legal only before submission — after that the client cannot promise the
 * request will not land, so `transition` refuses it.
 */
export function cancelTransaction(id: string, reason: string, now: number = Date.now()): MoneyTransaction {
  return updateTransactionState(id, "CANCELLED", { lastError: reason }, now);
}

/**
 * Drop settled history older than the window.
 *
 * Non-terminal rows are never pruned regardless of age — an unresolved
 * transaction is exactly the thing that must not be forgotten.
 */
export function pruneSettled(olderThanMs: number = 30 * 24 * 3600 * 1000, now: number = Date.now()): number {
  const res = getDb().runSync(
    `DELETE FROM money_transactions
      WHERE state IN ('COMPLETED', 'FAILED', 'REVERSED', 'CANCELLED')
        AND updated_at < ?`,
    now - olderThanMs
  );
  return res.changes ?? 0;
}
