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
  /** id -> transaction. Lookups must not be a linear scan of history, and a
   *  duplicate id must be rejected rather than shadowed (see post()). */
  private byId = new Map<string, Transaction>();
  /** original tx id -> the reversal that compensated it. A transaction may be
   *  reversed at most ONCE; see reverse() for why this is a hard invariant. */
  private reversedBy = new Map<string, string>();
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

    const id = opts.id ?? `txn_${++this.seq}`;
    // A caller-supplied id must be unique. Without this, two transactions can
    // share an id, and every id-addressed operation (reverse, lookup, audit)
    // silently resolves to whichever was posted first — so reversing "the"
    // transaction reverses a different one and leaves the real posting live.
    if (this.byId.has(id)) {
      throw new LedgerError(`Duplicate transaction id: ${id}`);
    }

    const tx: Transaction = {
      id,
      ts: opts.ts ?? new Date().toISOString(),
      memo,
      postings,
      reverses: opts.reverses,
    };
    this.transactions.push(tx);
    this.byId.set(id, tx);
    if (opts.reverses) this.reversedBy.set(opts.reverses, id);
    return tx;
  }

  getTransaction(txId: string): Transaction | undefined {
    return this.byId.get(txId);
  }

  /** The reversal that compensated `txId`, if one exists. Lets a caller make a
   *  refund path idempotent by asking, rather than by reversing and hoping. */
  reversalOf(txId: string): Transaction | undefined {
    const rid = this.reversedBy.get(txId);
    return rid ? this.byId.get(rid) : undefined;
  }

  /**
   * Post a compensating transaction that flips every posting of the original.
   *
   * TWO THINGS THIS REFUSES TO DO, both of which create money from nothing:
   *
   *   1. Reverse the same transaction twice. The second reversal is a second
   *      credit against an original that was already compensated, so a $100
   *      refund issued twice leaves the user's cash account at -$100. The
   *      global trial balance stays balanced throughout — both sides move
   *      together — so `trialBalance()` does NOT catch this. Nothing catches
   *      it except refusing to do it.
   *
   *   2. Reverse a reversal. That re-applies the original postings, which is
   *      "un-refunding" a refund: the money was returned and is now silently
   *      taken back. If a refund was issued in error the answer is a new,
   *      intentional charge with its own audit trail — not resurrecting a
   *      compensating entry.
   *
   * Both are LedgerError rather than silent no-ops: a caller that reverses
   * twice has a bug, and swallowing it would hide the bug while leaving the
   * caller believing a second refund was issued.
   */
  reverse(txId: string, memo?: string): Transaction {
    const original = this.byId.get(txId);
    if (!original) throw new LedgerError(`Transaction not found: ${txId}`);

    if (original.reverses) {
      throw new LedgerError(
        `Cannot reverse a reversal: ${txId} already compensates ${original.reverses}`
      );
    }
    const existing = this.reversedBy.get(txId);
    if (existing) {
      throw new LedgerError(`Transaction ${txId} was already reversed by ${existing}`);
    }

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
