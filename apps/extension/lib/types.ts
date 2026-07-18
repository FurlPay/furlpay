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

/** Mirrors GET /api/rewards EXACTLY (apps/web/src/app/api/rewards/route.ts).
 *
 *  Tier/points live under `membership` — they are NOT top-level. An earlier
 *  version of this interface declared `tier`/`points`/`progressPct` at the top
 *  level and carried an `[key: string]: unknown` index signature, which made
 *  the wrong shape typecheck cleanly: `data.points` resolved to `unknown`
 *  rather than erroring, arrived as `undefined` at runtime, and crashed the
 *  Wallet tab on `.toLocaleString()`. No index signature here — a future
 *  response change must break the build, not the popup. */
export interface RewardsSummary {
  referral: {
    code: string;
    url: string;
    invited: number;
    converted: number;
    earnedUsd: number;
    perReferralUsd: number;
  };
  membership: {
    tier: string;
    /** null once the user is on the top tier — render "top tier", not "null". */
    nextTier: string | null;
    points: number;
    nextThreshold: number;
    progressPct: number;
    perks: string[];
  };
  missions: { id: string; title: string; reward: number; done: boolean }[];
  rewardsBalance: { claimedUsd: number; pendingUsd: number };
}

/** One row of GET /api/markets. `live` is the provider's own freshness flag —
 *  false means the server fell back to baked seed prices, and the UI must say
 *  so rather than presenting stale numbers as live. */
export interface MarketAsset {
  symbol: string;
  name: string;
  kind: "stock" | "etf" | "crypto";
  sector: string | null;
  industry: string | null;
  cap: string;
  chain: string | null;
  /** Backend-relative path to the official mark, e.g. "/logos/stocks/aapl.svg". */
  logo: string;
  price: number;
  changePct: number;
  live: boolean;
}

export interface MarketsResponse {
  items: MarketAsset[];
  asOf: string;
}

/** One row of GET /api/markets/search — the FULL tradable universe (~13k
 *  broker-synced assets), not the 391-symbol curated catalog.
 *
 *  `price` is NULLABLE and that is load-bearing: pricing 13k symbols on every
 *  keystroke would be thousands of provider calls, so uncurated assets come
 *  back unpriced. Render "—", never 0 — a zero price on a money surface reads
 *  as "this is worthless". */
export interface MarketSearchAsset {
  symbol: string;
  name: string;
  kind: "stock" | "etf" | "crypto";
  sector: string | null;
  industry: string | null;
  exchange: string | null;
  logo: string | null;
  fractionable: boolean;
  curated: boolean;
  currency: string;
  price: number | null;
  changePct: number | null;
  live: boolean;
}

export interface MarketSearchResponse {
  query: string;
  count: number;
  items: MarketSearchAsset[];
  universe: { syncedAt: string; tradable: number; fractionable: number; curated: number; crypto: number };
}

/** GET /api/markets/[symbol] — every field the in-popup detail view renders.
 *  Numeric stats are nullable by design: equities carry P/E and dividends,
 *  crypto carries supply and ATH, and neither has the other's. */
export interface MarketDetail {
  asset: {
    symbol: string;
    name: string;
    kind: "stock" | "etf" | "crypto";
    sector: string | null;
    industry: string | null;
    cap: string;
    chain: string | null;
    logo: string;
  };
  quote: { price: number; changePct: number; live: boolean };
  stats: {
    marketCap: number | null;
    peRatio: number | null;
    eps: number | null;
    dividendYieldPct: number | null;
    beta: number | null;
    high52w: number | null;
    low52w: number | null;
    volume: number | null;
    avgVolume: number | null;
    circulatingSupply: number | null;
    athPrice: number | null;
  };
  digest: string;
  position: { shares: number; marketValue: number } | null;
  related: { symbol: string; name: string; kind: string; logo: string; price: number; changePct: number }[];
  asOf: string;
}

/** A bookable stay from /api/travel/hotels or /api/travel/search. */
export interface TravelStay {
  id: string;
  name: string;
  brand?: string;
  city: string;
  country?: string;
  type: string;
  stars: number;
  rating: number;
  reviews: number;
  nightlyUsd: number;
  photo?: string;
  amenities: string[];
  roomsLeft: number;
  freeCancellation?: boolean;
  eco?: boolean;
}

export type TravelProperty = TravelStay;

/** `source` distinguishes live Duffel inventory from generated demo stock. The
 *  UI must surface it — demo rates are not bookable at the price shown. */
export interface TravelHotelsResponse {
  city: string;
  count: number;
  hotels: TravelStay[];
  source: "duffel" | "demo";
}

/** A flight offer from POST /api/travel/search { type: "flights" }.
 *  Live results are Duffel offers (`id` looks like "off_…") and carry an
 *  official carrier logo from Duffel's CDN. */
export interface TravelFlight {
  id: string;
  carrier: string;
  carrierCode: string;
  from: string;
  to: string;
  date: string;
  departTime: string;
  arriveTime: string;
  durationMin: number;
  stops: number;
  cabin: string;
  /** Official airline mark, e.g. assets.duffel.com/…/AA.svg */
  logoUrl?: string;
  priceUsd: number;
  baggage?: string;
}

export interface TravelFlightsResponse {
  type: "flights";
  count: number;
  results: TravelFlight[];
  source: "duffel" | "demo";
}

export interface TravelPropertyResponse {
  property: TravelProperty;
  rooms: { name: string; beds?: string; nightlyUsd: number }[];
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
  | { type: "GET_MARKETS"; kind?: "stock" | "etf" | "crypto"; q?: string; limit?: number }
  | { type: "GET_MARKET_DETAIL"; symbol: string }
  | { type: "SEARCH_MARKETS"; q?: string; kind?: "stock" | "etf" | "crypto"; limit?: number }
  | { type: "GET_TRAVEL_HOTELS"; city: string }
  | { type: "GET_TRAVEL_PROPERTY"; id: string; city: string }
  | { type: "SEARCH_FLIGHTS"; from: string; to: string; date: string; cabin?: string }
  | { type: "LOGOUT" }
  | { type: "TRAVEL_SEARCH"; payload: Record<string, unknown> }
  | { type: "GET_PASSKEYS" }
  | { type: "REVOKE_PASSKEY"; credentialId: string }
  | { type: "GET_SESSION_STATE" }
  | { type: "OPEN_LOGIN" }
  | { type: "X402_DETECTED"; detection: X402Detection }
  | { type: "OPEN_X402_CHECKOUT"; detection: X402Detection }
  | { type: "WALLET_CONNECT" }
  // Sent by the connect-prompt page (extension origin only) with the user's
  // Allow / Deny verdict for a pending dapp connection request.
  | { type: "WALLET_CONNECT_DECISION"; requestId: string; allow: boolean };

export type BgResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: string };
