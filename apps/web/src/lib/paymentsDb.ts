import {
  sbSelect,
  sbInsert,
  sbRpc,
  sbUpdate,
  supabaseBackend,
  SupabaseFunctionMissing,
} from "@/lib/supabase";
import type { Posting } from "@furlpay/ledger";

// ---------------------------------------------------------------------------
// Durable persistence for payments and the double-entry ledger
// (schema: supabase/migrations/0009_payments_and_ledger.sql).
//
// WHY THIS EXISTS. services/payments.ts and lib/ledger.ts hold their state in a
// `globalThis` Map. On serverless that is a PER-INSTANCE store, which breaks the
// two guarantees a payments system is built on:
//
//   idempotency — the `status === "settled"` check that makes a retry safe only
//     holds within one lambda. Two concurrent executions on different instances
//     both read `pending_signature`, both settle, and the books double.
//   durability  — a `pending_review` compliance hold disappears on the next
//     deploy, which is the one status that must outlive one.
//
// WHAT IT DOES NOT DO. It does not make money real. Settlement still needs
// FACILITATOR_EVM_PRIVATE_KEY, an RPC and INTEGRATION_MODE=live. This removes
// the reason those cannot safely be switched on.
//
// FALLBACK POSTURE, AND WHY IT IS SAFE HERE. Every function returns null when
// Supabase is unconfigured or the migration has not been applied, and the
// caller keeps its in-memory path — the same shape storeDb.ts uses for 0004.
// That is deliberate: this layer is being introduced under a system that
// currently works entirely in memory, so a half-applied migration must degrade
// to today's behaviour rather than start failing payments. It is NOT a licence
// to run production on the fallback: with `supabaseBackend === "none"` you have
// exactly the per-instance semantics described above, which is why
// paymentsDurable() exists for a startup check to assert against.
// ---------------------------------------------------------------------------

/** True when a durable backend is configured. Assert this at startup in prod. */
export function paymentsDurable(): boolean {
  return supabaseBackend === "supabase";
}

export type PaymentStatus =
  | "pending_signature"
  | "pending_review"
  | "settled"
  | "refunded"
  | "expired"
  | "blocked";

/** Row shape as stored. snake_case matches Postgres; callers map to their own. */
export interface PaymentRow {
  id: string;
  created_by_user_id: string;
  status: PaymentStatus;
  amount_usdc: string;
  source_chain: string;
  recipient: string;
  payer?: string | null;
  memo?: string | null;
  transaction_hash?: string | null;
  settlement_chain?: string | null;
  settled_at?: string | null;
  refund_transaction_hash?: string | null;
  refunded_at?: string | null;
  blocked_reason?: string | null;
  review_reason?: string | null;
  review_requested_at?: string | null;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  ledger_tx_id?: string | null;
  idempotency_key?: string | null;
  expires_at: string;
  created_at?: string;
  updated_at?: string;
}

/** Swallow "backend absent / migration not applied" and surface everything else.
 *
 *  A missing table (PGRST205) or missing function is a deployment state we
 *  handle. A constraint violation, a type error or a network failure is NOT —
 *  re-throwing those is what stops a real write failure being mistaken for
 *  "durability is off" and silently continuing in memory. */
async function optional<T>(work: () => Promise<T>): Promise<T | null> {
  if (!paymentsDurable()) return null;
  try {
    return await work();
  } catch (e) {
    if (e instanceof SupabaseFunctionMissing) return null;
    const message = (e as Error).message ?? "";
    // PGRST205: table not found in schema cache — migration not applied.
    if (message.includes("PGRST205") || message.includes("does not exist")) return null;
    throw e;
  }
}

// ── payments ───────────────────────────────────────────────────────────────

export async function insertPayment(row: PaymentRow): Promise<PaymentRow | null> {
  return optional(async () => {
    const [created] = await sbInsert<PaymentRow>("payments", row);
    await sbInsert("payment_events", {
      payment_id: row.id,
      from_status: null,
      to_status: row.status,
      actor_id: row.created_by_user_id,
      reason: "created",
      metadata: {},
    });
    return created;
  });
}

export async function findPayment(id: string): Promise<PaymentRow | null> {
  const rows = await optional(() =>
    sbSelect<PaymentRow>("payments", `id=eq.${encodeURIComponent(id)}&limit=1`)
  );
  return rows?.[0] ?? null;
}

/**
 * Resolve an idempotency key to its existing payment.
 *
 * The uniqueness is enforced by a partial unique index on
 * (created_by_user_id, idempotency_key), so two concurrent creates cannot both
 * insert — the loser gets a constraint violation and re-reads. Scoping by user
 * is not cosmetic: two tenants sending the same key must never resolve to each
 * other's intent.
 */
export async function findPaymentByIdempotencyKey(
  userId: string,
  key: string
): Promise<PaymentRow | null> {
  const rows = await optional(() =>
    sbSelect<PaymentRow>(
      "payments",
      `created_by_user_id=eq.${encodeURIComponent(userId)}` +
        `&idempotency_key=eq.${encodeURIComponent(key)}&limit=1`
    )
  );
  return rows?.[0] ?? null;
}

export async function listPaymentsForUser(userId: string, limit = 50): Promise<PaymentRow[] | null> {
  return optional(() =>
    sbSelect<PaymentRow>(
      "payments",
      `created_by_user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=${limit}`
    )
  );
}

/** Record a status change plus its audit event. Used for non-settlement
 *  transitions (review, block, expire) — settlement goes through
 *  settlePaymentAtomic so the ledger posting shares its transaction. */
export async function transitionPayment(input: {
  id: string;
  from: PaymentStatus;
  to: PaymentStatus;
  actorId?: string;
  reason?: string;
  patch?: Partial<PaymentRow>;
  metadata?: Record<string, unknown>;
}): Promise<boolean> {
  const result = await optional(async () => {
    // Conditional on the expected current status, so a transition computed from
    // a stale read cannot overwrite a newer one.
    const updated = await sbUpdate<PaymentRow>(
      "payments",
      `id=eq.${encodeURIComponent(input.id)}&status=eq.${input.from}`,
      { status: input.to, updated_at: new Date().toISOString(), ...(input.patch ?? {}) }
    );
    if (updated.length === 0) return false;
    await sbInsert("payment_events", {
      payment_id: input.id,
      from_status: input.from,
      to_status: input.to,
      actor_id: input.actorId ?? null,
      reason: input.reason ?? null,
      metadata: input.metadata ?? {},
    });
    return true;
  });
  return result ?? false;
}

// ── ledger ─────────────────────────────────────────────────────────────────

export interface LedgerAccountRow {
  id: string;
  code: string;
  name: string;
  type: "asset" | "liability" | "equity" | "revenue" | "expense";
  currency: string;
}

/** Open an account if absent. Idempotent — safe to call on every posting. */
export async function ensureLedgerAccount(a: LedgerAccountRow): Promise<void> {
  await optional(async () => {
    const existing = await sbSelect<LedgerAccountRow>(
      "ledger_accounts",
      `id=eq.${encodeURIComponent(a.id)}&limit=1`
    );
    if (existing.length === 0) await sbInsert("ledger_accounts", a);
  });
}

/**
 * Post a balanced transaction through the `ledger_post` function.
 *
 * The RPC runs in ONE Postgres transaction and rejects unbalanced input, so a
 * caller can never leave a header with half its legs — a state in which any
 * concurrent reader summing balances sees books that do not balance. Re-posting
 * the same id is a no-op, which is what makes a retried settlement safe.
 */
export async function postLedgerTransaction(input: {
  id: string;
  memo: string;
  postings: Posting[];
  reverses?: string;
  ts?: string;
}): Promise<string | null> {
  return optional(() =>
    sbRpc<string>("ledger_post", {
      p_transaction_id: input.id,
      p_memo: input.memo,
      p_postings: input.postings.map((p) => ({
        account_id: p.accountId,
        side: p.side,
        amount: p.amount,
      })),
      p_reverses: input.reverses ?? null,
      ...(input.ts ? { p_ts: input.ts } : {}),
    })
  );
}

/** Derived balance in minor units. Never a stored column — always summed. */
export async function ledgerBalance(accountId: string): Promise<number | null> {
  const value = await optional(() =>
    sbRpc<number>("ledger_account_balance", { p_account_id: accountId })
  );
  return value ?? null;
}

// ── settlement ─────────────────────────────────────────────────────────────

export interface SettleOutcome {
  /** This call performed the settlement. */
  settled: boolean;
  /** It was already settled — an idempotent replay, not a failure. */
  already: boolean;
}

/**
 * Claim a payment and post its ledger entry in ONE database transaction.
 *
 * This is the function the whole migration exists for. `settle_payment_atomic`
 * takes a row lock (`SELECT … FOR UPDATE`) before reading the status, so two
 * concurrent settlements serialise: the second sees `settled` and reports a
 * replay instead of posting a second ledger entry. That guarantee cannot be
 * expressed in the in-memory implementation at all, because the two callers are
 * in different processes with different Maps.
 *
 * Returns null when durability is unavailable — the caller then keeps its
 * in-memory path and gets the old, per-instance semantics.
 */
export async function settlePaymentAtomic(input: {
  paymentId: string;
  payer: string;
  txHash: string;
  chain: string;
  ledgerTxId: string;
  memo: string;
  postings: Posting[];
  actorId?: string;
}): Promise<SettleOutcome | null> {
  const rows = await optional(() =>
    sbRpc<{ settled: boolean; already: boolean }[]>("settle_payment_atomic", {
      p_payment_id: input.paymentId,
      p_payer: input.payer,
      p_tx_hash: input.txHash,
      p_chain: input.chain,
      p_ledger_tx_id: input.ledgerTxId,
      p_memo: input.memo,
      p_postings: input.postings.map((p) => ({
        account_id: p.accountId,
        side: p.side,
        amount: p.amount,
      })),
      p_actor_id: input.actorId ?? null,
    })
  );
  if (!rows) return null;
  const row = Array.isArray(rows) ? rows[0] : rows;
  return { settled: !!row?.settled, already: !!row?.already };
}

// ── reconciliation ─────────────────────────────────────────────────────────

export interface ImbalanceReport {
  total_debits: number;
  total_credits: number;
  /** Must be 0. Anything else is a defect already written to the books. */
  imbalance: number;
}

export async function ledgerImbalance(): Promise<ImbalanceReport | null> {
  const rows = await optional(() => sbSelect<ImbalanceReport>("ledger_imbalance", "limit=1"));
  return rows?.[0] ?? null;
}

/** Settled payments with no ledger transaction — money that moved on-chain
 *  without being recorded. Always expected to be empty. */
export async function paymentsMissingLedger(limit = 100): Promise<PaymentRow[] | null> {
  return optional(() => sbSelect<PaymentRow>("payments_missing_ledger", `limit=${limit}`));
}
