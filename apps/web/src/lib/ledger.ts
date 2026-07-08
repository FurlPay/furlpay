import { Ledger, LedgerError } from "@furlpay/ledger";
import { DEMO_USER_ID } from "@/lib/store";

// ---------------------------------------------------------------------------
// App-wide double-entry ledger. Every money movement posts a balanced set of
// entries so balances are DERIVED and provably reconcile (debits == credits).
// Amounts are stored in integer USD cents — floats never enter the ledger.
//
// Chart of accounts (user-books frame: "user cash" is the asset we track):
//   1000:<userId>  User cash (asset)   — one per user, opened lazily
//   2000           External world (liability catch-all)
//   4000           Fees paid (expense) — platform fees debited from users;
//                  from Furlpay's own books this same figure is fee revenue.
//
// A module singleton survives across route invocations in dev; production
// backs this with Postgres/TigerBeetle behind the same functions.
// ---------------------------------------------------------------------------

const g = globalThis as unknown as { __ledgerV2?: Ledger };

const EXTERNAL = "acct_2000";
const FEES = "acct_4000";

function openUserAccount(l: Ledger, userId: string): string {
  const acct = l.openAccount({
    id: `acct_1000_${userId}`,
    code: `1000:${userId}`,
    name: `User cash ${userId}`,
    type: "asset",
    currency: "USD",
  });
  return acct.id;
}

function build(): Ledger {
  const l = new Ledger();
  l.openAccount({ id: EXTERNAL, code: "2000", name: "External world", type: "liability", currency: "USD" });
  l.openAccount({ id: FEES, code: "4000", name: "Fees paid", type: "expense", currency: "USD" });

  // Opening balance: seed the demo user's holdings so the ledger matches the
  // dashboard's starting net worth (single balanced opening entry).
  const demo = openUserAccount(l, DEMO_USER_ID);
  l.post("Opening balance", [
    { accountId: demo, side: "debit", amount: 1674837 }, // $16,748.37
    { accountId: EXTERNAL, side: "credit", amount: 1674837 },
  ]);
  return l;
}

export const ledger: Ledger = g.__ledgerV2 ?? (g.__ledgerV2 = build());

/** The ledger account id for a user's cash, opened lazily. */
export function userCashAccount(userId: string): string {
  return openUserAccount(ledger, userId);
}

/** Convert a USD float to integer cents. Throws on NaN/negative; a true zero
 *  stays zero — silently coercing 0 to 1 cent (the old behavior) masks bugs. */
export function usdToCents(usd: number): number {
  if (!Number.isFinite(usd) || usd < 0) {
    throw new LedgerError(`Invalid USD amount: ${usd}`);
  }
  return Math.round(usd * 100);
}

/** Derived ledger balance for a user's cash account, in cents. */
export function ledgerBalanceCents(userId: string): number {
  return ledger.balanceOf(userCashAccount(userId));
}

/**
 * Record a money movement for a user as a balanced pair.
 *  - "in":  debit user cash, credit external world (funds arrive)
 *  - "out": credit user cash, debit external world (funds leave)
 * Rejects zero/invalid amounts (LedgerError) rather than rounding them up.
 */
export function recordMovement(
  direction: "in" | "out",
  amountUsd: number,
  memo: string,
  userId: string = DEMO_USER_ID
) {
  const cents = usdToCents(amountUsd);
  if (cents <= 0) throw new LedgerError(`Movement must be at least 1 cent (got $${amountUsd})`);
  const cash = userCashAccount(userId);
  const postings =
    direction === "in"
      ? [
          { accountId: cash, side: "debit" as const, amount: cents },
          { accountId: EXTERNAL, side: "credit" as const, amount: cents },
        ]
      : [
          { accountId: cash, side: "credit" as const, amount: cents },
          { accountId: EXTERNAL, side: "debit" as const, amount: cents },
        ];
  return ledger.post(memo, postings);
}

/**
 * Record a fee-bearing payment in ONE balanced transaction:
 *   Cr user cash  (amount)          — the payer's balance goes down
 *   Dr external   (amount - fee)    — the recipient's share leaves
 *   Dr fees       (fee)             — the platform fee, tracked separately
 * so the fee can never silently diverge from the debit.
 */
export function recordPaymentWithFee(
  userId: string,
  amountUsd: number,
  feeUsd: number,
  memo: string
) {
  const amount = usdToCents(amountUsd);
  const fee = usdToCents(feeUsd);
  if (amount <= 0) throw new LedgerError(`Payment must be at least 1 cent (got $${amountUsd})`);
  if (fee >= amount) throw new LedgerError(`Fee ${fee}c must be smaller than amount ${amount}c`);
  const cash = userCashAccount(userId);
  return ledger.post(memo, [
    { accountId: cash, side: "credit", amount },
    { accountId: EXTERNAL, side: "debit", amount: amount - fee },
    ...(fee > 0 ? [{ accountId: FEES, side: "debit" as const, amount: fee }] : []),
  ]);
}

/** Reverse a previously posted ledger transaction (refunds). */
export function reverseLedgerTx(txId: string, memo?: string) {
  return ledger.reverse(txId, memo);
}
