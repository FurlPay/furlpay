// Strict typings for Furlpay resources.

export type Chain = "ethereum" | "polygon" | "base" | "arbitrum" | "solana" | "gnosis";
export type Stablecoin = "USDC" | "USDT" | "EURC" | "PYUSD";

export interface Balance {
  token: Stablecoin;
  amount: string;
  chain: Chain;
  usdValue?: number;
}

export interface Wallet {
  safeAddress: string;
  modules: { name: string; type: string; enabled: boolean }[];
  balances: Balance[];
}

export interface Card {
  id: string;
  kind: "virtual" | "physical";
  last4: string;
  network: "Visa" | "Mastercard";
  frozen: boolean;
  settlementCurrency: string;
}

export interface Order {
  orderId: string;
  status: "pending" | "filled";
  filledQty: number;
  symbol: string;
  side: "buy" | "sell";
}

export interface SwapQuote {
  fromToken: Stablecoin;
  toToken: Stablecoin;
  fromChain: Chain;
  toChain: Chain;
  amountIn: number;
  amountOut: number;
  slippagePct: number;
  gasUsd: number;
  route: string[];
  etaSeconds: number;
}

export interface FurlpayEvent<T = unknown> {
  id: string;
  type: string;
  created: number;
  data: T;
}
