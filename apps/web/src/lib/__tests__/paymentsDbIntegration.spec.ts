import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import {
  paymentsDurable,
  insertPayment,
  findPayment,
  findPaymentByIdempotencyKey,
  postLedgerTransaction,
  ensureLedgerAccount,
  ledgerBalance,
  settlePaymentAtomic,
  ledgerImbalance,
  transitionPayment,
  type PaymentRow,
} from "@/lib/paymentsDb";

// ---------------------------------------------------------------------------
// The ONLY tests that execute migration 0009's SQL.
//
// paymentsDb.spec.ts asserts the guarantees are PRESENT in the migration text.
// That catches someone deleting a unique index, and it cannot catch the index
// being wrong — a partial index on the mistaken column reads fine and enforces
// nothing. These tests drive a real Postgres and make the database prove it.
//
// They SKIP when SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are unset, so a green
// suite on a laptop with no database is never mistaken for evidence. Anything
// published about concurrency safety should cite this file.
//
// WHY CONCURRENCY IS TESTED WITH Promise.all AND NOT A MOCK. The failure this
// schema exists to prevent is two lambdas racing on one row. A mock cannot
// exhibit it — the whole point is that the serialisation happens inside
// Postgres, in a place application code cannot see. Firing genuinely concurrent
// requests at a real database and counting the winners is the only honest test.
//
// Every run namespaces its ids, so repeated and parallel runs cannot collide
// and nothing needs teardown between them.
// ---------------------------------------------------------------------------

const skip = paymentsDurable()
  ? false
  : "no Supabase configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to execute migration 0009";

const RUN = randomUUID().slice(0, 8);
const userId = randomUUID();

/** A distinct account per run, so balances are deterministic. */
const acct = (name: string) => `acct_test_${RUN}_${name}`;

function paymentRow(over: Partial<PaymentRow> = {}): PaymentRow {
  const id = `pay_${RUN}_${randomUUID().slice(0, 8)}`;
  return {
    id,
    created_by_user_id: userId,
    status: "pending_signature",
    amount_usdc: "25.000000000000000000",
    source_chain: "arbitrum",
    recipient: "0x" + "a".repeat(40),
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    ...over,
  };
}

beforeAll(async () => {
  if (skip) return;
  await ensureLedgerAccount({
    id: acct("cash"),
    code: `1000:test:${RUN}`,
    name: "Test user cash",
    type: "asset",
    currency: "USD",
  });
  await ensureLedgerAccount({
    id: acct("external"),
    code: `2000:test:${RUN}`,
    name: "Test external",
    type: "liability",
    currency: "USD",
  });
});

describe("0009 integration — payments", { skip }, () => {
  it("round-trips a payment", async () => {
    const row = paymentRow();
    await insertPayment(row);
    const found = await findPayment(row.id);
    expect(found?.id).toBe(row.id);
    expect(found?.status).toBe("pending_signature");
  });

  it("enforces one payment per (user, idempotency key) IN THE DATABASE", async () => {
    const key = `idem_${RUN}_${randomUUID().slice(0, 8)}`;
    await insertPayment(paymentRow({ idempotency_key: key }));

    // A second insert with the same (user, key) must violate the partial
    // unique index. If this resolves, the index is missing or on the wrong
    // columns — and a retry storm can mint duplicate charges.
    await expect(insertPayment(paymentRow({ idempotency_key: key }))).rejects.toThrow();

    const resolved = await findPaymentByIdempotencyKey(userId, key);
    expect(resolved).not.toBeNull();
  });

  it("scopes idempotency keys per user — two tenants may reuse one key", async () => {
    const key = `shared_${RUN}`;
    const other = randomUUID();
    await insertPayment(paymentRow({ idempotency_key: key }));
    await insertPayment(paymentRow({ created_by_user_id: other, idempotency_key: key }));

    const mine = await findPaymentByIdempotencyKey(userId, key);
    const theirs = await findPaymentByIdempotencyKey(other, key);
    expect(mine!.id).not.toBe(theirs!.id);
  });

  it("rejects a non-positive amount", async () => {
    await expect(insertPayment(paymentRow({ amount_usdc: "0" }))).rejects.toThrow();
  });

  it("rejects an unmodelled status", async () => {
    await expect(
      insertPayment(paymentRow({ status: "not_a_status" as PaymentRow["status"] }))
    ).rejects.toThrow();
  });

  it("transitions only from the expected current status", async () => {
    const row = paymentRow();
    await insertPayment(row);

    expect(await transitionPayment({ id: row.id, from: "pending_signature", to: "pending_review" })).toBe(true);
    // A transition computed from a stale read must not overwrite a newer one.
    expect(await transitionPayment({ id: row.id, from: "pending_signature", to: "blocked" })).toBe(false);
    expect((await findPayment(row.id))?.status).toBe("pending_review");
  });
});

describe("0009 integration — ledger", { skip }, () => {
  it("posts a balanced transaction and derives the balance from postings", async () => {
    const txId = `tx_${RUN}_${randomUUID().slice(0, 8)}`;
    await postLedgerTransaction({
      id: txId,
      memo: "test credit",
      postings: [
        { accountId: acct("cash"), side: "debit", amount: 5_000 },
        { accountId: acct("external"), side: "credit", amount: 5_000 },
      ],
    });
    // Asset account, debit-normal: 5000 minor units.
    expect(await ledgerBalance(acct("cash"))).toBe(5_000);
  });

  it("REJECTS an unbalanced transaction", async () => {
    await expect(
      postLedgerTransaction({
        id: `tx_${RUN}_bad`,
        memo: "unbalanced",
        postings: [
          { accountId: acct("cash"), side: "debit", amount: 100 },
          { accountId: acct("external"), side: "credit", amount: 99 },
        ],
      })
    ).rejects.toThrow();
  });

  it("rejects a single-legged transaction", async () => {
    await expect(
      postLedgerTransaction({
        id: `tx_${RUN}_single`,
        memo: "one leg",
        postings: [{ accountId: acct("cash"), side: "debit", amount: 100 }],
      })
    ).rejects.toThrow();
  });

  it("is idempotent on transaction id — a retry cannot double the books", async () => {
    const txId = `tx_${RUN}_idem`;
    const postings = [
      { accountId: acct("cash"), side: "debit" as const, amount: 1_000 },
      { accountId: acct("external"), side: "credit" as const, amount: 1_000 },
    ];
    await postLedgerTransaction({ id: txId, memo: "first", postings });
    const before = await ledgerBalance(acct("cash"));

    await postLedgerTransaction({ id: txId, memo: "retry", postings });
    expect(await ledgerBalance(acct("cash"))).toBe(before);
  });

  it("keeps global debits equal to credits", async () => {
    const report = await ledgerImbalance();
    expect(report).not.toBeNull();
    expect(Number(report!.imbalance)).toBe(0);
  });
});

describe("0009 integration — concurrent settlement", { skip }, () => {
  it("settles EXACTLY ONCE under 10 concurrent attempts", async () => {
    const row = paymentRow();
    await insertPayment(row);

    const postings = [
      { accountId: acct("cash"), side: "credit" as const, amount: 2_500 },
      { accountId: acct("external"), side: "debit" as const, amount: 2_500 },
    ];

    // The whole reason migration 0009 exists. In the in-memory implementation
    // these ten callers are ten different lambdas with ten different Maps, and
    // every one of them settles. Here the row lock serialises them.
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        settlePaymentAtomic({
          paymentId: row.id,
          payer: "0x" + "b".repeat(40),
          txHash: `0x${RUN}${"c".repeat(64 - RUN.length)}`,
          chain: "arbitrum",
          // One ledger tx id for the payment — not one per attempt. A caller
          // generating a fresh id per retry would post a second entry.
          ledgerTxId: `ledger_${row.id}`,
          memo: `settle ${row.id}`,
          postings,
        }).catch(() => null)
      )
    );

    const settled = results.filter((r) => r?.settled).length;
    const replayed = results.filter((r) => r?.already).length;

    expect(settled, "exactly one caller may settle").toBe(1);
    expect(settled + replayed, "every other caller must report an idempotent replay").toBe(10);

    const after = await findPayment(row.id);
    expect(after?.status).toBe("settled");
    expect(after?.ledger_tx_id).toBe(`ledger_${row.id}`);
  });

  it("leaves the books balanced after the concurrent run", async () => {
    const report = await ledgerImbalance();
    expect(Number(report!.imbalance)).toBe(0);
  });

  it("refuses to settle a payment that is not claimable", async () => {
    const row = paymentRow({ status: "expired" });
    await insertPayment(row);
    await expect(
      settlePaymentAtomic({
        paymentId: row.id,
        payer: "0x" + "d".repeat(40),
        txHash: `0x${"e".repeat(64)}`,
        chain: "arbitrum",
        ledgerTxId: `ledger_${row.id}`,
        memo: "should not settle",
        postings: [
          { accountId: acct("cash"), side: "credit", amount: 100 },
          { accountId: acct("external"), side: "debit", amount: 100 },
        ],
      })
    ).rejects.toThrow();
  });

  it("does not mark a payment settled when its ledger posting is rejected", async () => {
    const row = paymentRow();
    await insertPayment(row);

    // Unbalanced postings: ledger_post raises, the function rolls back, and the
    // payment must remain claimable rather than being settled against an entry
    // that never landed.
    await expect(
      settlePaymentAtomic({
        paymentId: row.id,
        payer: "0x" + "f".repeat(40),
        txHash: `0x${"1".repeat(64)}`,
        chain: "arbitrum",
        ledgerTxId: `ledger_bad_${row.id}`,
        memo: "unbalanced settlement",
        postings: [
          { accountId: acct("cash"), side: "credit", amount: 100 },
          { accountId: acct("external"), side: "debit", amount: 999 },
        ],
      })
    ).rejects.toThrow();

    expect((await findPayment(row.id))?.status).toBe("pending_signature");
  });
});
