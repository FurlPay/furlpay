// @furlpay/types — single source of truth for cross-cutting domain primitives,
// shared by the web app, SDKs and compliance package.

export type Chain =
  | "ethereum"
  | "polygon"
  | "base"
  | "arbitrum"
  | "solana"
  | "gnosis"
  | "robinhood"
  | "bsc";

export type Stablecoin = "USDC" | "USDT" | "EURC" | "PYUSD" | "DAI" | "XSGD" | "XUSD";

/** Native gas tokens tradable through the swap terminal (not stablecoins). */
export type NativeToken = "SOL" | "ETH";

/** Any token FurlPay can quote, swap or hold a balance in. */
export type Token = Stablecoin | NativeToken;

export type Region = "US" | "EEA" | "UK" | "IN" | "GLOBAL";

export const CHAINS: Chain[] = ["ethereum", "polygon", "base", "arbitrum", "solana", "gnosis", "robinhood", "bsc"];
// XSGD/XUSD: MAS-regulated SGD/USD stablecoins by StraitsX (Singapore) — the
// regulated-settlement pair for APAC corridors and agentic (x402) payments.
export const STABLECOINS: Stablecoin[] = ["USDC", "USDT", "EURC", "PYUSD", "DAI", "XSGD", "XUSD"];
export const NATIVE_TOKENS: NativeToken[] = ["SOL", "ETH"];
export const TOKENS: Token[] = [...STABLECOINS, ...NATIVE_TOKENS];
