import { Ledger } from "@furlpay/ledger";

// ---------------------------------------------------------------------------
// App-wide double-entry ledger. Every money movement posts a balanced pair of
// entries so balances are DERIVED and provably reconcile (debits == credits).
// Amounts are stored in integer USD cents. A module singleton survives across
// route invocations in dev; production would back this with Postgres/TigerBeetle.
// ---------------------------------------------------------------------------

const g = globalThis as unknown as { __ledger?: Ledger };

function build(): Ledger {
  const l = new Ledger();
  // Chart of accounts (minimal but correct).
  l.openAccount({ code: "1000", name: "User cash", type: "asset", currency: "USD" });
  l.openAccount({ code: "2000", name: "External world", type: "liability", currency: "USD" });
  l.openAccount({ code: "4000", name: "Fees", type: "revenue", currency: "USD" });

  // Opening balance: seed the demo user's holdings so the ledger matches the
  // dashboard's starting net worth (single balanced opening entry).
  l.post("Opening balance", [
    { accountId: "acct_1000", side: "debit", amount: 1674837 }, // $16,748.37
    { accountId: "acct_2000", side: "credit", amount: 1674837 },
  ]);
  return l;
}

export const ledger: Ledger = g.__ledger ?? (g.__ledger = build());

export function usdToCents(usd: number): number {
  return Math.max(1, Math.round(usd * 100));
}

/**
 * Record a money movement as a balanced pair.
 *  - "in":  debit user cash, credit external world (funds arrive)
 *  - "out": credit user cash, debit external world (funds leave)
 */
export function recordMovement(direction: "in" | "out", amountUsd: number, memo: string) {
  const cents = usdToCents(amountUsd);
  const postings =
    direction === "in"
      ? [
          { accountId: "acct_1000", side: "debit" as const, amount: cents },
          { accountId: "acct_2000", side: "credit" as const, amount: cents },
        ]
      : [
          { accountId: "acct_1000", side: "credit" as const, amount: cents },
          { accountId: "acct_2000", side: "debit" as const, amount: cents },
        ];
  return ledger.post(memo, postings);
}
