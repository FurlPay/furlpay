// ---------------------------------------------------------------------------
// @furlpay/ledger — a minimal, correct double-entry ledger.
//
// Design (per 2026 fintech ledger best practice / TigerBeetle model):
//   - Every transaction is a set of postings; total debits == total credits.
//   - Postings are append-only and immutable; you never edit history, you post
//     a compensating (reversal) transaction.
//   - Balances are DERIVED from postings, never stored as a mutable column.
//   - Amounts are integer minor units (e.g. cents / micro-units) - no floats.
//   - Accounts have a code + normal balance side (debit or credit).
//   - The ledger enforces its invariant (sum of all debits == all credits).
// ---------------------------------------------------------------------------

export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";
export type Side = "debit" | "credit";

export interface Account {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  currency: string;
}

export interface Posting {
  accountId: string;
  side: Side;
  amount: number; // positive integer, minor units
}

export interface Transaction {
  id: string;
  ts: string; // ISO
  memo: string;
  postings: Posting[];
  reverses?: string; // id of a transaction this one reverses
}

// Asset & expense accounts increase on the debit side; the rest on credit.
const DEBIT_NORMAL: AccountType[] = ["asset", "expense"];

function isPositiveInt(n: number): boolean {
  return Number.isInteger(n) && n > 0;
}

export class LedgerError extends Error {}

export class Ledger {
  private accounts = new Map<string, Account>();
  private transactions: Transaction[] = [];
  private seq = 0;

  openAccount(a: Omit<Account, "id"> & { id?: string }): Account {
    const id = a.id ?? `acct_${a.code}`;
    if (this.accounts.has(id)) return this.accounts.get(id)!;
    const account: Account = { ...a, id };
    this.accounts.set(id, account);
    return account;
  }

  getAccount(id: string): Account | undefined {
    return this.accounts.get(id);
  }

  listAccounts(): Account[] {
    return [...this.accounts.values()];
  }

  /** Post a balanced transaction. Throws if unbalanced or invalid. */
  post(memo: string, postings: Posting[], opts: { reverses?: string; id?: string; ts?: string } = {}): Transaction {
    if (postings.length < 2) {
      throw new LedgerError("A transaction needs at least two postings");
    }
    let debits = 0;
    let credits = 0;
    for (const p of postings) {
      if (!this.accounts.has(p.accountId)) {
        throw new LedgerError(`Unknown account: ${p.accountId}`);
      }
      if (!isPositiveInt(p.amount)) {
        throw new LedgerError(`Posting amount must be a positive integer (got ${p.amount})`);
      }
      if (p.side === "debit") debits += p.amount;
      else credits += p.amount;
    }
    if (debits !== credits) {
      throw new LedgerError(`Unbalanced transaction: debits ${debits} != credits ${credits}`);
    }

    const tx: Transaction = {
      id: opts.id ?? `txn_${++this.seq}`,
      ts: opts.ts ?? new Date().toISOString(),
      memo,
      postings,
      reverses: opts.reverses,
    };
    this.transactions.push(tx);
    return tx;
  }

  /** Post a compensating transaction that flips every posting of the original. */
  reverse(txId: string, memo?: string): Transaction {
    const original = this.transactions.find((t) => t.id === txId);
    if (!original) throw new LedgerError(`Transaction not found: ${txId}`);
    const flipped: Posting[] = original.postings.map((p) => ({
      accountId: p.accountId,
      side: p.side === "debit" ? "credit" : "debit",
      amount: p.amount,
    }));
    return this.post(memo ?? `Reversal of ${txId}`, flipped, { reverses: txId });
  }

  /** Derived balance for an account, sign-aware by normal side (minor units). */
  balanceOf(accountId: string): number {
    const acct = this.accounts.get(accountId);
    if (!acct) throw new LedgerError(`Unknown account: ${accountId}`);
    let debit = 0;
    let credit = 0;
    for (const t of this.transactions) {
      for (const p of t.postings) {
        if (p.accountId !== accountId) continue;
        if (p.side === "debit") debit += p.amount;
        else credit += p.amount;
      }
    }
    return DEBIT_NORMAL.includes(acct.type) ? debit - credit : credit - debit;
  }

  listTransactions(): Transaction[] {
    return [...this.transactions];
  }

  /** Global invariant: across all postings, total debits == total credits. */
  trialBalance(): { debits: number; credits: number; balanced: boolean } {
    let debits = 0;
    let credits = 0;
    for (const t of this.transactions) {
      for (const p of t.postings) {
        if (p.side === "debit") debits += p.amount;
        else credits += p.amount;
      }
    }
    return { debits, credits, balanced: debits === credits };
  }
}
