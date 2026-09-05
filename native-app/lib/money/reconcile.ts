import { api, ApiError, NetworkError, TimeoutError } from "@/lib/api";
import { addBreadcrumb } from "@/lib/observability";
import {
  getRecoverableTransactions,
  markReconciled,
  noteReconcileAttempt,
  type MoneyOperation,
  type MoneyTransaction,
} from "./transactionStore";
import type { TxState } from "./transactionState";

// ---------------------------------------------------------------------------
// Reconciliation.
//
// Resolves "I submitted something and never heard back" into a real outcome,
// WITHOUT re-submitting. This is the difference between a payments app that
// occasionally double-charges and one that does not: the recovery action for an
// unknown outcome is a QUESTION, never a retry.
//
// Backed by GET /api/transactions/status, which reads the server's existing
// idempotency record — the same bytes the client would have received the first
// time. No second source of truth.
// ---------------------------------------------------------------------------

/**
 * Client operation → the server's idempotency scope.
 *
 * `null` means the server route does not wrap itself in withIdempotency, so
 * there is no record to ask about. Those operations are recorded and recovered
 * locally but cannot be resolved remotely — stated here rather than papered
 * over with a scope the server never writes.
 */
const SCOPE_FOR: Record<MoneyOperation, string | null> = {
  send: "wallets.transfer",
  earn: "earn.deposit",
  invest: "investing.order",
  card_order: "cards.order",
  // /api/swaps is protected by a single-use quoteId rather than an idempotency
  // record: a replay is refused, not double-executed. Safe, but not queryable.
  swap: null,
  // /api/offramp and /api/bills do not use withIdempotency today.
  withdraw: null,
  bill: null,
  agent: null,
};

export function isReconcilable(op: MoneyOperation): boolean {
  return SCOPE_FOR[op] !== null;
}

export interface StatusResponse {
  state: "PROCESSING" | "COMPLETED" | "FAILED" | "UNKNOWN";
  known: boolean;
  status?: number;
  result?: unknown;
}

/** How many times we ask before leaving a transaction for the user to resolve. */
const MAX_RECONCILE_ATTEMPTS = 8;

export type ReconcileOutcome =
  | { resolved: true; state: TxState; transactionHash?: string }
  | { resolved: false; reason: "unreachable" | "not_reconcilable" | "still_processing" | "unknown" };

/**
 * Ask the server what happened to one transaction.
 *
 * NEVER re-submits. The only request it makes is a GET.
 */
export async function reconcileTransaction(tx: MoneyTransaction): Promise<ReconcileOutcome> {
  const scope = SCOPE_FOR[tx.operation];
  if (!scope) return { resolved: false, reason: "not_reconcilable" };

  noteReconcileAttempt(tx.id);
  addBreadcrumb("money", "TX_RECONCILIATION_STARTED", {
    transactionId: tx.id,
    operation: tx.operation,
    attempt: tx.reconcileAttempts + 1,
  });

  let res: StatusResponse;
  try {
    res = await api<StatusResponse>(
      `/transactions/status?idempotencyKey=${encodeURIComponent(tx.idempotencyKey)}&scope=${encodeURIComponent(scope)}`,
      // A short deadline: this runs on launch and must not delay the app. If it
      // cannot answer quickly the transaction simply stays unresolved, which is
      // the correct state for it to be in.
      { timeoutMs: 8_000 }
    );
  } catch (e) {
    // Every failure mode here leaves the transaction UNRESOLVED, never failed.
    // Not being able to ask is not evidence that nothing happened.
    if (e instanceof NetworkError || e instanceof TimeoutError) {
      return { resolved: false, reason: "unreachable" };
    }
    if (e instanceof ApiError && e.status >= 500) return { resolved: false, reason: "unreachable" };
    return { resolved: false, reason: "unknown" };
  }

  if (res.state === "COMPLETED") {
    const hash = extractHash(res.result);
    markReconciled(tx.id, "COMPLETED", { transactionHash: hash ?? null });
    addBreadcrumb("money", "TX_COMPLETED", { transactionId: tx.id, via: "reconciliation" });
    return { resolved: true, state: "COMPLETED", ...(hash ? { transactionHash: hash } : {}) };
  }

  if (res.state === "FAILED") {
    markReconciled(tx.id, "FAILED", { lastError: "The server rejected this payment.", errorClass: "declined" });
    addBreadcrumb("money", "TX_FAILED", { transactionId: tx.id, via: "reconciliation" });
    return { resolved: true, state: "FAILED" };
  }

  if (res.state === "PROCESSING") return { resolved: false, reason: "still_processing" };

  // UNKNOWN — the server has no record under this key.
  //
  // This is NOT proof of failure. The request may never have arrived, or the
  // 24h idempotency window may have passed. After enough attempts we stop
  // asking and leave it for the user rather than guessing, because guessing
  // "failed" invites them to pay twice.
  if (tx.reconcileAttempts + 1 >= MAX_RECONCILE_ATTEMPTS) {
    return { resolved: false, reason: "unknown" };
  }
  return { resolved: false, reason: "unknown" };
}

/** Pull a transaction hash out of a replayed response body, if there is one. */
function extractHash(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const r = result as Record<string, unknown>;
  const hash = r.transactionHash ?? r.txHash ?? r.hash;
  return typeof hash === "string" && hash.length > 0 ? hash : undefined;
}

export interface RecoveryResult {
  inspected: number;
  resolved: number;
  stillPending: number;
  notReconcilable: number;
}

/** Guards against two resume handlers reconciling the same rows at once. */
let running = false;

/**
 * Resolve everything left in doubt.
 *
 * Called on cold start and on every foreground resume. Idempotent and
 * re-entrant-safe; makes only GET requests.
 */
export async function recoverPendingTransactions(): Promise<RecoveryResult> {
  const result: RecoveryResult = { inspected: 0, resolved: 0, stillPending: 0, notReconcilable: 0 };
  if (running) return result;
  running = true;

  try {
    const pending = getRecoverableTransactions();
    result.inspected = pending.length;

    for (const tx of pending) {
      const outcome = await reconcileTransaction(tx);
      if (outcome.resolved) result.resolved++;
      else if (outcome.reason === "not_reconcilable") result.notReconcilable++;
      else result.stillPending++;
    }
  } finally {
    running = false;
  }

  return result;
}
