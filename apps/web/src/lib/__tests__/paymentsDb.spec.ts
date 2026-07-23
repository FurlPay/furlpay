import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { paymentsDurable } from "@/lib/paymentsDb";

// ---------------------------------------------------------------------------
// Migration 0009 — the durable payments + ledger schema.
//
// WHAT THESE TESTS CAN AND CANNOT PROVE. There is no Postgres in this suite, so
// nothing here executes the SQL. What it does assert is that the guarantees the
// application RELIES ON are actually written into the schema, because every one
// of them is a constraint that only the database can enforce:
//
//   - two lambdas cannot both settle one payment (row lock + status check)
//   - one idempotency key cannot mint two charges (partial unique index)
//   - a transaction cannot be reversed twice (partial unique index)
//   - postings cannot be edited after the fact (trigger)
//   - an unbalanced transaction cannot be written (check inside ledger_post)
//
// If someone edits the migration and drops one of these, the application code
// still compiles and its unit tests still pass — the loss is invisible until a
// double-spend in production. That is precisely the class of regression worth
// pinning in CI, and it is the same reasoning as the route-manifest validator:
// turn a convention into something that fails a pull request.
//
// Executing the SQL belongs in an integration suite against a real Postgres.
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION = join(HERE, "..", "..", "..", "..", "..", "supabase", "migrations", "0009_payments_and_ledger.sql");
const sql = readFileSync(MIGRATION, "utf8");

/** Collapse whitespace so assertions survive reformatting of the SQL. */
const flat = sql.replace(/\s+/g, " ").toLowerCase();

describe("0009 — schema exists", () => {
  it("creates every relation the application reads or writes", () => {
    for (const table of [
      "payments",
      "payment_events",
      "ledger_accounts",
      "ledger_transactions",
      "ledger_postings",
    ]) {
      expect(flat, `missing table ${table}`).toContain(`create table if not exists ${table}`);
    }
  });

  it("defines the atomic entry points the app calls by name", () => {
    // paymentsDb.ts calls these through sbRpc; a rename here is a runtime 404
    // that falls back to in-memory, silently restoring the old semantics.
    for (const fn of ["ledger_post", "settle_payment_atomic", "ledger_account_balance"]) {
      expect(flat, `missing function ${fn}`).toContain(`function ${fn}(`);
    }
  });
});

describe("0009 — concurrency guarantees", () => {
  it("takes a ROW LOCK before reading payment status", () => {
    // Without FOR UPDATE both callers read 'pending_signature' and both settle.
    // This single clause is what makes concurrent settlement impossible.
    expect(flat).toContain("select status into v_prev from payments where id = p_payment_id for update");
  });

  it("treats an already-settled payment as a replay, not an error", () => {
    expect(flat).toContain("if v_prev = 'settled'");
    expect(flat).toContain("return query select false, true");
  });

  it("refuses to settle from a status that is not claimable", () => {
    expect(flat).toContain("if v_prev not in ('pending_signature', 'pending_review')");
  });

  it("posts the ledger entry BEFORE marking the payment settled", () => {
    // Order matters: if the posting raises, the whole function rolls back and
    // the payment stays claimable — rather than being marked settled against a
    // ledger entry that never landed.
    const post = flat.indexOf("perform ledger_post(");
    const update = flat.indexOf("set status = 'settled'");
    expect(post).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(-1);
    expect(post, "ledger_post must precede the status update").toBeLessThan(update);
  });
});

describe("0009 — idempotency and double-spend", () => {
  it("enforces one payment per (user, idempotency key) in the DATABASE", () => {
    expect(flat).toContain("create unique index if not exists payments_idempotency_uniq");
    expect(flat).toContain("on payments (created_by_user_id, idempotency_key)");
    // Scoped per user: two tenants sending the same key must not collide.
    expect(flat).toContain("where idempotency_key is not null");
  });

  it("allows at most one on-chain transaction per settled payment", () => {
    expect(flat).toContain("create unique index if not exists payments_tx_uniq");
    expect(flat).toContain("on payments (transaction_hash)");
  });

  it("allows a ledger transaction to be reversed at most once", () => {
    // Two concurrent refunds would otherwise each post a reversal and credit
    // the user twice.
    expect(flat).toContain("create unique index if not exists ledger_transactions_reverses_uniq");
    expect(flat).toContain("on ledger_transactions (reverses) where reverses is not null");
  });

  it("makes ledger_post idempotent on transaction id", () => {
    expect(flat).toContain("if exists (select 1 from ledger_transactions where id = p_transaction_id)");
  });
});

describe("0009 — ledger integrity", () => {
  it("rejects an unbalanced transaction inside the write", () => {
    expect(flat).toContain("if v_debits <> v_credits then");
    expect(flat).toContain("raise exception 'ledger_post: unbalanced");
  });

  it("requires at least two postings", () => {
    expect(flat).toContain("if v_count < 2 then");
  });

  it("stores amounts as positive BIGINT minor units, never floats", () => {
    // Direction lives in `side`. A negative amount is always a bug, and NUMERIC
    // or float here would make reconciliation a rounding argument.
    expect(flat).toContain("amount bigint not null check (amount > 0)");
    expect(flat).toContain("side text not null check (side in ('debit','credit'))");
  });

  it("makes postings append-only via a trigger", () => {
    // Balances are derived by summing postings, so an UPDATE would rewrite
    // history an auditor may already have relied on.
    expect(flat).toContain("create trigger ledger_postings_no_update");
    expect(flat).toContain("before update or delete on ledger_postings");
  });

  it("constrains payment status to the modelled state machine", () => {
    for (const status of [
      "pending_signature",
      "pending_review",
      "settled",
      "refunded",
      "expired",
      "blocked",
    ]) {
      expect(flat, `status ${status} not constrained`).toContain(`'${status}'`);
    }
  });

  it("requires a positive payment amount", () => {
    expect(flat).toContain("amount_usdc numeric(38,18) not null check (amount_usdc > 0)");
  });
});

describe("0009 — reconciliation", () => {
  it("exposes a global imbalance view", () => {
    expect(flat).toContain("create or replace view ledger_imbalance");
  });

  it("exposes settled payments that never reached the ledger", () => {
    // Non-empty means money moved on-chain without being recorded.
    expect(flat).toContain("create or replace view payments_missing_ledger");
    expect(flat).toContain("where p.status = 'settled'");
  });
});

describe("paymentsDurable()", () => {
  it("reports the backend honestly so startup can assert on it", () => {
    // In this suite Supabase is unconfigured, so durability is off and the
    // callers keep their in-memory path. Production must assert this is true.
    expect(typeof paymentsDurable()).toBe("boolean");
    expect(paymentsDurable()).toBe(false);
  });
});
