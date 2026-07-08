import { createHash, randomUUID } from "crypto";
import type { Role } from "./session";
import {
  Bill,
  FiatBalance,
  Holding,
  PaymentCard,
  TokenBalance,
  Transaction,
} from "./types";

// ---------------------------------------------------------------------------
// Multi-user in-memory data store. Acts as the app's "database" for the demo.
// In a real deployment this is replaced by Postgres (see blueprint §5) behind
// the same accessor functions — routes never touch the maps directly.
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

export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string; // E.164
  phoneVerified?: boolean;
  authProvider?: "passkey" | "google" | "apple" | "phone" | "email";
  googleSub?: string; // stable Google account id, when linked
  appleSub?: string; // stable Apple account id (sub), when linked
  safeAddress: string;
  kycStatus: "verified" | "pending" | "unverified";
  kycTier: 0 | 1 | 2 | 3;
  region: "EEA" | "US" | "IN" | "GLOBAL";
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
  holdings: Holding[];
  cards: PaymentCard[];
  bills: Bill[];
  transactions: Transaction[];
}

interface AppState {
  accounts: Map<string, UserAccount>;
  // Verified-identifier → userId indexes. Keys are normalized (lowercased
  // email, E.164 phone as given).
  byPhone: Map<string, string>;
  byEmail: Map<string, string>;
  byGoogleSub: Map<string, string>;
  byAppleSub: Map<string, string>;
}

export const DEMO_USER_EMAIL = "ashutosh@furlpay.app";
export const DEMO_USER_ID = uuidFromKey(DEMO_USER_EMAIL);

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
    ],
    fiatBalances: [
      {
        currency: "USD",
        amount: 3200.0,
        usdValue: 3200.0,
        localDetails: { routingNumber: "026073150", accountNumber: "8942100133" },
      },
      {
        currency: "EUR",
        amount: 1500.0,
        usdValue: 1635.0,
        localDetails: { iban: "BE71 0961 2345 6769", swift: "TRWIBEB1XXX" },
      },
      {
        currency: "INR",
        amount: 42000.0,
        usdValue: 503.4,
        localDetails: { accountNumber: "UPI: ashutosh@superapp" },
      },
    ],
    holdings: [
      // costBasis = what the user actually paid; live prices re-mark marketValue.
      { symbol: "AAPL", name: "Apple Inc.", shares: 3.4, price: 232.11, changePct: 0.82, marketValue: 789.17, costBasis: 702.1 },
      { symbol: "NVDA", name: "NVIDIA Corp.", shares: 1.1, price: 1284.5, changePct: 2.14, marketValue: 1412.95, costBasis: 1188.0 },
      { symbol: "VOO", name: "Vanguard S&P 500 ETF", shares: 2.0, price: 548.2, changePct: -0.34, marketValue: 1096.4, costBasis: 1004.6 },
      { symbol: "TSLA", name: "Tesla Inc.", shares: 0.75, price: 402.9, changePct: 1.05, marketValue: 302.18, costBasis: 286.9 },
    ],
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
    id: "tx_" + Math.random().toString(36).slice(2, 10),
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
  };
  return state;
}

// Persist a single instance across hot-reloads / route invocations.
const globalForStore = globalThis as unknown as { __appStateV2?: AppState };
const state: AppState = globalForStore.__appStateV2 ?? (globalForStore.__appStateV2 = buildState());

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

export interface IdentityLookup {
  phone?: string;
  email?: string;
  googleSub?: string;
  appleSub?: string;
}

export function findUserByIdentity(lookup: IdentityLookup): UserAccount | undefined {
  const id =
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
  });
  const account = emptyAccount(user);
  state.accounts.set(user.id, account);
  indexUser(user);
  return { account, created: true };
}

function indexUser(user: User): void {
  if (user.phone) state.byPhone.set(user.phone, user.id);
  if (user.email) state.byEmail.set(user.email.toLowerCase(), user.id);
  if (user.googleSub) state.byGoogleSub.set(user.googleSub, user.id);
  if (user.appleSub) state.byAppleSub.set(user.appleSub, user.id);
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
}

/** Dedicated KYC transition — only the KYC webhook/flow calls this; it is
 *  deliberately NOT reachable through updateUser's identity allow-list. */
export function setKycStatus(userId: string, status: User["kycStatus"], tier?: User["kycTier"]): void {
  const account = state.accounts.get(userId);
  if (!account) return;
  account.user.kycStatus = status;
  if (tier !== undefined) account.user.kycTier = tier;
}

export function recordTransaction(userId: string, t: Transaction): void {
  const account = state.accounts.get(userId);
  if (!account) return;
  account.transactions.unshift(t);
}

export function newTx(partial: Omit<Transaction, "id" | "timestamp">): Transaction {
  return {
    ...partial,
    id: "tx_" + Math.random().toString(36).slice(2, 10),
    timestamp: new Date().toISOString(),
  };
}
