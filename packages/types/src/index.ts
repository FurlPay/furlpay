// @furlpay/types — single source of truth for cross-cutting domain primitives,
// shared by the web app, SDKs and compliance package.

export type Chain =
  | "ethereum"
  | "polygon"
  | "base"
  | "arbitrum"
  // Circle Arc — EVM L1, mainnet live 2026-09-16, where USDC IS the native gas
  // asset. It is the only chain in this union whose gas token is a stablecoin,
  // which is why USDC.arc carries different decimals from every other USDC:
  // see lib/chains/arc.ts before touching any amount on this chain.
  | "arc"
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

export const CHAINS: Chain[] = ["ethereum", "polygon", "base", "arbitrum", "arc", "solana", "gnosis", "robinhood", "bsc"];
// XSGD/XUSD: MAS-regulated SGD/USD stablecoins by StraitsX (Singapore) — the
// regulated-settlement pair for APAC corridors and agentic (x402) payments.
export const STABLECOINS: Stablecoin[] = ["USDC", "USDT", "EURC", "PYUSD", "DAI", "XSGD", "XUSD"];
export const NATIVE_TOKENS: NativeToken[] = ["SOL", "ETH"];
export const TOKENS: Token[] = [...STABLECOINS, ...NATIVE_TOKENS];
