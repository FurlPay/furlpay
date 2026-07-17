// Domain types mirrored from apps/web/src/lib/types.ts — the API contract.
// If the web types change, update these to match.

export type Chain = "ethereum" | "polygon" | "base" | "arbitrum" | "solana" | "gnosis";
export type Token = "USDC" | "USDT" | "EURC" | "PYUSD" | "DAI" | "XSGD" | "XUSD" | string;

export interface TokenBalance {
  token: Token;
  chain: Chain;
  amount: number;
  usdValue: number;
}

export interface FiatBalance {
  currency: string;
  amount: number;
  usdValue: number;
}

export type TxDirection = "in" | "out";
export type TxCategory = "card" | "transfer" | "swap" | "invest" | "bill" | "ramp" | "yield";
export type TxStatus = "settled" | "pending" | "escrow" | "declined";

export interface Transaction {
  id: string;
  category: TxCategory;
  direction: TxDirection;
  title: string;
  subtitle: string;
  amountUsd: number;
  token?: Token;
  chain?: Chain;
  cardId?: string;
  timestamp: string; // ISO
  status: TxStatus;
}

export interface PaymentCard {
  id: string;
  kind: "virtual" | "physical";
  label: string;
  last4: string;
  network: "Visa" | "Mastercard";
  frozen: boolean;
  gradient: [string, string];
  limits: { perPurchase: number; daily: number; dailySpent: number };
  channels: { online: boolean; offline: boolean; atm: boolean };
  settlementCurrency: string;
}

export interface Holding {
  symbol: string;
  name: string;
  shares: number;
  price: number;
  changePct: number;
  marketValue: number;
  costBasis: number;
  /** Self-hosted asset logo path (e.g. "/logos/stocks/aapl.svg"), or null. */
  logo?: string | null;
}

/** GET /api/overview */
export interface Overview {
  user: {
    id: string;
    name: string;
    safeAddress: string;
    kycStatus: string;
    region: string;
    tier: string;
  };
  netWorth: number;
  breakdown: { crypto: number; fiat: number; equities: number };
  tokenBalances: TokenBalance[];
  fiatBalances: FiatBalance[];
  recentTransactions: Transaction[];
}

/** GET /api/investing/portfolio */
export interface Portfolio {
  holdings: Holding[];
  dividends: { symbol: string; amount: number; status: string; exDate: string }[];
  performance: {
    marketValue: number;
    dayChange: number;
    dayChangePct: number;
    totalReturn: number;
    totalReturnPct: number;
  };
}
