import { Ledger, LedgerError, type Posting } from "@furlpay/ledger";
import { DEMO_USER_ID } from "@/lib/store";
import { ensureLedgerAccount, postLedgerTransaction, paymentsDurable } from "@/lib/paymentsDb";
import { financialEnvironment } from "@/lib/flags";
import { log } from "@/lib/log";

// ---------------------------------------------------------------------------
// App-wide double-entry ledger.
//
// TWO THINGS WERE WRONG HERE, AND THEY COMPOUNDED.
//
// 1. THE BOOK WAS PER-LAMBDA. `globalThis.__ledgerV2` is not a slow store on
//    serverless, it is a store only ONE instance can see. Every caller of
//    recordMovement() — the Stripe webhook, the off-ramp, wallet transfers,
//    investing orders, dividend and corporate-action settlement — was writing
//    to a book that evaporates on recycle and that no other instance shares.
//    "Debits == credits" was true per-lambda and meaningless overall.
//    migrations/0009 built the durable side; nothing routed to it.
//
// 2. THE CHART OF ACCOUNTS WAS THE WRONG SHAPE. It had three kinds of account:
//    `1000:<userId>` USER CASH as an ASSET, `2000` "external world" as a
//    liability catch-all, and `4000` fees as an expense. That is the bookkeeping
//    of a business spending its own money. For a platform that holds customer
//    funds it is inverted: what a customer holds is our LIABILITY, and the cash
//    backing it is our asset. With one "external world" bucket absorbing the
//    bank, the chain, the merchant and the provider, the books could not answer
//    "where is the money right now" — which is the only question reconciliation
//    exists to answer.
//
// WHAT IT IS NOW. Postgres is the book (migrations/0009: balance checked inside
// the write, postings append-only by trigger, balances derived). The in-memory
// Ledger is kept as a MIRROR for /api/ledger and for the zero-credential dev
// path — never as the record. In production a deployment with no durable
// backend cannot post at all: assertLedgerDurable() throws rather than let a
// money movement land somewhere that will not survive the hour.
//
// AMOUNTS ARE INTEGER MINOR UNITS (USD cents). Floats never enter the ledger.
// ---------------------------------------------------------------------------

/**
 * The chart of accounts.
 *
 * Every account here exists because some real question needs it answered, and
 * the ones that are per-user are per-user because a pooled figure cannot tell
 * you what you owe any individual customer.
 */
export const ACCOUNTS = {
  // ── Assets: cash and value we control ──────────────────────────────────
  /** INR/fiat sitting in the payment aggregator's escrow at a scheduled bank. */
  BANK_ESCROW: { id: "acct_1000", code: "1000", name: "Bank / PA escrow", type: "asset" },
  /** Stablecoin held by the platform. */
  STABLECOIN_TREASURY: { id: "acct_1100", code: "1100", name: "Stablecoin treasury", type: "asset" },
  /** Value a provider has acknowledged but not yet delivered to us. */
  PROVIDER_RECEIVABLE: { id: "acct_1200", code: "1200", name: "Provider receivable", type: "asset" },
  /** Converted to fiat, not yet credited at the beneficiary bank. */
  IN_TRANSIT_FIAT: { id: "acct_1300", code: "1300", name: "In-transit (fiat)", type: "asset" },
  /** Broadcast on-chain, not yet final at the required confirmation depth. */
  IN_TRANSIT_CHAIN: { id: "acct_1400", code: "1400", name: "In-transit (chain)", type: "asset" },
  /** The fee-payer's gas balance. Ours, spent on users' behalf. */
  GAS_FLOAT: { id: "acct_1500", code: "1500", name: "Gas float", type: "asset" },
  /**
   * Operational funds. NOT customer money.
   *
   * Its own account because the single most consequential accounting error a
   * payments company can make is commingling: if operational spend and customer
   * balances share a bucket, "do we hold enough to pay everyone back" has no
   * answer. `customerLiabilityCovered()` below depends on this separation.
   */
  OPERATIONAL_CASH: { id: "acct_1600", code: "1600", name: "Operational cash", type: "asset" },
  /**
   * Cross-border collections and payouts, segregated.
   *
   * The RBI (Regulation of Payment Aggregators) Directions, 2025 require an
   * Inward Collection Account for receipts from overseas customers and an
   * Outward Collection Account for payments by Indian customers to overseas
   * merchants, with the two kept apart. Modelled now so a future partner's
   * statement maps onto accounts that already exist, rather than being forced
   * into the domestic escrow line where it would be unreconcilable.
   */
  INWARD_COLLECTION: { id: "acct_1010", code: "1010", name: "Inward collection (cross-border)", type: "asset" },
  OUTWARD_COLLECTION: { id: "acct_1020", code: "1020", name: "Outward collection (cross-border)", type: "asset" },

  // ── Liabilities: what we owe ───────────────────────────────────────────
  /** Pooled counterpart to the per-user 2000:<id> rows. Never posted directly. */
  MERCHANT_PAYABLE: { id: "acct_2200", code: "2200", name: "Merchant payable", type: "liability" },
  /** Withheld under §194S and owed to the tax authority, not to the customer. */
  TDS_PAYABLE: { id: "acct_2300", code: "2300", name: "TDS payable", type: "liability" },
  GST_PAYABLE: { id: "acct_2400", code: "2400", name: "GST payable", type: "liability" },
  /**
   * Refunds owed but not yet paid.
   *
   * A refund decided and a refund paid are different events, often days apart.
   * Without this account the gap is invisible: the customer's balance has not
   * moved and neither has ours, so nothing shows that we owe them.
   */
  REFUND_LIABILITY: { id: "acct_2500", code: "2500", name: "Refund liability", type: "liability" },
  /**
   * Disputed amounts held pending the outcome.
   *
   * Separate from refunds because the money may come back to us. Netting the
   * two loses the distinction between "we will pay this out" and "we might".
   */
  CHARGEBACK_LIABILITY: { id: "acct_2600", code: "2600", name: "Chargeback / reversal liability", type: "liability" },

  // ── Equity / revenue / expense ─────────────────────────────────────────
  /** Opening balances and corrections. Not a customer-facing account. */
  OPENING_EQUITY: { id: "acct_3000", code: "3000", name: "Opening equity", type: "equity" },
  /**
   * Platform fees. REVENUE, not an expense.
   *
   * The old chart booked this as `4000 Fees paid (expense)` and its own comment
   * conceded the contradiction: "from Furlpay's own books this same figure is
   * fee revenue". It is our revenue. Recording revenue as an expense makes the
   * P&L wrong by twice the fee.
   */
  FEE_REVENUE: { id: "acct_4000", code: "4000", name: "Fee revenue", type: "revenue" },
  GAS_EXPENSE: { id: "acct_5000", code: "5000", name: "Gas expense", type: "expense" },
  /** Provider fees, banking charges, everything we pay to run the rails. */
  OPERATIONAL_EXPENSE: { id: "acct_5100", code: "5100", name: "Operational expense", type: "expense" },
} as const;

/**
 * Accounts that hold, or represent claims on, CUSTOMER money.
 *
 * Used by the solvency check below. Kept as an explicit list rather than
 * derived from account type, because "asset" is not the right test — gas float
 * and operational cash are assets and are emphatically not customer money.
 */
export const CUSTOMER_FUND_ASSETS = [
  ACCOUNTS.BANK_ESCROW,
  ACCOUNTS.STABLECOIN_TREASURY,
  ACCOUNTS.PROVIDER_RECEIVABLE,
  ACCOUNTS.IN_TRANSIT_FIAT,
  ACCOUNTS.IN_TRANSIT_CHAIN,
  ACCOUNTS.INWARD_COLLECTION,
  ACCOUNTS.OUTWARD_COLLECTION,
] as const;

type AccountSpec = { id: string; code: string; name: string; type: string };

/** Per-user fiat liability: what we owe this customer in cash. */
function userFiatLiability(userId: string): AccountSpec {
  return {
    id: `acct_2000_${userId}`,
    code: `2000:${userId}`,
    name: `Customer fiat liability ${userId}`,
    type: "liability",
  };
}

/** Per-user stablecoin liability: what we owe this customer in stablecoin. */
function userStablecoinLiability(userId: string): AccountSpec {
  return {
    id: `acct_2100_${userId}`,
    code: `2100:${userId}`,
    name: `Customer stablecoin liability ${userId}`,
    type: "liability",
  };
}

// ── durability ─────────────────────────────────────────────────────────────

export class LedgerDurabilityError extends Error {
  constructor() {
    super(
      "The ledger has no durable backend. A money movement recorded only in memory would not " +
        "survive an instance recycle and is invisible to every other instance, so posting is " +
        "refused. Configure Supabase and apply supabase/migrations/0009_payments_and_ledger.sql."
    );
    this.name = "LedgerDurabilityError";
  }
}

/** True when postings will actually reach Postgres. */
export function ledgerDurable(): boolean {
  return paymentsDurable();
}

/**
 * Refuse to post in production without a durable backend.
 *
 * paymentsDb.optional() deliberately degrades to null when the migration is
 * absent, so that layer could be introduced under a system already running in
 * memory. That is a migration aid, not a licence: here is where it stops being
 * acceptable. Development and staging may still run on the mirror alone.
 */
export function assertLedgerDurable(): void {
  if (financialEnvironment() === "production" && !ledgerDurable()) {
    throw new LedgerDurabilityError();
  }
}

// ── the in-memory mirror ───────────────────────────────────────────────────

const g = globalThis as unknown as { __ledgerV3?: Ledger };

function build(): Ledger {
  const l = new Ledger();
  for (const spec of Object.values(ACCOUNTS)) {
    l.openAccount({ ...spec, type: spec.type as never, currency: "USD" });
  }
  return l;
}

/** The mirror. Readable (GET /api/ledger) and authoritative ONLY in dev. */
export const ledger: Ledger = g.__ledgerV3 ?? (g.__ledgerV3 = build());

function openMirror(spec: AccountSpec): string {
  ledger.openAccount({ ...spec, type: spec.type as never, currency: "USD" });
  return spec.id;
}

/** Convert a USD float to integer cents. Throws on NaN/negative; a true zero
 *  stays zero — silently coercing 0 to 1 cent (the old behavior) masks bugs. */
export function usdToCents(usd: number): number {
  if (!Number.isFinite(usd) || usd < 0) {
    throw new LedgerError(`Invalid USD amount: ${usd}`);
  }
  return Math.round(usd * 100);
}

let seq = 0;
function nextTxId(): string {
  // Durable and mirror postings MUST share an id: it is what makes a retry a
  // no-op on the Postgres side (ledger_post returns early on a known id) and
  // what lets an operator match a mirror row to the real one.
  return `txn_${Date.now().toString(36)}_${(++seq).toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

/**
 * Post a balanced transaction: Postgres first, mirror second.
 *
 * ORDER MATTERS. The durable write is the one that counts, so it happens first
 * and a failure propagates — the caller must not believe money was recorded.
 * The mirror is updated only after Postgres accepted, so the two cannot
 * disagree in the direction that matters (mirror showing a posting the book
 * does not have).
 */
async function post(
  memo: string,
  accounts: AccountSpec[],
  postings: Posting[],
  opts: { reverses?: string } = {}
): Promise<{ id: string }> {
  assertLedgerDurable();
  const id = nextTxId();

  if (ledgerDurable()) {
    for (const a of accounts) {
      await ensureLedgerAccount({
        id: a.id,
        code: a.code,
        name: a.name,
        type: a.type as never,
        currency: "USD",
      });
    }
    const written = await postLedgerTransaction({ id, memo, postings, reverses: opts.reverses });
    if (written === null) {
      // optional() returned null: the backend reported itself present at
      // paymentsDurable() but the relation is missing. That is a half-applied
      // migration, and continuing on the mirror is exactly the silent
      // degradation this rewrite exists to remove.
      throw new LedgerDurabilityError();
    }
  }

  for (const a of accounts) openMirror(a);
  ledger.post(memo, postings, { id, reverses: opts.reverses });
  return { id };
}

// ── the postings ───────────────────────────────────────────────────────────

/** The ledger account id for a user's fiat cash position. */
export function userCashAccount(userId: string): string {
  return openMirror(userFiatLiability(userId));
}

/**
 * What we owe this user, in cents. Positive = we owe them.
 *
 * The account is a LIABILITY now rather than an asset, and `balanceOf` is
 * sign-aware by normal side, so the number a caller reads is unchanged in sign
 * while the bookkeeping underneath is finally the right way round.
 */
export function ledgerBalanceCents(userId: string): number {
  return ledger.balanceOf(userCashAccount(userId));
}

/**
 * Record a money movement for a user.
 *
 *   "in"  — funds arrive:  Dr bank escrow      / Cr customer fiat liability
 *   "out" — funds leave:   Dr customer liability / Cr bank escrow
 *
 * Both legs move together: the cash we hold and the obligation it backs. The
 * old version credited "external world", which recorded that something left
 * without recording what it left as.
 */
export async function recordMovement(
  direction: "in" | "out",
  amountUsd: number,
  memo: string,
  userId: string
): Promise<{ id: string }> {
  const cents = usdToCents(amountUsd);
  if (cents <= 0) throw new LedgerError(`Movement must be at least 1 cent (got $${amountUsd})`);

  const liability = userFiatLiability(userId);
  const escrow = ACCOUNTS.BANK_ESCROW;
  const postings: Posting[] =
    direction === "in"
      ? [
          { accountId: escrow.id, side: "debit", amount: cents },
          { accountId: liability.id, side: "credit", amount: cents },
        ]
      : [
          { accountId: liability.id, side: "debit", amount: cents },
          { accountId: escrow.id, side: "credit", amount: cents },
        ];

  return post(memo, [escrow, liability], postings);
}

/**
 * Record a fee-bearing stablecoin payment in ONE balanced transaction:
 *
 *   Dr customer stablecoin liability (amount)      — we owe the payer less
 *   Cr stablecoin treasury           (amount-fee)  — the recipient's share leaves
 *   Cr fee revenue                   (fee)         — what we keep
 *
 * so the fee can never silently diverge from the debit, and it lands in revenue
 * rather than being booked as an expense we paid ourselves.
 */
export async function recordPaymentWithFee(
  userId: string,
  amountUsd: number,
  feeUsd: number,
  memo: string
): Promise<{ id: string }> {
  const amount = usdToCents(amountUsd);
  const fee = usdToCents(feeUsd);
  if (amount <= 0) throw new LedgerError(`Payment must be at least 1 cent (got $${amountUsd})`);
  if (fee >= amount) throw new LedgerError(`Fee ${fee}c must be smaller than amount ${amount}c`);

  const liability = userStablecoinLiability(userId);
  const treasury = ACCOUNTS.STABLECOIN_TREASURY;
  const revenue = ACCOUNTS.FEE_REVENUE;

  const postings: Posting[] = [
    { accountId: liability.id, side: "debit", amount },
    { accountId: treasury.id, side: "credit", amount: amount - fee },
    ...(fee > 0 ? [{ accountId: revenue.id, side: "credit" as const, amount: fee }] : []),
  ];

  return post(memo, [liability, treasury, revenue], postings);
}

/**
 * Reverse a previously posted transaction (refunds).
 *
 * The compensating entry is posted through the same path, so it is durable and
 * mirrored like any other. The mirror's own reverse() enforces the two
 * invariants that a trial balance cannot catch — no double reversal, no
 * reversing a reversal — and Postgres enforces the first of them again with a
 * unique index on `reverses`.
 */
export async function reverseLedgerTx(txId: string, memo?: string): Promise<{ id: string }> {
  assertLedgerDurable();
  const original = ledger.getTransaction(txId);
  if (!original) throw new LedgerError(`Transaction not found: ${txId}`);
  if (original.reverses) {
    throw new LedgerError(`Cannot reverse a reversal: ${txId} already compensates ${original.reverses}`);
  }
  if (ledger.reversalOf(txId)) {
    throw new LedgerError(`Transaction ${txId} was already reversed`);
  }

  const flipped: Posting[] = original.postings.map((p) => ({
    accountId: p.accountId,
    side: p.side === "debit" ? "credit" : "debit",
    amount: p.amount,
  }));

  // Accounts already exist (they were opened by the original posting), so the
  // ensure pass is a no-op; passing them keeps this path identical to post()'s.
  const accounts = [...new Set(original.postings.map((p) => p.accountId))].map((id) => {
    const a = ledger.getAccount(id)!;
    return { id: a.id, code: a.code, name: a.name, type: a.type as string };
  });

  return post(memo ?? `Reversal of ${txId}`, accounts, flipped, { reverses: txId });
}

/** Whether a transaction has already been compensated. Lets a refund path be
 *  idempotent by asking rather than by reversing and hoping. */
export function alreadyReversed(txId: string): boolean {
  return !!ledger.reversalOf(txId);
}

/**
 * Seed the demo user's opening position (development only).
 *
 * Kept OUT of build(): the old version posted $16,748.37 of opening balance as
 * a module side effect, so importing the ledger created money. It is now an
 * explicit call, it books against opening equity rather than an "external
 * world" catch-all, and it refuses to run outside development.
 */
export async function seedDemoOpeningBalance(): Promise<void> {
  if (financialEnvironment() !== "development") return;
  const liability = userFiatLiability(DEMO_USER_ID);
  if (ledger.balanceOf(openMirror(liability)) !== 0) return;
  try {
    await post(
      "Opening balance (demo)",
      [ACCOUNTS.OPENING_EQUITY, liability],
      [
        { accountId: ACCOUNTS.OPENING_EQUITY.id, side: "debit", amount: 1_674_837 },
        { accountId: liability.id, side: "credit", amount: 1_674_837 },
      ]
    );
  } catch (e) {
    log.warn("demo opening balance not seeded", { error: (e as Error).message });
  }
}
