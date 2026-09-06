import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  ACCOUNTS,
  LedgerDurabilityError,
  assertLedgerDurable,
  ledger,
  ledgerBalanceCents,
  recordMovement,
  recordPaymentWithFee,
  reverseLedgerTx,
  userCashAccount,
  usdToCents,
} from "../ledger";

// ---------------------------------------------------------------------------
// The chart of accounts, and the durability guard.
//
// THE OLD CHART had three account kinds: `1000:<userId>` user cash as an ASSET,
// `2000` "external world" as a liability catch-all, and `4000` fees as an
// EXPENSE. Two things were wrong with it, and both are load-bearing:
//
//   * A custodial platform's obligation to a customer is a LIABILITY. Booking
//     it as our asset says we own the money.
//   * One "external world" bucket absorbed the bank, the chain, the merchant
//     and the provider, so the books could not answer "where is the money".
//
// These tests assert the corrected shape, and — more importantly — the
// invariants that survive it: balanced postings, a fee that cannot diverge from
// the debit, and a reversal that cannot be applied twice.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

const TOUCHED = ["FURLPAY_ENV", "NODE_ENV", "VERCEL_ENV", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const original: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of TOUCHED) {
    original[k] = process.env[k];
    delete process.env[k];
  }
  // Development: the in-memory mirror is the book, which is what these unit
  // tests exercise. The production refusal is tested explicitly below.
  process.env.FURLPAY_ENV = "development";
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  for (const k of TOUCHED) {
    if (original[k] === undefined) delete process.env[k];
    else process.env[k] = original[k];
  }
  vi.restoreAllMocks();
});

/** Total debits and credits across the whole mirror. */
function trial() {
  return ledger.trialBalance();
}

describe("chart of accounts — shape", () => {
  it("books a customer position as a LIABILITY, not as our asset", () => {
    const id = userCashAccount(USER);
    const account = ledger.getAccount(id)!;
    expect(account.type).toBe("liability");
    expect(account.code).toBe(`2000:${USER}`);
  });

  it("books platform fees as REVENUE, not as an expense we paid", () => {
    // The old chart's own comment conceded this: "from Furlpay's own books this
    // same figure is fee revenue". Recording revenue as an expense makes the
    // P&L wrong by twice the fee.
    expect(ACCOUNTS.FEE_REVENUE.type).toBe("revenue");
    expect(ACCOUNTS.FEE_REVENUE.code).toBe("4000");
  });

  it("has a distinct account for every place money can actually be", () => {
    // The point of the rewrite: "external world" could not answer where money
    // was. Each of these is somewhere money genuinely sits, mid-flow.
    const codes = Object.values(ACCOUNTS).map((a) => a.code);
    for (const code of ["1000", "1100", "1200", "1300", "1400", "1500", "2200", "2300", "2400"]) {
      expect(codes, `missing account ${code}`).toContain(code);
    }
    // And no catch-all survived.
    expect(codes).not.toContain("2000");
  });

  it("separates one customer's liability from another's", () => {
    expect(userCashAccount(USER)).not.toBe(userCashAccount(OTHER));
  });
});

describe("recordMovement — both legs move together", () => {
  it("credits the customer liability and debits escrow on the way in", async () => {
    const before = ledgerBalanceCents(USER);
    await recordMovement("in", 125.5, "deposit", USER);

    // Positive = we owe them. Sign is unchanged from the old asset-shaped
    // account, so no caller had to change; the bookkeeping underneath did.
    expect(ledgerBalanceCents(USER)).toBe(before + usdToCents(125.5));
    expect(trial().balanced).toBe(true);
  });

  it("debits the customer liability and credits escrow on the way out", async () => {
    await recordMovement("in", 100, "deposit", USER);
    const funded = ledgerBalanceCents(USER);

    await recordMovement("out", 40, "withdrawal", USER);

    expect(ledgerBalanceCents(USER)).toBe(funded - usdToCents(40));
    expect(trial().balanced).toBe(true);
  });

  it("refuses a zero or sub-cent movement rather than rounding it up", async () => {
    await expect(recordMovement("in", 0, "nothing", USER)).rejects.toThrow();
    await expect(recordMovement("in", 0.001, "dust", USER)).rejects.toThrow();
  });

  it("refuses a negative or non-finite amount", async () => {
    await expect(recordMovement("in", -5, "negative", USER)).rejects.toThrow();
    await expect(recordMovement("in", Number.NaN, "nan", USER)).rejects.toThrow();
  });

  it("keeps the global trial balance across a randomised sequence", async () => {
    // The property the whole double-entry design exists for. A sequence of
    // arbitrary movements must never leave debits and credits disagreeing.
    for (let i = 0; i < 40; i++) {
      const amount = Math.round((1 + Math.random() * 500) * 100) / 100;
      await recordMovement(i % 3 === 0 ? "out" : "in", amount, `seq-${i}`, USER);
    }
    const { debits, credits, balanced } = trial();
    expect(balanced).toBe(true);
    expect(debits).toBe(credits);
  });
});

describe("recordPaymentWithFee — the fee cannot diverge from the debit", () => {
  it("posts payer debit, recipient share and fee revenue as one balanced entry", async () => {
    await recordPaymentWithFee(USER, 200, 1, "payment with fee");
    expect(trial().balanced).toBe(true);
  });

  it("refuses a fee that is not smaller than the amount", async () => {
    await expect(recordPaymentWithFee(USER, 10, 10, "all fee")).rejects.toThrow();
    await expect(recordPaymentWithFee(USER, 10, 11, "more than all")).rejects.toThrow();
  });

  it("handles a zero fee without posting an empty leg", async () => {
    const entry = await recordPaymentWithFee(USER, 50, 0, "no fee");
    const tx = ledger.getTransaction(entry.id)!;
    expect(tx.postings).toHaveLength(2);
    expect(trial().balanced).toBe(true);
  });
});

describe("reversal — the invariant a trial balance cannot catch", () => {
  it("compensates the original and keeps the books balanced", async () => {
    const entry = await recordMovement("in", 75, "to be reversed", USER);
    const after = ledgerBalanceCents(USER);

    await reverseLedgerTx(entry.id, "reversal");

    expect(ledgerBalanceCents(USER)).toBe(after - usdToCents(75));
    expect(trial().balanced).toBe(true);
  });

  it("refuses a SECOND reversal of the same transaction", async () => {
    // Both sides move together on a double reversal, so the trial balance stays
    // balanced throughout and cannot detect it. Refusing is the only defence —
    // a $100 refund issued twice leaves the customer's balance at -$100.
    const entry = await recordMovement("in", 100, "original", USER);
    await reverseLedgerTx(entry.id);
    await expect(reverseLedgerTx(entry.id)).rejects.toThrow(/already reversed/i);
  });

  it("refuses to reverse a reversal (un-refunding a refund)", async () => {
    const entry = await recordMovement("in", 100, "original", USER);
    const reversal = await reverseLedgerTx(entry.id);
    await expect(reverseLedgerTx(reversal.id)).rejects.toThrow(/reverse a reversal/i);
  });

  it("refuses to reverse a transaction that does not exist", async () => {
    await expect(reverseLedgerTx("txn_nope")).rejects.toThrow(/not found/i);
  });
});

describe("durability guard", () => {
  it("permits posting in development with no durable backend", () => {
    process.env.FURLPAY_ENV = "development";
    expect(() => assertLedgerDurable()).not.toThrow();
  });

  it("REFUSES to post in production with no durable backend", () => {
    // The failure this closes: recordMovement() wrote to a per-lambda
    // globalThis book. On serverless that is not a slow store, it is a store
    // only one instance can see — so idempotency held per-lambda and the books
    // evaporated on recycle. Refusing is the only safe answer.
    process.env.FURLPAY_ENV = "production";
    expect(() => assertLedgerDurable()).toThrow(LedgerDurabilityError);
  });

  it("propagates the refusal out of recordMovement, not just the assert", async () => {
    process.env.FURLPAY_ENV = "production";
    await expect(recordMovement("in", 10, "prod without db", USER)).rejects.toThrow(
      LedgerDurabilityError
    );
  });

  it("propagates the refusal out of recordPaymentWithFee", async () => {
    process.env.FURLPAY_ENV = "production";
    await expect(recordPaymentWithFee(USER, 100, 1, "prod without db")).rejects.toThrow(
      LedgerDurabilityError
    );
  });
});
