// Ledger invariants — the properties that must hold for every money movement,
// tested adversarially rather than on the happy path.
//
// WHY THIS FILE EXISTS. Before it, not one spec in the suite imported the
// ledger. Every balance in the product derives from `packages/ledger`, and the
// engine that enforces "money cannot appear from nowhere" had no test asserting
// that it does. Three real bugs were found writing these (see the
// double-reversal, reversal-of-reversal and duplicate-id blocks).
//
// A NOTE ON WHAT trialBalance() CANNOT TELL YOU, because it shapes the whole
// file: the global invariant (total debits == total credits) stays TRUE through
// several of the corruptions below. Both sides of a bad posting move together,
// so the books balance perfectly while a user's cash account sits at minus ten
// thousand dollars. Balanced is necessary, not sufficient — every test here
// therefore asserts per-account outcomes as well as the global sum.

import { describe, it, expect, beforeEach } from "vitest";
import { Ledger, LedgerError } from "@furlpay/ledger";
import { applySale, applySplit, positionCostBasis, positionQuantity } from "@/lib/corporateActions/lots";
import type { TradeLot } from "@/lib/corporateActions/types";

const CASH = "acct_1000_user";
const OTHER = "acct_1000_other";
const EXTERNAL = "acct_2000";
const FEES = "acct_4000";

function freshLedger(): Ledger {
  const l = new Ledger();
  l.openAccount({ id: CASH, code: "1000:user", name: "User cash", type: "asset", currency: "USD" });
  l.openAccount({ id: OTHER, code: "1000:other", name: "Other cash", type: "asset", currency: "USD" });
  l.openAccount({ id: EXTERNAL, code: "2000", name: "External", type: "liability", currency: "USD" });
  l.openAccount({ id: FEES, code: "4000", name: "Fees", type: "expense", currency: "USD" });
  return l;
}

/** Fund an account the way recordMovement("in") does. */
function fund(l: Ledger, acct: string, cents: number, memo = "fund") {
  return l.post(memo, [
    { accountId: acct, side: "debit", amount: cents },
    { accountId: EXTERNAL, side: "credit", amount: cents },
  ]);
}

/** Every account in the ledger, summed by its normal side. The books balance
 *  globally iff assets+expenses equal liabilities under this frame. */
function totalAcrossAccounts(l: Ledger): number {
  return l.listAccounts().reduce((sum, a) => sum + l.balanceOf(a.id), 0);
}

let ledger: Ledger;
beforeEach(() => {
  ledger = freshLedger();
});

// ---------------------------------------------------------------------------
describe("double-entry: balance conservation", () => {
  it("holds the trial balance across an arbitrary sequence of postings", () => {
    // Deterministic pseudo-random sequence: same run every time in CI, but wide
    // enough to catch an asymmetry a hand-written case would miss.
    let seed = 1337;
    const next = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n) + 1;

    for (let i = 0; i < 500; i++) {
      const amount = next(500_000);
      const inbound = next(2) === 1;
      ledger.post(`op-${i}`, [
        { accountId: CASH, side: inbound ? "debit" : "credit", amount },
        { accountId: EXTERNAL, side: inbound ? "credit" : "debit", amount },
      ]);
      const tb = ledger.trialBalance();
      expect(tb.balanced, `unbalanced after op ${i}`).toBe(true);
      expect(tb.debits).toBe(tb.credits);
    }
  });

  it("a fee-bearing payment splits the debit without losing a cent", () => {
    fund(ledger, CASH, 100_000);
    // Cr cash 10_000, Dr external 9_950, Dr fees 50 — the fee is tracked
    // separately and cannot silently diverge from the amount debited.
    ledger.post("payment with fee", [
      { accountId: CASH, side: "credit", amount: 10_000 },
      { accountId: EXTERNAL, side: "debit", amount: 9_950 },
      { accountId: FEES, side: "debit", amount: 50 },
    ]);
    expect(ledger.balanceOf(CASH)).toBe(90_000);
    expect(ledger.balanceOf(FEES)).toBe(50);
    expect(ledger.trialBalance().balanced).toBe(true);
  });

  it("the sum across all accounts returns to zero after a full round trip", () => {
    const before = totalAcrossAccounts(ledger);
    const tx = fund(ledger, CASH, 42_042);
    ledger.reverse(tx.id);
    expect(totalAcrossAccounts(ledger)).toBe(before);
    expect(ledger.balanceOf(CASH)).toBe(0);
  });

  it("rejects an unbalanced transaction outright", () => {
    expect(() =>
      ledger.post("bad", [
        { accountId: CASH, side: "debit", amount: 100 },
        { accountId: EXTERNAL, side: "credit", amount: 99 },
      ])
    ).toThrow(LedgerError);
    expect(ledger.balanceOf(CASH)).toBe(0);
  });

  it("rejects a single-sided transaction", () => {
    expect(() => ledger.post("one-sided", [{ accountId: CASH, side: "debit", amount: 100 }])).toThrow(
      LedgerError
    );
  });

  it("rejects zero, negative and fractional posting amounts", () => {
    for (const amount of [0, -1, 1.5, NaN, Infinity]) {
      expect(() =>
        ledger.post("bad amount", [
          { accountId: CASH, side: "debit", amount },
          { accountId: EXTERNAL, side: "credit", amount },
        ])
      ).toThrow(LedgerError);
    }
    expect(ledger.listTransactions()).toHaveLength(0);
  });

  it("rejects a posting to an account that does not exist", () => {
    expect(() =>
      ledger.post("ghost", [
        { accountId: "acct_does_not_exist", side: "debit", amount: 100 },
        { accountId: EXTERNAL, side: "credit", amount: 100 },
      ])
    ).toThrow(LedgerError);
  });

  it("a rejected posting leaves NO partial state behind", () => {
    fund(ledger, CASH, 5_000);
    const txCount = ledger.listTransactions().length;
    expect(() =>
      ledger.post("partial", [
        { accountId: CASH, side: "debit", amount: 100 },
        { accountId: "acct_missing", side: "credit", amount: 100 },
      ])
    ).toThrow(LedgerError);
    // Rollback: the valid leg of a rejected transaction must not be applied.
    expect(ledger.listTransactions()).toHaveLength(txCount);
    expect(ledger.balanceOf(CASH)).toBe(5_000);
  });
});

// ---------------------------------------------------------------------------
describe("reversals cannot create money", () => {
  it("REGRESSION: refuses to reverse the same transaction twice", () => {
    // The bug this encodes: reverse() had no guard, so a refund issued twice
    // posted two credits against one debit and drove the user's ASSET account
    // to -$100. trialBalance() stayed balanced the whole time, because both
    // sides moved together — which is exactly why this needed its own test.
    const tx = fund(ledger, CASH, 10_000);
    ledger.reverse(tx.id);
    expect(ledger.balanceOf(CASH)).toBe(0);

    expect(() => ledger.reverse(tx.id)).toThrow(LedgerError);
    expect(() => ledger.reverse(tx.id)).toThrow(/already reversed/i);

    expect(ledger.balanceOf(CASH), "a second reversal must not go negative").toBe(0);
    expect(ledger.trialBalance().balanced).toBe(true);
  });

  it("REGRESSION: refuses to reverse a reversal", () => {
    // Reversing a reversal re-applies the original postings — silently taking
    // back money that was already returned to the user.
    const tx = fund(ledger, CASH, 5_000);
    const rev = ledger.reverse(tx.id);
    expect(ledger.balanceOf(CASH)).toBe(0);

    expect(() => ledger.reverse(rev.id)).toThrow(/cannot reverse a reversal/i);
    expect(ledger.balanceOf(CASH), "un-refunding must be impossible").toBe(0);
  });

  it("a reversal flips every leg of a multi-posting transaction", () => {
    fund(ledger, CASH, 100_000);
    const tx = ledger.post("fee payment", [
      { accountId: CASH, side: "credit", amount: 10_000 },
      { accountId: EXTERNAL, side: "debit", amount: 9_950 },
      { accountId: FEES, side: "debit", amount: 50 },
    ]);
    ledger.reverse(tx.id);
    expect(ledger.balanceOf(CASH)).toBe(100_000);
    expect(ledger.balanceOf(FEES), "the fee must be refunded too").toBe(0);
    expect(ledger.trialBalance().balanced).toBe(true);
  });

  it("exposes the reversal so a caller can be idempotent by asking", () => {
    const tx = fund(ledger, CASH, 2_500);
    expect(ledger.reversalOf(tx.id)).toBeUndefined();
    const rev = ledger.reverse(tx.id);
    expect(ledger.reversalOf(tx.id)?.id).toBe(rev.id);
  });

  it("refuses to reverse a transaction that does not exist", () => {
    expect(() => ledger.reverse("txn_nope")).toThrow(/not found/i);
  });

  it("history is append-only: a reversal ADDS an entry, never edits one", () => {
    const tx = fund(ledger, CASH, 1_000);
    const before = ledger.listTransactions().length;
    ledger.reverse(tx.id);
    expect(ledger.listTransactions()).toHaveLength(before + 1);
    // The original is untouched and still says what it always said.
    const original = ledger.getTransaction(tx.id)!;
    expect(original.postings).toEqual(tx.postings);
    expect(original.reverses).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
describe("idempotency and duplicate events", () => {
  it("REGRESSION: refuses a duplicate transaction id", () => {
    // The bug this encodes: two transactions could share an id, and every
    // id-addressed operation resolved to whichever was posted FIRST. Reversing
    // "the" transaction reversed the wrong one and left the real posting live —
    // a silent mis-reversal that the trial balance cannot see.
    ledger.post(
      "first",
      [
        { accountId: CASH, side: "debit", amount: 100 },
        { accountId: EXTERNAL, side: "credit", amount: 100 },
      ],
      { id: "settle_abc" }
    );
    expect(() =>
      ledger.post(
        "second",
        [
          { accountId: CASH, side: "debit", amount: 99_900 },
          { accountId: EXTERNAL, side: "credit", amount: 99_900 },
        ],
        { id: "settle_abc" }
      )
    ).toThrow(/duplicate transaction id/i);

    // The replay contributed nothing.
    expect(ledger.balanceOf(CASH)).toBe(100);
  });

  it("a webhook replayed N times with the same id credits exactly once", () => {
    const deliver = () =>
      ledger.post(
        "deposit webhook",
        [
          { accountId: CASH, side: "debit", amount: 25_000 },
          { accountId: EXTERNAL, side: "credit", amount: 25_000 },
        ],
        { id: "evt_0xdeadbeef" }
      );

    deliver();
    for (let i = 0; i < 5; i++) expect(deliver).toThrow(/duplicate/i);

    expect(ledger.balanceOf(CASH)).toBe(25_000);
    expect(ledger.listTransactions()).toHaveLength(1);
  });

  it("out-of-order delivery still converges to one posting per event id", () => {
    // Reordering is only safe if identity is the event id, not arrival order.
    const events = [
      { id: "evt_c", amount: 300 },
      { id: "evt_a", amount: 100 },
      { id: "evt_b", amount: 200 },
      { id: "evt_a", amount: 100 }, // duplicate, arriving late
      { id: "evt_c", amount: 300 }, // duplicate, arriving late
    ];
    let applied = 0;
    for (const e of events) {
      try {
        ledger.post(
          e.id,
          [
            { accountId: CASH, side: "debit", amount: e.amount },
            { accountId: EXTERNAL, side: "credit", amount: e.amount },
          ],
          { id: e.id }
        );
        applied++;
      } catch {
        /* duplicate — the whole point */
      }
    }
    expect(applied).toBe(3);
    expect(ledger.balanceOf(CASH)).toBe(600);
  });

  it("interleaved posting attempts on one id resolve to a single winner", () => {
    // The runtime is single-threaded, so this is not a thread race — it is the
    // check the atomic claim has to make, exercised at the ledger boundary.
    const attempts = Array.from({ length: 20 }, (_, i) => () =>
      ledger.post(
        `concurrent-${i}`,
        [
          { accountId: CASH, side: "debit", amount: 1_000 },
          { accountId: EXTERNAL, side: "credit", amount: 1_000 },
        ],
        { id: "same_key" }
      )
    );
    const outcomes = attempts.map((run) => {
      try {
        run();
        return "ok";
      } catch {
        return "rejected";
      }
    });
    expect(outcomes.filter((o) => o === "ok")).toHaveLength(1);
    expect(ledger.balanceOf(CASH)).toBe(1_000);
  });
});

// ---------------------------------------------------------------------------
describe("cross-account isolation", () => {
  it("one user's postings never move another user's balance", () => {
    fund(ledger, CASH, 50_000);
    fund(ledger, OTHER, 70_000);

    ledger.post("user spends", [
      { accountId: CASH, side: "credit", amount: 20_000 },
      { accountId: EXTERNAL, side: "debit", amount: 20_000 },
    ]);

    expect(ledger.balanceOf(CASH)).toBe(30_000);
    expect(ledger.balanceOf(OTHER), "an untouched account must not move").toBe(70_000);
  });

  it("reversing one account's transaction leaves the other untouched", () => {
    const mine = fund(ledger, CASH, 10_000);
    fund(ledger, OTHER, 10_000);
    ledger.reverse(mine.id);
    expect(ledger.balanceOf(CASH)).toBe(0);
    expect(ledger.balanceOf(OTHER)).toBe(10_000);
  });

  it("balanceOf refuses an unknown account rather than answering zero", () => {
    // Returning 0 for an account that does not exist would make a typo in a
    // user id look like an empty wallet.
    expect(() => ledger.balanceOf("acct_1000_typo")).toThrow(LedgerError);
  });
});

// ---------------------------------------------------------------------------
describe("precision", () => {
  it("integer cents survive a large accumulation with zero drift", () => {
    // 10,000 postings of 1 cent must be exactly $100 — no float creep.
    for (let i = 0; i < 10_000; i++) {
      ledger.post(`penny-${i}`, [
        { accountId: CASH, side: "debit", amount: 1 },
        { accountId: EXTERNAL, side: "credit", amount: 1 },
      ]);
    }
    expect(ledger.balanceOf(CASH)).toBe(10_000);
    expect(Number.isInteger(ledger.balanceOf(CASH))).toBe(true);
  });

  it("usdToCents round-trips every cent value exactly", () => {
    // The conversion is Math.round(usd * 100), which is float arithmetic. This
    // asserts the property that actually matters: any amount that originated as
    // a whole number of cents converts back to that same integer.
    const usdToCents = (usd: number) => Math.round(usd * 100);
    for (let cents = 1; cents <= 100_000; cents++) {
      expect(usdToCents(cents / 100)).toBe(cents);
    }
  });

  it("a sub-cent amount cannot become a posting", () => {
    // 0.4 of a cent rounds to 0, and a zero-amount posting is rejected — so a
    // dust payment fails loudly instead of silently posting nothing.
    const cents = Math.round(0.004 * 100);
    expect(cents).toBe(0);
    expect(() =>
      ledger.post("dust", [
        { accountId: CASH, side: "debit", amount: cents },
        { accountId: EXTERNAL, side: "credit", amount: cents },
      ])
    ).toThrow(LedgerError);
  });
});

// ---------------------------------------------------------------------------
// Lot invariants that pair with the ledger: the cash side and the share side
// have to agree that nothing was created or destroyed.
// ---------------------------------------------------------------------------

function lot(id: string, qty: number, basis: number, acquiredAt: string): TradeLot {
  return {
    id,
    userId: "user",
    symbol: "NVDA",
    quantity: qty,
    costBasis: basis,
    acquiredAt,
    status: "open",
    provenance: "execution",
  };
}

describe("lots: value is neither created nor destroyed", () => {
  it("a partial fill consumes exactly what it sells and no more", () => {
    const lots = [lot("l1", 10, 1_000, "2026-01-01T00:00:00Z")];
    const sale = applySale(lots, "NVDA", 3.5, 700);

    const consumedQty = sale.consumed.reduce((s, c) => s + c.quantity, 0);
    expect(consumedQty).toBeCloseTo(3.5, 8);
    expect(positionQuantity(sale.remaining, "NVDA")).toBeCloseTo(6.5, 8);
  });

  it("basis leaving in a sale equals basis removed from the lots", () => {
    const lots = [
      lot("l1", 10, 1_000, "2026-01-01T00:00:00Z"),
      lot("l2", 5, 750, "2026-02-01T00:00:00Z"),
    ];
    const before = positionCostBasis(lots, "NVDA");
    const sale = applySale(lots, "NVDA", 12, 2_400);
    const after = positionCostBasis(sale.remaining, "NVDA");

    // Conservation: what left plus what remains equals what was there.
    expect(after + sale.costBasis).toBeCloseTo(before, 2);
    expect(sale.realizedGain).toBeCloseTo(2_400 - sale.costBasis, 2);
  });

  it("selling the entire position leaves zero quantity and zero basis", () => {
    const lots = [
      lot("l1", 4, 400, "2026-01-01T00:00:00Z"),
      lot("l2", 6, 900, "2026-02-01T00:00:00Z"),
    ];
    const sale = applySale(lots, "NVDA", 10, 1_500);
    expect(positionQuantity(sale.remaining, "NVDA")).toBe(0);
    expect(positionCostBasis(sale.remaining, "NVDA")).toBe(0);
    expect(sale.remaining.every((l) => l.status === "closed")).toBe(true);
  });

  it("REFUSES to sell more than is held, at any fractional overshoot", () => {
    const lots = [lot("l1", 1, 100, "2026-01-01T00:00:00Z")];
    for (const over of [1.00000001, 1.5, 2, 1_000]) {
      expect(() => applySale(lots, "NVDA", over, 100)).toThrow(/insufficient position/i);
    }
  });

  it("no lot can be driven negative by a sequence of sales", () => {
    let lots: TradeLot[] = [lot("l1", 10, 1_000, "2026-01-01T00:00:00Z")];
    for (const q of [2, 3, 1.25, 0.75]) {
      const sale = applySale(lots, "NVDA", q, q * 110);
      lots = sale.remaining;
      expect(lots.every((l) => l.quantity >= 0)).toBe(true);
      expect(positionQuantity(lots, "NVDA")).toBeGreaterThanOrEqual(0);
    }
    expect(positionQuantity(lots, "NVDA")).toBeCloseTo(3, 8);
  });

  it("a split changes share count but NEVER total cost basis", () => {
    const lots = [lot("l1", 10, 1_500, "2026-01-01T00:00:00Z")];
    const before = positionCostBasis(lots, "NVDA");
    const result = applySplit(lots, {
      id: "ca1",
      symbol: "NVDA",
      type: "split",
      ratio: 4,
      exDate: "2026-06-01",
    } as never);
    const after = positionCostBasis(result.lots, "NVDA");

    expect(after).toBeCloseTo(before, 2);
    expect(positionQuantity(result.lots, "NVDA")).toBeCloseTo(40, 8);
  });

  it("fractional quantities survive a split and a sale without drift", () => {
    const lots = [lot("l1", 0.33333333, 100, "2026-01-01T00:00:00Z")];
    const split = applySplit(lots, {
      id: "ca2",
      symbol: "NVDA",
      type: "split",
      ratio: 3,
      exDate: "2026-06-01",
    } as never);
    expect(positionCostBasis(split.lots, "NVDA")).toBeCloseTo(100, 2);

    const qty = positionQuantity(split.lots, "NVDA");
    const sale = applySale(split.lots, "NVDA", qty, 150);
    expect(positionQuantity(sale.remaining, "NVDA")).toBe(0);
    expect(sale.costBasis).toBeCloseTo(100, 2);
  });
});
