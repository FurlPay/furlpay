import { createHash, randomUUID } from "crypto";
import type { Role } from "./session";
import { log } from "./log";
import { supabaseBackend } from "./supabase";
import {
  findUserIdByCard as dbFindUserIdByCard,
  findUserIdByIdentity as dbFindUserIdByIdentity,
  loadAccount as dbLoadAccount,
  saveAccount as dbSaveAccount,
} from "./storeDb";
import type { TradeLot } from "./corporateActions/types";
import {
  Bill,
  Contact,
  FiatBalance,
  Holding,
  PaymentCard,
  TokenBalance,
  Transaction,
} from "./types";

// Routes reach persistence through store.ts, never storeDb directly. The
// corporate-actions loader/writer is system-wide (not account-scoped), so
// re-export both here rather than routing them through an account.
export { loadCorporateActions, saveCorporateActions } from "./storeDb";
// Dividend settlement is account-scoped but does not live on UserAccount: the
// events are their own append-only table with a UNIQUE constraint doing the
// idempotency work, so they are read and written directly rather than flushed
// as part of a whole-account write.
export { loadDividendEvents, loadSettledDividendIds, saveDividendEvents } from "./storeDb";
export { loadSettledReorgIds, saveReorgEvents } from "./storeDb";

// ---------------------------------------------------------------------------
// Multi-user data store. The in-memory maps are the working set every route
// reads and mutates synchronously; when Supabase credentials are present
// (supabaseBackend === "supabase") accounts hydrate from Postgres on first
// touch per instance and every mutation write-through-flushes the whole
// account (storeDb.ts). With no credentials it degrades to the pure
// in-memory demo store — routes never touch the maps directly either way.
//
// Identity model:
//   - Each user is a UserAccount keyed by a UUID user id.
//   - Verified identifiers (phone, email, googleSub, appleSub) are indexed so
//     auth routes RESOLVE OR CREATE the correct user instead of assuming the
//     seeded demo user. A stranger verifying their own phone gets their own
//     fresh account — never someone else's.
//   - The seeded demo user gets a DETERMINISTIC UUID (SHA-1 of a fixed
//     namespace + email) so every serverless instance derives the same id.
// ---------------------------------------------------------------------------

function uuidFromKey(key: string): string {
  const h = createHash("sha1").update(`furlpay:user:${key}`).digest("hex");
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Mint a fresh UUID for a newly registered user. */
export const newUserId = (): string => randomUUID();

/** Deterministic, full-length (20-byte) EVM address for a user's Safe.
 *  Real deployments derive this from the actual Safe deployment. */
function safeAddressFromKey(key: string): string {
  return "0x" + createHash("sha256").update(`furlpay:safe:${key}`).digest("hex").slice(0, 40);
}

/** Deterministic per-user TOTP secret (RFC 4648 base32, 20 bytes) — DEMO USER
 *  ONLY. Real enrollment mints a random secret via @furlpay/security. */
function totpSecretFromKey(key: string): string {
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes = createHash("sha256").update(`furlpay:totp:${key}`).digest().subarray(0, 20);
  let bits = "";
  for (const b of bytes) bits += b.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) out += ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

/** A cryptographically verified self-custodial wallet link. Contains no secret
 *  material — only the public address and proof metadata. */
export interface LinkedWallet {
  address: string; // EIP-55 checksummed
  chainFamily: "evm";
  verificationMethod: "eip191";
  verifiedAt: string; // ISO8601
  linkVersion: number; // schema/version of the link record
  status: "active";
  /** The one-time nonce that was signed (audit trail; not a secret). */
  proofNonce: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string; // E.164
  phoneVerified?: boolean;
  authProvider?: "passkey" | "google" | "apple" | "phone" | "email";
  googleSub?: string; // stable Google account id, when linked
  appleSub?: string; // stable Apple account id (sub), when linked
  /** Stable Discord user id (snowflake), when linked. NOT the username — a
   *  username is renameable and reusable, so keying identity on one would move
   *  an account to whoever claimed the handle next. Guild-independent by
   *  design: the same person in the server and in a DM is one account. */
  discordUserId?: string;
  /** DEPRECATED placeholder: `"0x"+sha256("furlpay:safe:"+key).slice(0,40)` —
   *  NOT derived from any private key, controls nothing on-chain. Kept for
   *  back-compat reads only; never used for on-chain ops and NEVER to be
   *  reinterpreted as a real wallet. See docs/BALANCE-CUSTODY-MAP.md. */
  safeAddress: string;
  /** The user's REAL self-custodial address, proven by an EIP-191 signature
   *  from the device key (docs/SELF-CUSTODIAL-WALLET-DESIGN.md Phase 1). Set
   *  only via setLinkedWallet after server-side signature recovery — never
   *  from an unverified client claim. Distinct from safeAddress by design. */
  linkedWallet?: LinkedWallet;
  kycStatus: "verified" | "pending" | "unverified";
  kycTier: 0 | 1 | 2 | 3;
  region: "EEA" | "US" | "IN" | "GLOBAL";
  /**
   * Tax residency, ISO-3166 alpha-2. Drives dividend withholding.
   *
   * DELIBERATELY SEPARATE FROM `region`, which is a product/compliance region
   * ("EEA", "GLOBAL") and cannot answer a tax question — an EEA user may be
   * resident in any of ~30 countries with different treaty rates, and "GLOBAL"
   * names no jurisdiction at all. Deriving withholding from it would produce a
   * confidently wrong number on someone's tax filing.
   *
   * Set only from verified KYC data (setTaxResidency), never from a client
   * claim: a self-declared residency is a self-declared tax rate. Unset
   * withholds at the full statutory 30% (see withholdingRateFor), which is
   * refundable to the holder — the safe direction to be wrong in.
   */
  taxResidency?: string;
  tier: "Standard" | "Pro" | "Ultra";
  /** Authorization roles. New signups get ["user"]; compliance_officer and
   *  admin are assigned out-of-band (ops console / DB), never self-service. */
  roles: Role[];
  security: {
    biometricEnabled: boolean;
    accountLocked: boolean;
    lastLogin: string; // ISO
    loginAlerts: boolean;
    totpEnabled: boolean;
    totpSecret: string; // base32 (never returned to the client)
    /**
     * Single-use MFA recovery codes, stored as SHA-256 HASHES.
     *
     * Never the codes themselves: this record is persisted and a plaintext
     * recovery code is a second factor. The user sees each code exactly once, at
     * generation. Consuming one deletes its hash, so a code cannot be replayed.
     *
     * Without these, a lost authenticator app means a permanently locked
     * account — the failure mode MFA is supposed to prevent turns into the one
     * it causes.
     */
    totpRecoveryCodes?: string[];
    hardwareKeys: { name: string; addedAt: string }[];
    devices: { name: string; location: string; lastActive: string; current: boolean }[];
  };
  notifications: {
    transactions: boolean;
    security: boolean;
    priceAlerts: boolean;
    product: boolean;
  };
}

export interface UserAccount {
  user: User;
  tokenBalances: TokenBalance[];
  fiatBalances: FiatBalance[];
  /**
   * DERIVED from tradeLots — not the source of truth.
   *
   * Kept as a materialised view because every read path (portfolio, watch
   * tiles, copilot) wants aggregate shares/basis, and recomputing the
   * projection on each read is wasteful. Writes go to tradeLots and re-project;
   * nothing should mutate this array directly any more.
   */
  holdings: Holding[];
  /**
   * The lot ledger — append-only, the actual source of truth for positions.
   *
   * A buy appends a lot; a sell consumes lots (FIFO by default) and records the
   * realized gain; a split supersedes lots with adjusted replacements. Without
   * this, a corporate action has to guess what the holder paid per share, and
   * realized gain / holding period are unknowable.
   */
  tradeLots: TradeLot[];
  /**
   * Whether the ledger in `tradeLots` actually came from the database.
   *
   * false means the read FAILED (migration 0006 not applied, table
   * unreachable) — NOT that the user holds nothing. mergeAccount uses this to
   * decide whether an empty DB result is authoritative.
   */
  lotsReadable?: boolean;
  cards: PaymentCard[];
  bills: Bill[];
  transactions: Transaction[];
  /**
   * Address book. Optional so that an account loaded by a deployment WITHOUT
   * migration 0010 (or hydrated from an older cached row) is still a valid
   * UserAccount rather than one with a silently missing field — every reader
   * goes through contactsFor() in lib/contacts.ts, which normalises it.
   */
  contacts?: Contact[];
}

interface AppState {
  accounts: Map<string, UserAccount>;
  // Verified-identifier → userId indexes. Keys are normalized (lowercased
  // email, E.164 phone as given).
  byPhone: Map<string, string>;
  byEmail: Map<string, string>;
  byGoogleSub: Map<string, string>;
  byAppleSub: Map<string, string>;
  byDiscordUserId: Map<string, string>;
  // Durability bookkeeping (Supabase backend only): userIds already loaded
  // from Postgres this instance, and per-user flush chains so whole-account
  // saves for one user never interleave.
  hydrated: Set<string>;
  flushes: Map<string, Promise<void>>;
}

export const DEMO_USER_EMAIL = "ashutosh@furlpay.app";
export const DEMO_USER_ID = uuidFromKey(DEMO_USER_EMAIL);

/** Backfill one lot per seeded holding. See the note at the call site: the
 *  acquisition date is an estimate, so it is stamped a year back — old enough
 *  to be plausible, and deliberately uniform so nothing reads as a real fill. */
function seedLots(userId: string, rows: [string, number, number][]): TradeLot[] {
  const acquiredAt = new Date(Date.now() - 365 * 86400_000).toISOString();
  return rows.map(([symbol, quantity, costBasis]) => ({
    id: `lot_seed_${symbol.toLowerCase()}`,
    userId,
    symbol,
    quantity,
    costBasis,
    acquiredAt,
    status: "open" as const,
    provenance: "seed" as const,
  }));
}

function seedDemoAccount(): UserAccount {
  return {
    user: {
      id: DEMO_USER_ID,
      name: "Ashutosh",
      email: DEMO_USER_EMAIL,
      safeAddress: safeAddressFromKey(DEMO_USER_EMAIL),
      kycStatus: "verified",
      kycTier: 2,
      region: "EEA",
      tier: "Pro",
      // The demo user doubles as the demo compliance officer so the HITL
      // console is clickable offline. approvePayment still enforces
      // reviewer != payer, so even this account cannot self-approve.
      roles: ["user", "compliance_officer", "admin"],
      security: {
        biometricEnabled: true,
        accountLocked: false,
        lastLogin: new Date(Date.now() - 2 * 3600_000).toISOString(),
        loginAlerts: true,
        totpEnabled: true,
        totpSecret: totpSecretFromKey(DEMO_USER_EMAIL),
        hardwareKeys: [{ name: "YubiKey 5C NFC", addedAt: new Date(Date.now() - 30 * 86400_000).toISOString() }],
        devices: [
          { name: "iPhone 17 Pro", location: "Amsterdam, NL", lastActive: new Date().toISOString(), current: true },
          { name: "MacBook Pro", location: "Amsterdam, NL", lastActive: new Date(Date.now() - 26 * 3600_000).toISOString(), current: false },
        ],
      },
      notifications: {
        transactions: true,
        security: true,
        priceAlerts: false,
        product: true,
      },
    },
    tokenBalances: [
      { token: "USDC", chain: "base", amount: 4210.55, usdValue: 4210.55 },
      { token: "USDC", chain: "solana", amount: 1890.0, usdValue: 1890.0 },
      { token: "EURC", chain: "base", amount: 980.4, usdValue: 1068.6 },
      { token: "USDT", chain: "arbitrum", amount: 640.12, usdValue: 640.12 },
      // MAS-regulated StraitsX pair — APAC settlement rails (XSGD ≈ $0.78).
      { token: "XSGD", chain: "arbitrum", amount: 2500.0, usdValue: 1950.0 },
      { token: "XUSD", chain: "ethereum", amount: 750.0, usdValue: 750.0 },
    ],
    // Demo fiat balances carry NO localDetails. They used to carry a routing
    // number attributed to a real US bank, a Wise IBAN/SWIFT pair, and a
    // personal UPI handle — fabricated payable destinations for institutions
    // FurlPay has no relationship with. A balance is a number we owe the demo
    // user; an account number is a claim about a bank. Only the first is ours
    // to seed. Same reasoning as api/banking/route.ts.
    fiatBalances: [
      { currency: "USD", amount: 3200.0, usdValue: 3200.0 },
      { currency: "EUR", amount: 1500.0, usdValue: 1635.0 },
      { currency: "INR", amount: 42000.0, usdValue: 503.4 },
    ],
    holdings: [
      // costBasis = what the user actually paid; live prices re-mark marketValue.
      { symbol: "AAPL", name: "Apple Inc.", shares: 3.4, price: 232.11, changePct: 0.82, marketValue: 789.17, costBasis: 702.1 },
      { symbol: "NVDA", name: "NVIDIA Corp.", shares: 1.1, price: 1284.5, changePct: 2.14, marketValue: 1412.95, costBasis: 1188.0 },
      { symbol: "VOO", name: "Vanguard S&P 500 ETF", shares: 2.0, price: 548.2, changePct: -0.34, marketValue: 1096.4, costBasis: 1004.6 },
      { symbol: "TSLA", name: "Tesla Inc.", shares: 0.75, price: 402.9, changePct: 1.05, marketValue: 302.18, costBasis: 286.9 },
    ],
    // Lot ledger backing the holdings above. The demo account predates lot
    // accounting, so these are BACKFILLED from each holding's aggregate basis:
    // one lot per position, quantity and basis matching exactly.
    //
    // `acquiredAt` is an ESTIMATE, not a real fill time — the original
    // purchase dates were never recorded. That matters beyond cosmetics: the
    // acquisition date decides short- vs long-term capital gains treatment, so
    // these lots must never be presented as though the date were observed.
    // A real fill writes its own lot with a true timestamp.
    tradeLots: seedLots(DEMO_USER_ID, [
      ["AAPL", 3.4, 702.1],
      ["NVDA", 1.1, 1188.0],
      ["VOO", 2.0, 1004.6],
      ["TSLA", 0.75, 286.9],
    ]),
    cards: [
      {
        id: "card_virtual_1",
        kind: "virtual",
        label: "Everyday Virtual",
        last4: "4417",
        network: "Visa",
        frozen: false,
        gradient: ["#1C0F35", "#E02020"],
        limits: { perPurchase: 2500, daily: 5000, dailySpent: 318.42 },
        channels: { online: true, offline: true, atm: false },
        settlementCurrency: "USD",
      },
      {
        id: "card_physical_1",
        kind: "physical",
        label: "Metal Physical",
        last4: "9082",
        network: "Visa",
        frozen: false,
        gradient: ["#0F0922", "#FF3B30"],
        limits: { perPurchase: 5000, daily: 10000, dailySpent: 1240.0 },
        channels: { online: true, offline: true, atm: true },
        settlementCurrency: "EUR",
      },
    ],
    bills: [
      { id: "bill_1", provider: "Pacific Gas & Electric", category: "utility", balanceDue: 142.31, dueDate: "2026-07-14", autopay: true },
      { id: "bill_2", provider: "Chase Sapphire", category: "credit-card", balanceDue: 890.0, dueDate: "2026-07-20", autopay: false },
      { id: "bill_3", provider: "Vodafone", category: "telecom", balanceDue: 39.99, dueDate: "2026-07-09", autopay: true },
    ],
    transactions: [
      tx("card", "out", "Blue Bottle Coffee", "Everyday Virtual · Visa", 6.75, "card_virtual_1", "settled", 1),
      tx("swap", "in", "Swapped USDT → USDC", "Li.Fi · Arbitrum → Base", 500, undefined, "settled", 3),
      tx("bill", "out", "Vodafone", "Autopay · USDC", 39.99, undefined, "settled", 8),
      tx("card", "out", "Marriott Hotels", "Pre-auth hold · Metal Physical", 150, "card_physical_1", "escrow", 10),
      tx("ramp", "in", "SEPA deposit", "Bridge.xyz · EUR → EURC", 1000, undefined, "settled", 26),
      tx("invest", "out", "Bought NVDA", "Alpaca · 0.4 shares", 513.8, undefined, "settled", 30),
      tx("card", "out", "Amazon.de", "Everyday Virtual · Visa", 84.2, "card_virtual_1", "settled", 33),
    ],
  };
}

/** A brand-new user starts empty: no balances, no cards, no history. */
function emptyAccount(user: User): UserAccount {
  return {
    user,
    tokenBalances: [],
    fiatBalances: [],
    holdings: [],
    tradeLots: [],
    cards: [],
    bills: [],
    transactions: [],
  };
}

function newUser(init: {
  name?: string;
  email?: string;
  phone?: string;
  phoneVerified?: boolean;
  authProvider?: User["authProvider"];
  googleSub?: string;
  appleSub?: string;
  discordUserId?: string;
}): User {
  const id = newUserId();
  return {
    id,
    name: init.name || init.email?.split("@")[0] || "New user",
    email: init.email || "",
    phone: init.phone,
    phoneVerified: init.phoneVerified,
    authProvider: init.authProvider,
    googleSub: init.googleSub,
    appleSub: init.appleSub,
    discordUserId: init.discordUserId,
    safeAddress: safeAddressFromKey(id),
    kycStatus: "unverified",
    kycTier: 0,
    region: "GLOBAL",
    tier: "Standard",
    roles: ["user"],
    security: {
      biometricEnabled: false,
      accountLocked: false,
      lastLogin: new Date().toISOString(),
      loginAlerts: true,
      totpEnabled: false,
      totpSecret: "",
      hardwareKeys: [],
      devices: [],
    },
    notifications: { transactions: true, security: true, priceAlerts: false, product: true },
  };
}

function tx(
  category: Transaction["category"],
  direction: Transaction["direction"],
  title: string,
  subtitle: string,
  amountUsd: number,
  cardId: string | undefined,
  status: Transaction["status"],
  hoursAgo: number
): Transaction {
  return {
    id: "tx_" + randomUUID(),
    category,
    direction,
    title,
    subtitle,
    amountUsd,
    cardId,
    status,
    timestamp: new Date(Date.now() - hoursAgo * 3600_000).toISOString(),
  };
}

function buildState(): AppState {
  const demo = seedDemoAccount();
  const state: AppState = {
    accounts: new Map([[demo.user.id, demo]]),
    byPhone: new Map(),
    byEmail: new Map([[demo.user.email.toLowerCase(), demo.user.id]]),
    byGoogleSub: new Map(),
    byAppleSub: new Map(),
    byDiscordUserId: new Map(),
    hydrated: new Set(),
    flushes: new Map(),
  };
  return state;
}

// Persist a single instance across hot-reloads / route invocations.
const globalForStore = globalThis as unknown as { __appStateV2?: AppState };
const state: AppState = globalForStore.__appStateV2 ?? (globalForStore.__appStateV2 = buildState());
// Hot-reload guard: state objects created before the durability fields existed.
state.hydrated ??= new Set();
state.flushes ??= new Map();

// ---------------------------------------------------------------------------
// Accessors — the only supported way to touch the store.
// ---------------------------------------------------------------------------

/** The seeded demo account. Exported as `db` for demo-surface routes; every
 *  money/identity path must resolve the acting user from session claims via
 *  getAccount() instead. */
export const db: UserAccount = state.accounts.get(DEMO_USER_ID)!;

export function getAccount(userId: string | undefined | null): UserAccount | undefined {
  if (!userId) return undefined;
  return state.accounts.get(userId);
}

export function listAccounts(): UserAccount[] {
  return [...state.accounts.values()];
}

/**
 * DEV-ONLY demo account. Returns undefined in production, ALWAYS — so no
 * account-mutating or security-sensitive path can silently fall back to the
 * shared seeded demo identity.
 *
 * This centralizes the invariant that produced the recurring FP-2..FP-5 bug
 * class: instead of each route hand-writing
 *   process.env.NODE_ENV !== "production" ? getAccountDurable(DEMO_USER_ID) : undefined
 * — which one route (escrow) got subtly wrong (`agentKeyId || …`) — every dev
 * fallback goes through this single guarded function. A future developer cannot
 * reintroduce the bug with a slightly different ternary: the production guard
 * lives here and nowhere else. The authenticated path (getAccountDurable of a
 * resolved principal) never references DEMO_USER_ID at all.
 */
export function getDevelopmentDemoAccount(): UserAccount | undefined {
  if (process.env.NODE_ENV === "production") return undefined;
  return state.accounts.get(DEMO_USER_ID);
}

/**
 * Drop an account from the in-memory working set AND every identity index, so
 * this instance stops resolving it. Account deletion (lib/accountDeletion.ts)
 * calls this after the Postgres row is gone: getAccountDurable() would
 * otherwise keep serving the cached copy and a deleted user's session would
 * still authenticate on this instance.
 *
 * `hydrated` is cleared too, so a later getAccountDurable() re-reads Postgres
 * (a miss) instead of short-circuiting on the stale hydration flag.
 *
 * The seeded demo account is never evictable — guest sessions share it, and
 * losing it would break every demo surface on the instance.
 */
export function evictAccount(userId: string): boolean {
  if (userId === DEMO_USER_ID) return false;
  const account = state.accounts.get(userId);
  if (!account) {
    state.hydrated.delete(userId);
    return false;
  }
  const { email, phone, googleSub, appleSub, discordUserId } = account.user;
  if (email) state.byEmail.delete(email.toLowerCase());
  if (phone) state.byPhone.delete(phone);
  if (googleSub) state.byGoogleSub.delete(googleSub);
  if (appleSub) state.byAppleSub.delete(appleSub);
  if (discordUserId) state.byDiscordUserId.delete(discordUserId);
  // Defensive: an index entry that points at this id but was keyed off an
  // identifier since changed on the user record would otherwise survive and
  // resolve a deleted account on the next login.
  for (const index of [
    state.byEmail,
    state.byPhone,
    state.byGoogleSub,
    state.byAppleSub,
    state.byDiscordUserId,
  ]) {
    for (const [key, id] of index) if (id === userId) index.delete(key);
  }
  state.accounts.delete(userId);
  state.hydrated.delete(userId);
  state.flushes.delete(userId);
  return true;
}

export interface IdentityLookup {
  phone?: string;
  email?: string;
  googleSub?: string;
  appleSub?: string;
  /** Stable Discord snowflake. Guild-independent, so the same person resolves
   *  to one account whether they use the bot in the server or in a DM. */
  discordUserId?: string;
}

export function findUserByIdentity(lookup: IdentityLookup): UserAccount | undefined {
  const id =
    (lookup.discordUserId && state.byDiscordUserId.get(lookup.discordUserId)) ||
    (lookup.googleSub && state.byGoogleSub.get(lookup.googleSub)) ||
    (lookup.appleSub && state.byAppleSub.get(lookup.appleSub)) ||
    (lookup.phone && state.byPhone.get(lookup.phone)) ||
    (lookup.email && state.byEmail.get(lookup.email.toLowerCase())) ||
    undefined;
  return id ? state.accounts.get(id) : undefined;
}

/**
 * Resolve the account for a VERIFIED identity, creating a fresh empty account
 * on first sight. Auth routes call this after (and only after) the identity
 * has been proven: OTP checked, Google/Apple token verified, passkey asserted.
 */
export function findOrCreateUserByIdentity(
  lookup: IdentityLookup & { name?: string; authProvider?: User["authProvider"] }
): { account: UserAccount; created: boolean } {
  const existing = findUserByIdentity(lookup);
  if (existing) return { account: existing, created: false };

  const user = newUser({
    name: lookup.name,
    email: lookup.email,
    phone: lookup.phone,
    phoneVerified: !!lookup.phone,
    authProvider: lookup.authProvider,
    googleSub: lookup.googleSub,
    appleSub: lookup.appleSub,
    discordUserId: lookup.discordUserId,
  });
  const account = emptyAccount(user);
  state.accounts.set(user.id, account);
  indexUser(user);
  return { account, created: true };
}

// ---------------------------------------------------------------------------
// Durable accessors (Supabase write-through). Sync accessors above stay the
// working-set API; async route entry points (authz, auth, webhooks) call
// these so a cold serverless instance sees accounts created elsewhere.
// ---------------------------------------------------------------------------

const durable = supabaseBackend === "supabase";

/** Merge fresh DB state into the live object IN PLACE so long-lived
 *  references (the `db` export, accounts captured by in-flight requests)
 *  observe it — replacing the map entry would fork the demo account. */
function mergeAccount(target: UserAccount, fresh: UserAccount): void {
  Object.assign(target.user, fresh.user);
  target.tokenBalances.splice(0, target.tokenBalances.length, ...fresh.tokenBalances);
  target.fiatBalances.splice(0, target.fiatBalances.length, ...fresh.fiatBalances);
  target.holdings.splice(0, target.holdings.length, ...fresh.holdings);
  // Only let the database overwrite the ledger when it could actually be READ.
  //
  // Two situations both produce an empty array and must not be conflated:
  //   - table missing / query failed  -> keep what we have (seeded or in-flight
  //     lots would otherwise be wiped on the next hydration)
  //   - read fine, genuinely zero rows -> the DB is authoritative; keeping the
  //     old array here would RESURRECT positions the user has already sold
  if (fresh.lotsReadable !== false) {
    target.tradeLots.splice(0, target.tradeLots.length, ...(fresh.tradeLots ?? []));
    target.lotsReadable = true;
  }
  target.cards.splice(0, target.cards.length, ...fresh.cards);
  target.bills.splice(0, target.bills.length, ...fresh.bills);
  target.transactions.splice(0, target.transactions.length, ...fresh.transactions);
}

/**
 * getAccount + first-touch hydration from Postgres. On a DB miss for an
 * account that exists in memory (the seeded demo user), the memory copy is
 * written through instead, so every instance converges on the DB row. On a
 * DB error this degrades to the in-memory copy — availability over
 * freshness; the flush chain will reconcile once the DB is reachable.
 */
export async function getAccountDurable(userId: string | undefined | null): Promise<UserAccount | undefined> {
  if (!userId) return undefined;
  const cached = state.accounts.get(userId);
  if (!durable || state.hydrated.has(userId)) return cached;

  try {
    const fresh = await dbLoadAccount(userId);
    state.hydrated.add(userId);
    if (fresh) {
      if (cached) {
        mergeAccount(cached, fresh);
      } else {
        state.accounts.set(userId, fresh);
      }
      const account = cached ?? fresh;
      indexUser(account.user);
      return account;
    }
    if (cached) await flushAccount(userId);
    return cached;
  } catch (e) {
    log.error("account hydration failed — serving in-memory copy", {
      userId,
      error: (e as Error).message,
    });
    return cached;
  }
}

/** Whole-account write-through, serialized per user so saves never
 *  interleave. Fire-and-forget from sync mutators (`void persistAccount(id)`),
 *  awaited where durability must be confirmed (signup). No-op without
 *  Supabase credentials or for accounts not in memory. */
export function persistAccount(userId: string): Promise<void> {
  if (!durable) return Promise.resolve();
  const account = state.accounts.get(userId);
  if (!account) return Promise.resolve();
  return flushAccount(userId);
}

function flushAccount(userId: string): Promise<void> {
  const prev = state.flushes.get(userId) ?? Promise.resolve();
  const next = prev.then(() => {
    const account = state.accounts.get(userId);
    if (!account) return;
    return dbSaveAccount(account).catch((e: Error) => {
      log.error("account flush failed", { userId, error: e.message });
    });
  });
  state.flushes.set(userId, next);
  return next;
}

/**
 * Durable findOrCreateUserByIdentity: memory first, then the DB unique
 * indexes (so logins find accounts created on other instances), then create.
 * Creation is flushed BEFORE returning so the session being issued never
 * references an account another instance can't load.
 */
export async function findOrCreateUserByIdentityDurable(
  lookup: IdentityLookup & { name?: string; authProvider?: User["authProvider"] }
): Promise<{ account: UserAccount; created: boolean }> {
  if (!durable) return findOrCreateUserByIdentity(lookup);

  const inMemory = findUserByIdentity(lookup);
  if (inMemory) {
    // Known locally — still hydrate once so this instance isn't stale.
    const account = (await getAccountDurable(inMemory.user.id)) ?? inMemory;
    return { account, created: false };
  }
  try {
    const userId = await dbFindUserIdByIdentity(lookup);
    if (userId) {
      const account = await getAccountDurable(userId);
      if (account) return { account, created: false };
    }
  } catch (e) {
    // DB outage during login: fall through and create in memory. If the
    // identity already exists in the DB, the eventual flush hits the unique
    // index and is logged rather than clobbering the existing row.
    log.error("identity lookup failed — falling back to in-memory resolve", {
      error: (e as Error).message,
    });
  }
  const { account, created } = findOrCreateUserByIdentity(lookup);
  state.hydrated.add(account.user.id);
  if (created) await persistAccount(account.user.id);
  return { account, created };
}

/** Resolve a card to its owning account across instances — card webhooks on
 *  a cold instance can't rely on the in-memory scan. */
export async function findAccountByCard(
  cardId: string
): Promise<{ account: UserAccount; card: PaymentCard } | undefined> {
  for (const account of state.accounts.values()) {
    if (account.cards.some((c) => c.id === cardId)) {
      const hydrated = (await getAccountDurable(account.user.id)) ?? account;
      const card = hydrated.cards.find((c) => c.id === cardId);
      if (card) return { account: hydrated, card };
    }
  }
  if (!durable) return undefined;
  try {
    const userId = await dbFindUserIdByCard(cardId);
    const account = userId ? await getAccountDurable(userId) : undefined;
    const card = account?.cards.find((c) => c.id === cardId);
    return account && card ? { account, card } : undefined;
  } catch (e) {
    log.error("card owner lookup failed", { cardId, error: (e as Error).message });
    return undefined;
  }
}

function indexUser(user: User): void {
  if (user.phone) state.byPhone.set(user.phone, user.id);
  if (user.email) state.byEmail.set(user.email.toLowerCase(), user.id);
  if (user.googleSub) state.byGoogleSub.set(user.googleSub, user.id);
  if (user.appleSub) state.byAppleSub.set(user.appleSub, user.id);
  if (user.discordUserId) state.byDiscordUserId.set(user.discordUserId, user.id);
}

/** Fields updateUser may touch. kycStatus/kycTier/roles/security are updated
 *  through their own dedicated flows, never via a generic identity patch. */
const UPDATABLE_FIELDS = [
  "name",
  "email",
  "phone",
  "phoneVerified",
  "authProvider",
  "googleSub",
  "appleSub",
] as const;
type UpdatableField = (typeof UPDATABLE_FIELDS)[number];

/** Merge identity/auth fields onto a user (Google link, phone, etc.).
 *  Allow-listed so a caller can never escalate kycTier/roles through it. */
export function updateUser(userId: string, patch: Partial<Pick<User, UpdatableField>>): void {
  const account = state.accounts.get(userId);
  if (!account) return;
  for (const field of UPDATABLE_FIELDS) {
    if (patch[field] !== undefined) {
      (account.user as unknown as Record<string, unknown>)[field] = patch[field];
    }
  }
  indexUser(account.user);
  void persistAccount(userId);
}

/** Dedicated subscription-tier transition — only billing checkout (sandbox
 *  mode) and the Stripe webhook call this; like kycTier it is deliberately
 *  NOT reachable through updateUser's identity allow-list. */
export function setSubscriptionTier(userId: string, tier: User["tier"]): void {
  const account = state.accounts.get(userId);
  if (!account) return;
  account.user.tier = tier;
  void persistAccount(userId);
}

/** Dedicated KYC transition — only the KYC webhook/flow calls this; it is
 *  deliberately NOT reachable through updateUser's identity allow-list. */
export function setKycStatus(userId: string, status: User["kycStatus"], tier?: User["kycTier"]): void {
  const account = state.accounts.get(userId);
  if (!account) return;
  account.user.kycStatus = status;
  if (tier !== undefined) account.user.kycTier = tier;
  void persistAccount(userId);
}

/**
 * Dedicated tax-residency transition — called ONLY by the KYC flow, after an
 * identity provider has VERIFIED the holder's country of residence.
 *
 * Deliberately NOT reachable through updateUser's identity allow-list, exactly
 * like setKycStatus. Tax residency sets the dividend withholding rate, so a
 * user who could write this field could set their own tax rate to zero.
 */
export function setTaxResidency(userId: string, iso3166Alpha2: string): void {
  const account = state.accounts.get(userId);
  if (!account) return;
  const code = iso3166Alpha2.toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return; // malformed → leave unset, withhold at statutory
  account.user.taxResidency = code;
  void persistAccount(userId);
}

/** Dedicated self-custodial wallet link — called ONLY by the wallet-link
 *  verify route AFTER server-side EIP-191 signature recovery proves control.
 *  Deliberately NOT reachable through updateUser's identity allow-list, exactly
 *  like setKycStatus/setSubscriptionTier. Never touches safeAddress. */
export function setLinkedWallet(userId: string, linked: LinkedWallet): void {
  const account = state.accounts.get(userId);
  if (!account) return;
  account.user.linkedWallet = linked;
  void persistAccount(userId);
}

/** Reverse index: is this address already linked to some account?
 *  Prevents one wallet being linked to many accounts (link-hijack defense). */
export function findUserByLinkedWallet(address: string): UserAccount | undefined {
  const want = address.toLowerCase();
  for (const account of state.accounts.values()) {
    if (account.user.linkedWallet?.address.toLowerCase() === want) return account;
  }
  return undefined;
}

export function recordTransaction(userId: string, t: Transaction): void {
  const account = state.accounts.get(userId);
  if (!account) return;
  account.transactions.unshift(t);
  // A recorded transaction almost always accompanies an in-place balance /
  // limit mutation on the same account — the whole-account flush picks both up.
  void persistAccount(userId);
}

export function newTx(partial: Omit<Transaction, "id" | "timestamp">): Transaction {
  return {
    ...partial,
    id: "tx_" + randomUUID(),
    timestamp: new Date().toISOString(),
  };
}
