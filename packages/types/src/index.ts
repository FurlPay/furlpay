// @furlpay/types — single source of truth for cross-cutting domain primitives,
// shared by the web app, SDKs and compliance package.

export type Chain =
  | "ethereum"
  | "polygon"
  | "base"
  | "arbitrum"
  | "solana"
  | "gnosis";

export type Stablecoin = "USDC" | "USDT" | "EURC" | "PYUSD" | "DAI";

export type Region = "US" | "EEA" | "UK" | "IN" | "GLOBAL";

export const CHAINS: Chain[] = ["ethereum", "polygon", "base", "arbitrum", "solana", "gnosis"];
export const STABLECOINS: Stablecoin[] = ["USDC", "USDT", "EURC", "PYUSD", "DAI"];
