import { sbDelete, sbInsert, sbSelect, sbUpsert } from "./supabase";
import type { IdentityLookup, User, UserAccount } from "./store";
import type {
  Bill,
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
    tier: u.tier,
    roles: u.roles,
    security: u.security,
    notifications: u.notifications,
  };
}

function accountFromRow(r: UserRowEmbedded): UserAccount {
  return {
    user: userFromRow(r),
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
  return rows[0] ? accountFromRow(rows[0]) : undefined;
}

/**
 * Whole-account write-back. Children are replaced (delete + insert) so
 * removals persist; transactions are append-mostly, so the newest TX_LIMIT
 * are upserted and history beyond that is left untouched.
 */
export async function saveAccount(account: UserAccount): Promise<void> {
  const uid = account.user.id;
  const byUser = `user_id=eq.${encodeURIComponent(uid)}`;

  await sbUpsert<UserRow>("users", userToRow(account.user));

  const replace = async <R>(table: string, rows: R[]): Promise<void> => {
    await sbDelete(table, byUser);
    if (rows.length) await sbInsert<R>(table, rows);
  };

  await Promise.all([
    replace<TokenBalanceRow>(
      "token_balances",
      account.tokenBalances.map((b) => ({
        user_id: uid,
        token: b.token,
        chain: b.chain,
        amount: b.amount,
        usd_value: b.usdValue,
      }))
    ),
    replace<FiatBalanceRow>(
      "fiat_balances",
      account.fiatBalances.map((b) => ({
        user_id: uid,
        currency: b.currency,
        amount: b.amount,
        usd_value: b.usdValue,
        local_details: b.localDetails ?? null,
      }))
    ),
    replace<HoldingRow>(
      "holdings",
      account.holdings.map((h) => ({
        user_id: uid,
        symbol: h.symbol,
        name: h.name,
        shares: h.shares,
        price: h.price,
        change_pct: h.changePct,
        market_value: h.marketValue,
        cost_basis: h.costBasis,
      }))
    ),
    replace<CardRow>(
      "cards",
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
      }))
    ),
    replace<BillRow>(
      "bills",
      account.bills.map((b) => ({
        id: b.id,
        user_id: uid,
        provider: b.provider,
        category: b.category,
        balance_due: b.balanceDue,
        due_date: b.dueDate,
        autopay: b.autopay,
      }))
    ),
    sbUpsert<TransactionRow>(
      "transactions",
      account.transactions.slice(0, TX_LIMIT).map((t) => ({
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
      }))
    ),
  ]);
}

/** Resolve a verified identifier to a user id via the unique indexes.
 *  Same precedence as the in-memory maps: googleSub, appleSub, phone, email. */
export async function findUserIdByIdentity(lookup: IdentityLookup): Promise<string | undefined> {
  const filters: string[] = [];
  if (lookup.googleSub) filters.push(`google_sub=eq.${encodeURIComponent(lookup.googleSub)}`);
  if (lookup.appleSub) filters.push(`apple_sub=eq.${encodeURIComponent(lookup.appleSub)}`);
  if (lookup.phone) filters.push(`phone=eq.${encodeURIComponent(lookup.phone)}`);
  if (lookup.email) filters.push(`email=eq.${encodeURIComponent(lookup.email)}`);

  for (const filter of filters) {
    const rows = await sbSelect<{ id: string }>("users", `${filter}&select=id&limit=1`);
    if (rows[0]) return rows[0].id;
  }
  return undefined;
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
