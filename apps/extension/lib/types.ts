// Shared types mirroring the furlpay.com API responses the extension consumes.

export interface TokenBalance {
  token: string;
  chain: string;
  amount: number;
  usdValue: number;
}

export interface FiatBalance {
  currency: string;
  amount: number;
  usdValue: number;
}

export interface Transaction {
  id: string;
  category: string;
  direction: "in" | "out";
  title: string;
  subtitle: string;
  amountUsd: number;
  cardId?: string;
  status: string;
  timestamp: string;
}

export interface Overview {
  user: { id: string; name: string; safeAddress: string; kycStatus: string; region: string; tier: string };
  netWorth: number;
  breakdown: { crypto: number; fiat: number; equities: number };
  tokenBalances: TokenBalance[];
  fiatBalances: FiatBalance[];
  recentTransactions: Transaction[];
}

export interface PendingChallenge {
  id: string;
  amountUsd: number;
  currency: string;
  merchant: { name: string; city?: string; country?: string; mcc?: string };
  cardId: string;
  createdAt: string;
  expiresAt: string;
}

export interface RewardsSummary {
  tier: string;
  points: number;
  nextTier: string;
  progressPct: number;
  missions: { id: string; title: string; reward: number; done: boolean }[];
  [key: string]: unknown;
}

export interface EarnVault {
  name: string;
  symbol: string;
  netApy: number;
  tvlUsd?: number;
  asset?: { symbol?: string };
  [key: string]: unknown;
}

export interface EarnOverview {
  live: boolean;
  vaults: EarnVault[];
  idleUsdc: number;
  bestApy: number;
  disclosure: string;
  [key: string]: unknown;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface BarsResponse {
  candles: Candle[];
  source?: string;
}

export interface Entitlements {
  tier: string;
  plan: string;
  features: Record<string, boolean>;
}

export interface PasskeyInfo {
  id: string;
  name: string;
  createdAt: string | null;
  lastUsedAt: string | null;
  transports: string[];
}

export interface PasskeyList {
  credentials: PasskeyInfo[];
  safeAddress: string;
}

/** x402 PaymentRequirements captured from a 402 response (x402 v1 shape). */
export interface X402Requirement {
  scheme?: string;
  network?: string;
  asset?: string;
  payTo?: string;
  maxAmountRequired?: string;
  amountUsd?: number;
  resource?: string;
  description?: string;
  maxTimeoutSeconds?: number;
  [key: string]: unknown;
}

export interface X402Detection {
  url: string;
  method: string;
  requirements: X402Requirement[];
  detectedAt: string;
}

// Message protocol between UI surfaces and the background service worker.
export type BgRequest =
  | { type: "GET_OVERVIEW" }
  | { type: "GET_CHALLENGES" }
  | { type: "DECLINE_CHALLENGE"; challengeId: string }
  | { type: "OPEN_APPROVE"; challengeId?: string }
  | { type: "GET_REWARDS" }
  | { type: "GET_TRANSACTIONS" }
  | { type: "GET_BARS"; symbol: string; tf: string }
  | { type: "GET_ENTITLEMENTS" }
  | { type: "UPGRADE_PLAN"; plan: "pro" | "developer" }
  | { type: "GET_EARN" }
  | { type: "LOGOUT" }
  | { type: "TRAVEL_SEARCH"; payload: Record<string, unknown> }
  | { type: "GET_PASSKEYS" }
  | { type: "REVOKE_PASSKEY"; credentialId: string }
  | { type: "GET_SESSION_STATE" }
  | { type: "OPEN_LOGIN" }
  | { type: "X402_DETECTED"; detection: X402Detection }
  | { type: "OPEN_X402_CHECKOUT"; detection: X402Detection }
  | { type: "WALLET_CONNECT" };

export type BgResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: string };
