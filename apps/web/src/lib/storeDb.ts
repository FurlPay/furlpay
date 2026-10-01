import { sbDelete, sbRpc, sbSelect, sbUpsert, SupabaseFunctionMissing } from "./supabase";
import { canonicalEmail } from "./identity";
import { log } from "./log";
import type { IdentityLookup, User, UserAccount } from "./store";
import type {
  CorporateAction,
  DividendEvent,
  ReorgEvent,
  ReorgTerms,
  TradeLot,
} from "./corporateActions/types";
import type {
  Bill,
  Contact,
  ContactAddress,
  FiatBalance,
  Holding,
  PaymentCard,
  TokenBalance,
  Transaction,
} from "./types";

// ---------------------------------------------------------------------------
// Postgres persistence for the user store (schema: supabase/migrations/
// 0001_init.sql). store.ts owns the in-memory working set and calls these
// three operations:
//
//   loadAccount(userId)     — one embedded PostgREST select → UserAccount
//   saveAccount(account)    — whole-account write-back (upsert user, replace
//                             children, upsert recent transactions)
//   findUserIdByIdentity()  — resolve a verified identifier via the unique
//                             indexes, so logins find accounts created on
//                             other instances
//
// Whole-account granularity is deliberate: routes mutate UserAccount objects
// in place, so the flush in store.ts persists the object wholesale. Row
// counts per user are tiny (a handful of balances/cards/bills); transactions
// are capped at the most recent TX_LIMIT rows both ways.
// ---------------------------------------------------------------------------

const TX_LIMIT = 100;

// --- row shapes (snake_case, as PostgREST returns them) ---------------------

interface UserRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  phone_verified: boolean;
  auth_provider: User["authProvider"] | null;
  google_sub: string | null;
  apple_sub: string | null;
  safe_address: string;
  kyc_status: User["kycStatus"];
  kyc_tier: User["kycTier"];
  region: User["region"];
  /** Added in migration 0007; absent on deployments still on 0006. */
  tax_residency?: string | null;
  tier: User["tier"];
  roles: User["roles"];
  security: User["security"];
  notifications: User["notifications"];
}

interface TokenBalanceRow {
  user_id: string;
  token: TokenBalance["token"];
  chain: TokenBalance["chain"];
  amount: number;
  usd_value: number;
}

interface FiatBalanceRow {
  user_id: string;
  currency: string;
  amount: number;
  usd_value: number;
  local_details: FiatBalance["localDetails"] | null;
}

interface HoldingRow {
  user_id: string;
  symbol: string;
  name: string;
  shares: number;
  price: number;
  change_pct: number;
  market_value: number;
  cost_basis: number;
}

/**
 * Lot rows are APPEND-ONLY and are never pruned, unlike every other child
 * table here. A closed or superseded lot is the audit record proving what a
 * position looked like before a sale or a split — deleting it would make
 * realized gains and split adjustments unverifiable after the fact.
 */
interface TradeLotRow {
  id: string;
  user_id: string;
  symbol: string;
  quantity: number;
  cost_basis: number;
  acquired_at: string;
  status: string;
  provenance: string;
  source_lot_id: string | null;
  corporate_action_id: string | null;
  order_id: string | null;
  /** Spin-off basis apportionment; added in migration 0007, so absent on any
   *  deployment still on 0006. */
  basis_allocation_pct?: string | number | null;
}

interface CardRow {
  id: string;
  user_id: string;
  kind: PaymentCard["kind"];
  label: string;
  last4: string;
  network: PaymentCard["network"];
  frozen: boolean;
  gradient: PaymentCard["gradient"];
  limits: PaymentCard["limits"];
  channels: PaymentCard["channels"];
  settlement_currency: string;
}

interface BillRow {
  id: string;
  user_id: string;
  provider: string;
  category: Bill["category"];
  balance_due: number;
  due_date: string;
  autopay: boolean;
}

interface TransactionRow {
  id: string;
  user_id: string;
  category: Transaction["category"];
  direction: Transaction["direction"];
  title: string;
  subtitle: string;
  amount_usd: number;
  token: Transaction["token"] | null;
  chain: Transaction["chain"] | null;
  card_id: string | null;
  ts: string;
  status: Transaction["status"];
}

interface ContactRow {
  id: string;
  name: string;
  avatar_color: string;
  addresses: ContactAddress[] | null;
  is_favorite: boolean;
  created_at: string;
  updated_at: string;
}

type UserRowEmbedded = UserRow & {
  token_balances: TokenBalanceRow[];
  fiat_balances: FiatBalanceRow[];
  holdings: HoldingRow[];
  cards: CardRow[];
  bills: BillRow[];
  transactions: TransactionRow[];
};

// --- mappers -----------------------------------------------------------------

function userFromRow(r: UserRow): User {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    phone: r.phone ?? undefined,
    phoneVerified: r.phone_verified,
    authProvider: r.auth_provider ?? undefined,
    googleSub: r.google_sub ?? undefined,
    appleSub: r.apple_sub ?? undefined,
    safeAddress: r.safe_address,
    kycStatus: r.kyc_status,
    kycTier: r.kyc_tier,
    region: r.region,
    ...(r.tax_residency ? { taxResidency: r.tax_residency } : {}),
    tier: r.tier,
    roles: r.roles,
    security: r.security,
    notifications: r.notifications,
  };
}

function userToRow(u: User): UserRow {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone ?? null,
    phone_verified: !!u.phoneVerified,
    auth_provider: u.authProvider ?? null,
    google_sub: u.googleSub ?? null,
    apple_sub: u.appleSub ?? null,
    safe_address: u.safeAddress,
    kyc_status: u.kycStatus,
    kyc_tier: u.kycTier,
    region: u.region,
    tax_residency: u.taxResidency ?? null,
    tier: u.tier,
    roles: u.roles,
    security: u.security,
    notifications: u.notifications,
  };
}

function accountFromRow(r: UserRowEmbedded): UserAccount {
  return {
    user: userFromRow(r),
    // Lot ledger (migration 0006), attached by loadAccount as a SEPARATE
    // query — deliberately not an embedded select.
    //
    // Embedding it here returned HTTP 400 (PGRST200 "could not find a
    // relationship") on any deployment without 0006, which failed the WHOLE
    // account load and silently degraded every account to its in-memory copy.
    // An optional table must never be able to break the required ones.
    tradeLots: [],
    tokenBalances: r.token_balances.map((b) => ({
      token: b.token,
      chain: b.chain,
      amount: Number(b.amount),
      usdValue: Number(b.usd_value),
    })),
    fiatBalances: r.fiat_balances.map((b) => ({
      currency: b.currency,
      amount: Number(b.amount),
      usdValue: Number(b.usd_value),
      localDetails: b.local_details ?? undefined,
    })),
    holdings: r.holdings.map((h) => ({
      symbol: h.symbol,
      name: h.name,
      shares: Number(h.shares),
      price: Number(h.price),
      changePct: Number(h.change_pct),
      marketValue: Number(h.market_value),
      costBasis: Number(h.cost_basis),
    })),
    cards: r.cards.map((c) => ({
      id: c.id,
      kind: c.kind,
      label: c.label,
      last4: c.last4,
      network: c.network,
      frozen: c.frozen,
      gradient: c.gradient,
      limits: c.limits,
      channels: c.channels,
      settlementCurrency: c.settlement_currency,
    })),
    bills: r.bills.map((b) => ({
      id: b.id,
      provider: b.provider,
      category: b.category,
      balanceDue: Number(b.balance_due),
      dueDate: b.due_date,
      autopay: b.autopay,
    })),
    // Attached by loadAccount as a SEPARATE query, for the same reason as
    // tradeLots above: `contacts(*)` embedded here 400s the WHOLE account load
    // on any deployment without migration 0010.
    contacts: [],
    // Embedded order is applied at query time (ts desc), but re-sort
    // defensively — the feed everywhere assumes newest-first.
    transactions: r.transactions
      .map((t) => ({
        id: t.id,
        category: t.category,
        direction: t.direction,
        title: t.title,
        subtitle: t.subtitle,
        amountUsd: Number(t.amount_usd),
        token: t.token ?? undefined,
        chain: t.chain ?? undefined,
        cardId: t.card_id ?? undefined,
        timestamp: t.ts,
        status: t.status,
      }))
      .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1)),
  };
}

// --- operations ----------------------------------------------------------------

/** Load one account with all child rows in a single PostgREST request. */
export async function loadAccount(userId: string): Promise<UserAccount | undefined> {
  const rows = await sbSelect<UserRowEmbedded>(
    "users",
    `id=eq.${encodeURIComponent(userId)}` +
      `&select=*,token_balances(*),fiat_balances(*),holdings(*),cards(*),bills(*),transactions(*)` +
      `&transactions.order=ts.desc&transactions.limit=${TX_LIMIT}`
  );
  if (!rows[0]) return undefined;
  const account = accountFromRow(rows[0]);
  // undefined => the ledger could not be READ (table absent / query failed).
  // [] => read successfully and the user genuinely holds no lots. store.ts
  // relies on this distinction; collapsing them resurrects sold positions.
  const ledger = await loadLots(userId);
  account.tradeLots = ledger.lots;
  account.lotsReadable = ledger.readable;
  account.contacts = await loadContacts(userId);
  return account;
}

/**
 * Address book for one user — a SEPARATE query, for the reason documented on
 * loadLots(): embedding an optional table fails the entire account load on a
 * deployment that has not applied its migration.
 *
 * Unlike the lot ledger there is no readable/empty distinction to preserve. A
 * lost lot resurrects a sold position; a contact list that reads empty is a
 * momentarily empty address book, and the next successful load restores it.
 * Contacts are never the source of truth for money movement — the address the
 * user confirms is — so degrading to [] is safe.
 */
async function loadContacts(userId: string): Promise<Contact[]> {
  try {
    const rows = await sbSelect<ContactRow>(
      "contacts",
      `user_id=eq.${encodeURIComponent(userId)}&select=*&order=name.asc`
    );
    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      avatarColor: c.avatar_color,
      addresses: c.addresses ?? [],
      isFavorite: c.is_favorite,
      createdAt: Date.parse(c.created_at) || Date.now(),
      updatedAt: Date.parse(c.updated_at) || Date.now(),
    }));
  } catch (e) {
    log.error("contacts unreadable — address book degrades to empty", {
      userId,
      error: (e as Error).message,
    });
    return [];
  }
}

/**
 * Lot ledger for one user — a SEPARATE query, on purpose.
 *
 * Embedding `trade_lots(*)` in the account select above returns HTTP 400
 * (PGRST200: "could not find a relationship between 'users' and 'trade_lots'")
 * on any deployment where migration 0006 has not been applied. That failed the
 * entire account load, so balances, cards and transactions all silently fell
 * back to the in-memory copy because of an OPTIONAL table.
 *
 * Isolated and best-effort, a missing table costs exactly one empty ledger —
 * and callers already treat "no lots" as "not migrated" and fall back to the
 * `holdings` aggregate.
 */
async function loadLots(userId: string): Promise<{ lots: TradeLot[]; readable: boolean }> {
  try {
    const rows = await sbSelect<TradeLotRow>(
      "trade_lots",
      `user_id=eq.${encodeURIComponent(userId)}&select=*&order=acquired_at.asc`
    );
    return {
      readable: true,
      lots: rows.map((l) => ({
        id: l.id,
        userId: l.user_id,
        symbol: l.symbol,
        quantity: Number(l.quantity),
        costBasis: Number(l.cost_basis),
        acquiredAt: l.acquired_at,
        status: l.status as TradeLot["status"],
        provenance: (l.provenance ?? "execution") as TradeLot["provenance"],
        ...(l.source_lot_id ? { sourceLotId: l.source_lot_id } : {}),
        ...(l.corporate_action_id ? { fromCorporateActionId: l.corporate_action_id } : {}),
        ...(l.basis_allocation_pct != null
          ? { basisAllocationPct: Number(l.basis_allocation_pct) }
          : {}),
      })),
    };
  } catch (e) {
    // Unreadable is NOT the same as empty. Returning readable:false tells
    // store.ts to keep whatever ledger it already has rather than treating a
    // missing table as "this user sold everything".
    log.error("trade_lots unreadable — keeping the in-memory ledger", {
      userId,
      error: (e as Error).message,
    });
    return { lots: [], readable: false };
  }
}

/** PostgREST filter values are safe to interpolate only if they can't terminate
 *  the filter. Every key we prune on is an internal identifier (token, chain,
 *  currency, symbol, card/bill id), never free text — so anything outside this
 *  charset means we don't understand the key and must NOT risk a bad filter. */
const SAFE_KEY = /^[A-Za-z0-9_.:-]+$/;

interface CorporateActionRow {
  id: string;
  symbol: string;
  type: string;
  effective_date: string;
  record_date: string | null;
  payment_date: string | null;
  ratio: string | number | null;
  amount_per_share: string | number | null;
  new_symbol: string | null;
  source: string | null;
  confidence: string | null;
  supersedes: string | null;
  metadata: Record<string, unknown> | null;
}

/**
 * Pull reorganization terms out of the `metadata` JSONB.
 *
 * metadata also carries the raw provider payload, so this reads a NAMED `terms`
 * sub-object rather than the whole blob, and coerces each field individually. A
 * merger's cashPerShare arriving as the string "60" must not become NaN
 * downstream and silently zero out a realized gain.
 */
function termsFromMetadata(metadata: Record<string, unknown> | null): ReorgTerms | undefined {
  const raw = metadata?.terms;
  if (!raw || typeof raw !== "object") return undefined;
  const t = raw as Record<string, unknown>;
  const num = (v: unknown): number | undefined => {
    const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : undefined;
    return n != null && Number.isFinite(n) ? n : undefined;
  };
  const out: ReorgTerms = {
    ...(num(t.cashPerShare) != null ? { cashPerShare: num(t.cashPerShare) } : {}),
    ...(num(t.stockValuePerShare) != null
      ? { stockValuePerShare: num(t.stockValuePerShare) }
      : {}),
    ...(num(t.parentFmv) != null ? { parentFmv: num(t.parentFmv) } : {}),
    ...(num(t.childFmv) != null ? { childFmv: num(t.childFmv) } : {}),
    // Zero is MEANINGFUL here (worthless-security writeoff) and must survive,
    // so this checks for presence rather than truthiness.
    ...(num(t.liquidationPerShare) != null
      ? { liquidationPerShare: num(t.liquidationPerShare) }
      : {}),
    ...(typeof t.cashInLieuOfFractional === "boolean"
      ? { cashInLieuOfFractional: t.cashInLieuOfFractional }
      : {}),
  };
  return Object.keys(out).length ? out : undefined;
}

/**
 * System-wide corporate actions for a set of symbols. NOT user-scoped — a split
 * or dividend belongs to a symbol, not an account.
 *
 * Best-effort like loadLots(): a missing table (migration 0006 not applied)
 * returns [] so the portfolio read still renders. Holdings simply aren't
 * split-adjusted and no dividends surface — safe and honest, never fabricated.
 */
export async function loadCorporateActions(symbols?: string[]): Promise<CorporateAction[]> {
  try {
    let filter = "select=*&order=effective_date.asc";
    if (symbols && symbols.length) {
      // Symbols are internal tickers; anything outside the safe charset is
      // dropped rather than risk a malformed (or injected) PostgREST filter.
      const safe = [...new Set(symbols.map((s) => s.toUpperCase()))].filter((s) => SAFE_KEY.test(s));
      if (!safe.length) return [];
      filter = `symbol=in.(${safe.join(",")})&select=*&order=effective_date.asc`;
    }
    const rows = await sbSelect<CorporateActionRow>("corporate_actions", filter);
    return rows.map((r) => ({
      id: r.id,
      symbol: r.symbol,
      type: r.type as CorporateAction["type"],
      effectiveDate: r.effective_date,
      ...(r.record_date ? { recordDate: r.record_date } : {}),
      ...(r.payment_date ? { paymentDate: r.payment_date } : {}),
      ...(r.ratio != null ? { ratio: Number(r.ratio) } : {}),
      ...(r.amount_per_share != null ? { amountPerShare: Number(r.amount_per_share) } : {}),
      ...(r.new_symbol ? { newSymbol: r.new_symbol } : {}),
      source: (r.source ?? "manual") as CorporateAction["source"],
      confidence: (r.confidence ?? "confirmed") as CorporateAction["confidence"],
      ...(r.supersedes ? { supersedes: r.supersedes } : {}),
      ...(termsFromMetadata(r.metadata) ? { terms: termsFromMetadata(r.metadata) } : {}),
    }));
  } catch (e) {
    log.error("corporate_actions unreadable — projecting without actions", {
      error: (e as Error).message,
    });
    return [];
  }
}

interface CorporateActionWriteRow {
  id: string;
  symbol: string;
  type: string;
  effective_date: string;
  record_date: string | null;
  payment_date: string | null;
  ratio: number | null;
  amount_per_share: number | null;
  new_symbol: string | null;
  source: string;
  confidence: string;
  supersedes: string | null;
  metadata: Record<string, unknown>;
}

/**
 * Idempotently upsert corporate actions (PK = id, so Alpaca's action id keyed a
 * re-run merges in place). The raw provider payload rides in `metadata` for
 * later reconciliation. Throws on failure — a silent ingest is worse than a
 * loud one — so the calling route surfaces it.
 */
export async function saveCorporateActions(
  entries: { action: CorporateAction; raw?: unknown }[],
): Promise<number> {
  if (!entries.length) return 0;
  const rows: CorporateActionWriteRow[] = entries.map(({ action, raw }) => ({
    id: action.id,
    symbol: action.symbol,
    type: action.type,
    effective_date: action.effectiveDate,
    record_date: action.recordDate ?? null,
    payment_date: action.paymentDate ?? null,
    ratio: action.ratio ?? null,
    amount_per_share: action.amountPerShare ?? null,
    new_symbol: action.newSymbol ?? null,
    source: action.source,
    confidence: action.confidence,
    supersedes: action.supersedes ?? null,
    metadata: (raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}),
  }));
  await sbUpsert<CorporateActionWriteRow>("corporate_actions", rows);
  return rows.length;
}

interface DividendEventRow {
  id: string;
  user_id: string;
  corporate_action_id: string;
  symbol: string;
  shares_held: number;
  amount_per_share: number;
  gross_amount: number;
  withholding_tax: number;
  net_amount: number;
  reinvested: boolean;
  drip_lot_id: string | null;
  status: string;
}

/**
 * Corporate-action ids already PAID to this user — the idempotency key set for
 * dividend settlement.
 *
 * THROWS on failure, unlike every other loader in this file, and the asymmetry
 * is deliberate. Elsewhere an unreadable optional table costs a degraded read:
 * holdings render unadjusted, no dividends surface, nobody loses money. Here an
 * empty result means "nothing has been paid yet", and returning that after a
 * failed read would re-pay every dividend the user has ever received.
 *
 * A settlement run that cannot prove what it already paid must not run at all.
 */
export async function loadSettledDividendIds(userId: string): Promise<Set<string>> {
  const rows = await sbSelect<{ corporate_action_id: string }>(
    "dividend_events",
    `user_id=eq.${encodeURIComponent(userId)}&select=corporate_action_id`
  );
  return new Set(rows.map((r) => r.corporate_action_id));
}

/**
 * Persist dividend settlements.
 *
 * Upsert on the PRIMARY KEY is not the real protection here — the
 * `dividend_once_per_user` UNIQUE (user_id, corporate_action_id) constraint from
 * 0006 is. Two concurrent settlement runs that both read an empty settled-set
 * will both try to insert, and the database rejects the loser rather than
 * paying twice. That rejection surfaces as a throw: the caller must NOT credit
 * cash for a batch that failed to record.
 */
export async function saveDividendEvents(events: DividendEvent[]): Promise<number> {
  if (!events.length) return 0;
  const rows: DividendEventRow[] = events.map((e) => ({
    id: e.id,
    user_id: e.userId,
    corporate_action_id: e.corporateActionId,
    symbol: e.symbol,
    shares_held: e.sharesHeld,
    amount_per_share: e.amountPerShare,
    gross_amount: e.grossAmount,
    withholding_tax: e.withholdingTax,
    net_amount: e.netAmount,
    reinvested: e.reinvested,
    drip_lot_id: e.dripLotId ?? null,
    status: e.status,
  }));
  await sbUpsert<DividendEventRow>("dividend_events", rows);
  return rows.length;
}

/** Settled dividends for a user, newest first — the payout history read model. */
export async function loadDividendEvents(userId: string): Promise<DividendEvent[]> {
  try {
    const rows = await sbSelect<DividendEventRow>(
      "dividend_events",
      `user_id=eq.${encodeURIComponent(userId)}&select=*&order=created_at.desc`
    );
    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      corporateActionId: r.corporate_action_id,
      symbol: r.symbol,
      sharesHeld: Number(r.shares_held),
      amountPerShare: Number(r.amount_per_share),
      grossAmount: Number(r.gross_amount),
      withholdingTax: Number(r.withholding_tax),
      netAmount: Number(r.net_amount),
      reinvested: r.reinvested,
      ...(r.drip_lot_id ? { dripLotId: r.drip_lot_id } : {}),
      status: r.status as DividendEvent["status"],
    }));
  } catch (e) {
    // Read-only history: degrading to empty is safe here, unlike the settled-id
    // set above, because nothing pays out on the strength of this result.
    log.error("dividend_events unreadable — reporting no payout history", {
      userId,
      error: (e as Error).message,
    });
    return [];
  }
}

interface ReorgEventRow {
  id: string;
  user_id: string;
  corporate_action_id: string;
  symbol: string;
  type: string;
  cash_proceeds: number;
  realized_gain: number;
  status: string;
}

/**
 * Corporate-action ids whose reorganization has already been SETTLED for this
 * user — the idempotency key set for reorg settlement.
 *
 * THROWS on failure, for the same reason loadSettledDividendIds does: an empty
 * set after a failed read means "nothing settled yet" and would re-run every
 * cash merger and liquidation the user has ever had, double-paying the cash and
 * re-superseding lots that are already history.
 */
export async function loadSettledReorgIds(userId: string): Promise<Set<string>> {
  const rows = await sbSelect<{ corporate_action_id: string }>(
    "reorg_events",
    `user_id=eq.${encodeURIComponent(userId)}&select=corporate_action_id`
  );
  return new Set(rows.map((r) => r.corporate_action_id));
}

/**
 * Persist reorg settlements. The `reorg_once_per_user` UNIQUE constraint from
 * 0008 does the real idempotency work; a losing concurrent insert throws, and
 * the caller must NOT credit cash or swap the ledger for a batch that failed to
 * record.
 */
export async function saveReorgEvents(events: ReorgEvent[]): Promise<number> {
  if (!events.length) return 0;
  const rows: ReorgEventRow[] = events.map((e) => ({
    id: e.id,
    user_id: e.userId,
    corporate_action_id: e.corporateActionId,
    symbol: e.symbol,
    type: e.type,
    cash_proceeds: e.cashProceeds,
    realized_gain: e.realizedGain,
    status: e.status,
  }));
  await sbUpsert<ReorgEventRow>("reorg_events", rows);
  return rows.length;
}

/**
 * Whole-account write-back.
 *
 * Children are synced WRITE-FIRST, THEN PRUNED. The order matters enormously:
 * the previous implementation deleted a user's child rows and then re-inserted
 * them as two separate PostgREST calls, so a crash, a timeout, or a serverless
 * freeze in between left that user's balances at ZERO in Postgres — and any
 * concurrent read landing in the gap saw an empty wallet. Every account
 * mutation (a transfer, a card freeze) flushes, so that window was open
 * constantly.
 *
 * Upserting first and pruning after removes the failure mode: an interrupted
 * flush now leaves at worst a stale extra row, which the next flush clears. It
 * can never destroy a balance, and a reader never observes zero.
 *
 * This is crash-SAFE but still not one transaction. For true atomicity (a
 * single statement, no stale-row window at all) apply
 * supabase/migrations/0004_save_account_atomic.sql and the RPC path lights up.
 */
/** Flips to false the first time the RPC turns out to be missing, so we try the
 *  atomic path once and then stop paying a 404 on every flush. */
let atomicSaveAvailable = true;

/**
 * The durable token balances for one user — the authoritative figure after
 * migration 0025. Read back after every financial effect so the in-memory copy
 * reflects what Postgres committed, never the other way round.
 */
export async function loadTokenBalances(userId: string): Promise<TokenBalance[]> {
  const rows = await sbSelect<TokenBalanceRow>(
    "token_balances",
    `user_id=eq.${encodeURIComponent(userId)}&select=user_id,token,chain,amount,usd_value`
  );
  return rows.map((b) => ({
    token: b.token,
    chain: b.chain,
    amount: Number(b.amount),
    usdValue: Number(b.usd_value),
  }));
}

export async function saveAccount(account: UserAccount): Promise<void> {
  const uid = account.user.id;
  const byUser = `user_id=eq.${encodeURIComponent(uid)}`;

  await sbUpsert<UserRow>("users", userToRow(account.user));

  const children = {
    p_user_id: uid,
    // MONEY IS NOT WRITTEN BY THE SNAPSHOT once migration 0025 is applied: its
    // save_account_children accepts and IGNORES these two arguments, and
    // balances change only through apply_financial_effect (audit P0-2).
    // They are still SENT, deliberately: on a database that has not applied
    // 0025 yet, the 0010 function deletes-then-reinserts from them, and an
    // empty array would erase every balance. Sending the snapshot keeps a
    // pre-0025 database exactly as it was; 0025 is what makes it harmless.
    p_token_balances: account.tokenBalances.map((b) => ({
      token: b.token,
      chain: b.chain,
      amount: b.amount,
      usd_value: b.usdValue,
    })),
    p_fiat_balances: account.fiatBalances.map((b) => ({
      currency: b.currency,
      amount: b.amount,
      usd_value: b.usdValue,
      local_details: b.localDetails ?? null,
    })),
    p_holdings: account.holdings.map((h) => ({
      symbol: h.symbol,
      name: h.name,
      shares: h.shares,
      price: h.price,
      change_pct: h.changePct,
      market_value: h.marketValue,
      cost_basis: h.costBasis,
    })),
    p_cards: account.cards.map((c) => ({
      id: c.id,
      kind: c.kind,
      label: c.label,
      last4: c.last4,
      network: c.network,
      frozen: c.frozen,
      gradient: c.gradient,
      limits: c.limits,
      channels: c.channels,
      settlement_currency: c.settlementCurrency,
    })),
    p_bills: account.bills.map((b) => ({
      id: b.id,
      provider: b.provider,
      category: b.category,
      balance_due: b.balanceDue,
      due_date: b.dueDate,
      autopay: b.autopay,
    })),
    p_contacts: (account.contacts ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      avatar_color: c.avatarColor,
      addresses: c.addresses,
      is_favorite: c.isFavorite,
      created_at: new Date(c.createdAt).toISOString(),
      updated_at: new Date(c.updatedAt).toISOString(),
    })),
  };

  // Preferred path: the whole child write is one Postgres transaction, so no
  // partial state is ever observable (supabase/migrations/0004).
  if (atomicSaveAvailable) {
    try {
      await sbRpc<void>("save_account_children", children);
      await sbUpsert<TransactionRow>("transactions", txRows(account, uid));
      await saveLots(account, uid);
      return;
    } catch (e) {
      if (!(e instanceof SupabaseFunctionMissing)) throw e;
      atomicSaveAvailable = false; // migration 0004 not applied — use the fallback below
    }
  }

  /** Delete this user's rows whose single-column key is no longer present. */
  const prune = async (table: string, column: string, keys: string[]): Promise<void> => {
    if (!keys.length) return void (await sbDelete(table, byUser));
    if (!keys.every((k) => SAFE_KEY.test(k))) return; // unknown key shape — leave stale rows rather than risk a wrong filter
    const list = keys.map((k) => `"${k}"`).join(",");
    await sbDelete(table, `${byUser}&${column}=not.in.(${list})`);
  };

  /** Upsert every row, then drop the ones that no longer exist. */
  const sync = async <R>(
    table: string,
    column: string,
    rows: R[],
    keyOf: (row: R) => string
  ): Promise<void> => {
    if (rows.length) await sbUpsert<R>(table, rows);
    await prune(table, column, rows.map(keyOf));
  };

  /** token_balances is keyed on (token, chain) — prune the composite pair. */
  const syncTokenBalances = async (rows: TokenBalanceRow[]): Promise<void> => {
    if (rows.length) await sbUpsert<TokenBalanceRow>("token_balances", rows);
    if (!rows.length) return void (await sbDelete("token_balances", byUser));
    if (!rows.every((r) => SAFE_KEY.test(r.token) && SAFE_KEY.test(r.chain))) return;
    const pairs = rows.map((r) => `and(token.eq.${r.token},chain.eq.${r.chain})`).join(",");
    await sbDelete("token_balances", `${byUser}&not.or=(${pairs})`);
  };

  await saveLots(account, uid);

  await Promise.all([
    syncTokenBalances(
      account.tokenBalances.map((b) => ({
        user_id: uid,
        token: b.token,
        chain: b.chain,
        amount: b.amount,
        usd_value: b.usdValue,
      }))
    ),
    sync<FiatBalanceRow>(
      "fiat_balances",
      "currency",
      account.fiatBalances.map((b) => ({
        user_id: uid,
        currency: b.currency,
        amount: b.amount,
        usd_value: b.usdValue,
        local_details: b.localDetails ?? null,
      })),
      (r) => r.currency
    ),
    sync<HoldingRow>(
      "holdings",
      "symbol",
      account.holdings.map((h) => ({
        user_id: uid,
        symbol: h.symbol,
        name: h.name,
        shares: h.shares,
        price: h.price,
        change_pct: h.changePct,
        market_value: h.marketValue,
        cost_basis: h.costBasis,
      })),
      (r) => r.symbol
    ),
    sync<CardRow>(
      "cards",
      "id",
      account.cards.map((c) => ({
        id: c.id,
        user_id: uid,
        kind: c.kind,
        label: c.label,
        last4: c.last4,
        network: c.network,
        frozen: c.frozen,
        gradient: c.gradient,
        limits: c.limits,
        channels: c.channels,
        settlement_currency: c.settlementCurrency,
      })),
      (r) => r.id
    ),
    sync<BillRow>(
      "bills",
      "id",
      account.bills.map((b) => ({
        id: b.id,
        user_id: uid,
        provider: b.provider,
        category: b.category,
        balance_due: b.balanceDue,
        due_date: b.dueDate,
        autopay: b.autopay,
      })),
      (r) => r.id
    ),
    // Best-effort, unlike the tables above: on a deployment without migration
    // 0010 the table does not exist, and a rejected address-book write must not
    // fail the flush that carries balances and cards.
    syncContacts(account, uid),
    sbUpsert<TransactionRow>("transactions", txRows(account, uid)),
  ]);
}

/** Contacts for the non-atomic fallback path. Never rejects. */
async function syncContacts(account: UserAccount, uid: string): Promise<void> {
  const contacts = account.contacts ?? [];
  try {
    await sbUpsert<ContactRow & { user_id: string }>(
      "contacts",
      contacts.map((c) => ({
        id: c.id,
        user_id: uid,
        name: c.name,
        avatar_color: c.avatarColor,
        addresses: c.addresses,
        is_favorite: c.isFavorite,
        created_at: new Date(c.createdAt).toISOString(),
        updated_at: new Date(c.updatedAt).toISOString(),
      }))
    );
    // Prune deleted contacts. Ids are app-generated UUIDs, so they satisfy
    // SAFE_KEY; anything else is left alone rather than risking a wrong filter.
    const ids = contacts.map((c) => c.id);
    const byUser = `user_id=eq.${encodeURIComponent(uid)}`;
    if (!ids.length) {
      await sbDelete("contacts", byUser);
    } else if (ids.every((k) => SAFE_KEY.test(k))) {
      const list = ids.map((k) => `"${k}"`).join(",");
      await sbDelete("contacts", `${byUser}&id=not.in.(${list})`);
    }
  } catch (e) {
    log.error("contacts write failed — address book not persisted this flush", {
      userId: uid,
      error: (e as Error).message,
    });
  }
}

/** Transactions are append-mostly: the newest TX_LIMIT are upserted and older
 *  history is left untouched, so they are never part of the replace/prune set. */
/**
 * Lot rows for the write path.
 *
 * Deliberately NOT part of save_account_children (migration 0004), which
 * DELETES and re-inserts every child it manages. Lots are append-only: a
 * closed or split_adjusted row is the audit trail for a realized gain or a
 * split adjustment, and a delete/re-insert cycle would destroy it and churn
 * the primary keys other lots reference via source_lot_id.
 *
 * A plain upsert is both simpler and correct here — nothing is ever pruned.
 */
/**
 * Persist the lot ledger.
 *
 * Tolerates a deployment that has not applied migration 0006 yet: a missing
 * `trade_lots` table must not fail the whole account flush, which would take
 * balances and transactions down with it. The ledger stays in memory and
 * re-persists once the migration lands.
 */
async function saveLots(account: UserAccount, uid: string): Promise<void> {
  const rows = lotRows(account, uid);
  if (!rows.length) return;
  try {
    await sbUpsert<TradeLotRow>("trade_lots", rows);
  } catch (e) {
    const message = (e as Error).message ?? "";
    // PGRST205 = "Could not find the table in the schema cache" — 0006 has not
    // been applied to this deployment. That is the ONLY tolerable failure: the
    // ledger stays in memory and re-persists once the migration lands.
    const tableAbsent = /PGRST205|Could not find the table/i.test(message);
    if (!tableAbsent) {
      // Anything else is a real write failure — a CHECK violation, a bad
      // NUMERIC, a permissions problem. Swallowing those is how a lot silently
      // fails to persist while the API reports the trade as filled, which is
      // exactly the class of bug that produced the order-durability defect.
      // Surface it so the caller's flush fails loudly.
      log.error("trade_lots upsert REJECTED — surfacing", {
        userId: uid,
        lots: rows.length,
        error: message,
      });
      throw e;
    }
    log.error("trade_lots table absent (0006 not applied) — ledger kept in memory", {
      userId: uid,
      lots: rows.length,
    });
  }
}

function lotRows(account: UserAccount, uid: string): TradeLotRow[] {
  return (account.tradeLots ?? []).map((l) => ({
    id: l.id,
    user_id: uid,
    symbol: l.symbol,
    quantity: l.quantity,
    cost_basis: l.costBasis,
    acquired_at: l.acquiredAt,
    status: l.status,
    provenance: l.provenance ?? "execution",
    source_lot_id: l.sourceLotId ?? null,
    corporate_action_id: l.fromCorporateActionId ?? null,
    order_id: null,
  }));
}

function txRows(account: UserAccount, uid: string): TransactionRow[] {
  return account.transactions.slice(0, TX_LIMIT).map((t) => ({
    id: t.id,
    user_id: uid,
    category: t.category,
    direction: t.direction,
    title: t.title,
    subtitle: t.subtitle,
    amount_usd: t.amountUsd,
    token: t.token ?? null,
    chain: t.chain ?? null,
    card_id: t.cardId ?? null,
    ts: t.timestamp,
    status: t.status,
  }));
}

/** Resolve a verified identifier to a user id via the unique indexes.
 *  Same precedence as the in-memory maps: googleSub, appleSub, phone, email. */
export async function findUserIdByIdentity(lookup: IdentityLookup): Promise<string | undefined> {
  const filters: string[] = [];
  if (lookup.googleSub) filters.push(`google_sub=eq.${encodeURIComponent(lookup.googleSub)}`);
  if (lookup.appleSub) filters.push(`apple_sub=eq.${encodeURIComponent(lookup.appleSub)}`);
  if (lookup.phone) filters.push(`phone=eq.${encodeURIComponent(lookup.phone)}`);
  if (lookup.email) filters.push(`email=eq.${encodeURIComponent(canonicalEmail(lookup.email))}`);

  for (const filter of filters) {
    const rows = await sbSelect<{ id: string }>("users", `${filter}&select=id&limit=1`);
    if (rows[0]) return rows[0].id;
  }
  return undefined;
}

/**
 * Erase the user row. The RETENTION MODEL IS THE SCHEMA'S, not this function's
 * — deleting `users` is all it takes, because migrations 0001/0002/0005 already
 * encode what survives an erasure:
 *
 *   on delete cascade  → token_balances, fiat_balances, holdings, cards, bills,
 *                        transactions, trips, linked_wallets  (ERASED)
 *   on delete set null → deposits.user_id — the on-chain deposit ledger is the
 *                        "permanent record" (0002), so the row SURVIVES with the
 *                        subject detached  (PSEUDONYMIZED)
 *   no foreign key     → audit_log, ops_tx_events, ops_security_events —
 *                        "the trail must outlive account deletion (GDPR erasure
 *                        removes the user row, not the evidence that actions
 *                        happened)" (0002)  (RETAINED)
 *
 * Postgres applies all of that in ONE statement's transaction, so there is no
 * half-deleted state to reconcile.
 */
export async function deleteAccount(userId: string): Promise<void> {
  await sbDelete("users", `id=eq.${encodeURIComponent(userId)}`);
}

/** Resolve which user owns a card — the durable replacement for scanning
 *  listAccounts() in card webhooks on a cold instance. */
export async function findUserIdByCard(cardId: string): Promise<string | undefined> {
  const rows = await sbSelect<{ user_id: string }>(
    "cards",
    `id=eq.${encodeURIComponent(cardId)}&select=user_id&limit=1`
  );
  return rows[0]?.user_id;
}
