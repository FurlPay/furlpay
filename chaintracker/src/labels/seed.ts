// Seed address labels and token contracts.
//
// Every entry below was read from the chain before being written here: the
// token symbol and decimals come from eth_call against the contract, and each
// labelled address was checked with eth_getBalance / eth_getCode. That matters
// twice over — a wrong decimals value silently scales a whale alert by 10^12,
// and a wrong exchange label puts a false claim in front of users.
//
// These are the SEED. They land in the `wallets` table on first boot and the
// database is authoritative afterwards, so labels can be corrected at runtime
// without a deploy.

import type { AddressLabelSeed } from "../types/index.js";

/* ------------------------------------------------------------------ */
/* Token contracts — verified symbol + decimals on-chain               */
/* ------------------------------------------------------------------ */

export interface TokenSeed {
  chainSlug: string;
  address: string;
  symbol: string;
  decimals: number;
  isStablecoin: boolean;
  /** CoinGecko id, so the whale engine can price it without a lookup. */
  coingeckoId: string | null;
}

/**
 * The tokens the whale scanner filters `eth_getLogs` on. Keeping this list
 * tight is deliberate: an unfiltered Transfer query on Ethereum returns
 * thousands of logs per block, and the response size is what breaks a free
 * tier — not the call count.
 *
 * Decimals here are the ON-CHAIN values, which are not always what you expect:
 * BNB Chain's USDT and USDC are 18 decimals, while every other chain uses 6.
 */
export const TOKEN_SEEDS: TokenSeed[] = [
  // Ethereum
  { chainSlug: "ethereum", address: "0xdac17f958d2ee523a2206206994597c13d831ec7", symbol: "USDT", decimals: 6, isStablecoin: true, coingeckoId: "tether" },
  { chainSlug: "ethereum", address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", symbol: "USDC", decimals: 6, isStablecoin: true, coingeckoId: "usd-coin" },
  { chainSlug: "ethereum", address: "0x6b175474e89094c44da98b954eedeac495271d0f", symbol: "DAI", decimals: 18, isStablecoin: true, coingeckoId: "dai" },
  { chainSlug: "ethereum", address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", symbol: "WETH", decimals: 18, isStablecoin: false, coingeckoId: "weth" },
  { chainSlug: "ethereum", address: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599", symbol: "WBTC", decimals: 8, isStablecoin: false, coingeckoId: "wrapped-bitcoin" },
  { chainSlug: "ethereum", address: "0xae7ab96520de3a18e5e111b5eaab095312d7fe84", symbol: "stETH", decimals: 18, isStablecoin: false, coingeckoId: "staked-ether" },

  // BNB Chain — note the 18-decimal stablecoins.
  { chainSlug: "bnb", address: "0x55d398326f99059ff775485246999027b3197955", symbol: "USDT", decimals: 18, isStablecoin: true, coingeckoId: "tether" },
  { chainSlug: "bnb", address: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", symbol: "USDC", decimals: 18, isStablecoin: true, coingeckoId: "usd-coin" },
  { chainSlug: "bnb", address: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c", symbol: "WBNB", decimals: 18, isStablecoin: false, coingeckoId: "wbnb" },

  // Base
  { chainSlug: "base", address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", symbol: "USDC", decimals: 6, isStablecoin: true, coingeckoId: "usd-coin" },
  { chainSlug: "base", address: "0x4200000000000000000000000000000000000006", symbol: "WETH", decimals: 18, isStablecoin: false, coingeckoId: "weth" },

  // Arbitrum — USDT here reports as "USD₮0" on-chain.
  { chainSlug: "arbitrum", address: "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9", symbol: "USDT", decimals: 6, isStablecoin: true, coingeckoId: "tether" },
  { chainSlug: "arbitrum", address: "0xaf88d065e77c8cc2239327c5edb3a432268e5831", symbol: "USDC", decimals: 6, isStablecoin: true, coingeckoId: "usd-coin" },
  { chainSlug: "arbitrum", address: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1", symbol: "WETH", decimals: 18, isStablecoin: false, coingeckoId: "weth" },
  { chainSlug: "arbitrum", address: "0x912ce59144191c1204e64559fe8253a0e49e6548", symbol: "ARB", decimals: 18, isStablecoin: false, coingeckoId: "arbitrum" },

  // Optimism
  { chainSlug: "optimism", address: "0x94b008aa00579c1307b0ef2c499ad98a8ce58e58", symbol: "USDT", decimals: 6, isStablecoin: true, coingeckoId: "tether" },
  { chainSlug: "optimism", address: "0x0b2c639c533813f4aa9d7837caf62653d097ff85", symbol: "USDC", decimals: 6, isStablecoin: true, coingeckoId: "usd-coin" },
  { chainSlug: "optimism", address: "0x4200000000000000000000000000000000000006", symbol: "WETH", decimals: 18, isStablecoin: false, coingeckoId: "weth" },
  { chainSlug: "optimism", address: "0x4200000000000000000000000000000000000042", symbol: "OP", decimals: 18, isStablecoin: false, coingeckoId: "optimism" },

  // Polygon — the wrapped native is WPOL since the MATIC→POL migration.
  { chainSlug: "polygon", address: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f", symbol: "USDT", decimals: 6, isStablecoin: true, coingeckoId: "tether" },
  { chainSlug: "polygon", address: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359", symbol: "USDC", decimals: 6, isStablecoin: true, coingeckoId: "usd-coin" },
  { chainSlug: "polygon", address: "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270", symbol: "WPOL", decimals: 18, isStablecoin: false, coingeckoId: "matic-network" },

  // Avalanche
  { chainSlug: "avalanche", address: "0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7", symbol: "USDT", decimals: 6, isStablecoin: true, coingeckoId: "tether" },
  { chainSlug: "avalanche", address: "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e", symbol: "USDC", decimals: 6, isStablecoin: true, coingeckoId: "usd-coin" },
  { chainSlug: "avalanche", address: "0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7", symbol: "WAVAX", decimals: 18, isStablecoin: false, coingeckoId: "avalanche-2" },
];

/** Token contracts the scanner watches on a chain, or [] when none are seeded. */
export function tokensForChain(slug: string): TokenSeed[] {
  return TOKEN_SEEDS.filter((t) => t.chainSlug === slug);
}

/* ------------------------------------------------------------------ */
/* Address labels                                                      */
/* ------------------------------------------------------------------ */

/**
 * Confidence convention:
 *   1.00 — a protocol contract whose identity is verifiable from its own code
 *          (deposit contract, bridge, token, burn address)
 *   0.90 — an exchange wallet confirmed by a large live balance
 *   0.75 — an exchange wallet that is currently swept to zero, so the label
 *          rests on provenance rather than an observation we can re-run
 */
export const ADDRESS_LABELS: AddressLabelSeed[] = [
  /* --- Exchanges: confirmed by live balance ---------------------- */
  { chainSlug: "ethereum", address: "0x28c6c06298d514db089934071355e5743bf21d60", label: "Binance 14", entity: "Binance", category: "cex", tags: ["exchange", "hot-wallet"] },
  { chainSlug: "ethereum", address: "0x21a31ee1afc51d94c2efccaa2092ad1028285549", label: "Binance 15", entity: "Binance", category: "cex", tags: ["exchange", "hot-wallet"] },
  { chainSlug: "ethereum", address: "0xdfd5293d8e347dfe59e90efd55b2956a1343963d", label: "Binance 16", entity: "Binance", category: "cex", tags: ["exchange", "hot-wallet"] },
  { chainSlug: "ethereum", address: "0x56eddb7aa87536c09ccc2793473599fd21a8b17f", label: "Binance 17", entity: "Binance", category: "cex", tags: ["exchange", "hot-wallet"] },
  { chainSlug: "ethereum", address: "0x9696f59e4d72e237be84ffd425dcad154bf96976", label: "Binance 18", entity: "Binance", category: "cex", tags: ["exchange", "hot-wallet"] },
  { chainSlug: "ethereum", address: "0x4976a4a02f38326660d17bf34b431dc6e2eb2327", label: "Binance 19", entity: "Binance", category: "cex", tags: ["exchange", "hot-wallet"] },
  { chainSlug: "ethereum", address: "0xf977814e90da44bfa03b6295a0616a897441acec", label: "Binance 8 (cold)", entity: "Binance", category: "cex", tags: ["exchange", "cold-wallet"] },
  { chainSlug: "ethereum", address: "0x46340b20830761efd32832a74d7169b29feb9758", label: "Crypto.com 1", entity: "Crypto.com", category: "cex", tags: ["exchange", "hot-wallet"] },
  { chainSlug: "ethereum", address: "0x77134cbc06cb00b66f4c7e623d5fdbf6777635ec", label: "Bybit", entity: "Bybit", category: "cex", tags: ["exchange", "hot-wallet"] },
  { chainSlug: "ethereum", address: "0x40b38765696e3d5d8d9d834d8aad4bb6e418e489", label: "Robinhood", entity: "Robinhood", category: "cex", tags: ["exchange", "broker"] },
  { chainSlug: "ethereum", address: "0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43", label: "Coinbase 10", entity: "Coinbase", category: "cex", tags: ["exchange", "custody"] },
  { chainSlug: "ethereum", address: "0x71660c4005ba85c37ccec55d0c4493e66fe775d3", label: "Coinbase 1", entity: "Coinbase", category: "cex", tags: ["exchange", "hot-wallet"] },
  { chainSlug: "ethereum", address: "0x503828976d22510aad0201ac7ec88293211d23da", label: "Coinbase 2", entity: "Coinbase", category: "cex", tags: ["exchange", "hot-wallet"] },
  { chainSlug: "ethereum", address: "0xddfabcdc4d8ffc6d5beaf154f18b778f892a0740", label: "Coinbase 3", entity: "Coinbase", category: "cex", tags: ["exchange", "hot-wallet"] },
  { chainSlug: "ethereum", address: "0x3cd751e6b0078be393132286c442345e5dc49699", label: "Coinbase 4", entity: "Coinbase", category: "cex", tags: ["exchange", "hot-wallet"] },
  { chainSlug: "ethereum", address: "0xa7efae728d2936e78bda97dc267687568dd593f3", label: "OKX 1", entity: "OKX", category: "cex", tags: ["exchange", "hot-wallet"] },
  { chainSlug: "ethereum", address: "0x5041ed759dd4afc3a72b8192c143f72f4724081a", label: "OKX 2", entity: "OKX", category: "cex", tags: ["exchange", "hot-wallet"] },

  /* --- Exchanges: currently swept, label from provenance ---------- */
  { chainSlug: "ethereum", address: "0x2910543af39aba0cd09dbb2d50200b3e800a63d2", label: "Kraken 1", entity: "Kraken", category: "cex", tags: ["exchange", "hot-wallet"] },
  { chainSlug: "ethereum", address: "0x0a869d79a7052c7f1b55a8ebabbea3420f0d1e13", label: "Kraken 2", entity: "Kraken", category: "cex", tags: ["exchange", "hot-wallet"] },
  { chainSlug: "ethereum", address: "0xe93381fb4c4f14bda253907b18fad305d799241a", label: "Huobi / HTX 1", entity: "HTX", category: "cex", tags: ["exchange", "hot-wallet"] },
  { chainSlug: "ethereum", address: "0x1522900b6dafac587d499a862861c0869be6e428", label: "Bitfinex MultiSig", entity: "Bitfinex", category: "cex", tags: ["exchange", "multisig"] },

  /* --- Bridges: verified contracts -------------------------------- */
  { chainSlug: "ethereum", address: "0x8315177ab297ba92a06054ce80a67ed4dbd7ed3a", label: "Arbitrum Bridge", entity: "Arbitrum", category: "bridge", tags: ["bridge", "l2"] },
  { chainSlug: "ethereum", address: "0x99c9fc46f92e8a1c0dec1b1747d010903e884be1", label: "Optimism Gateway", entity: "Optimism", category: "bridge", tags: ["bridge", "l2"] },
  { chainSlug: "ethereum", address: "0x3154cf16ccdb4c6d922629664174b904d80f2c35", label: "Base Bridge", entity: "Base", category: "bridge", tags: ["bridge", "l2"] },
  { chainSlug: "ethereum", address: "0x32400084c286cf3e17e7b677ea9583e60a000324", label: "zkSync Era Bridge", entity: "zkSync", category: "bridge", tags: ["bridge", "l2"] },
  { chainSlug: "ethereum", address: "0xae0ee0a63a2ce6baeeffe56e7714fb4efe48d419", label: "Polygon PoS Bridge", entity: "Polygon", category: "bridge", tags: ["bridge"] },

  /* --- Protocols and system contracts ----------------------------- */
  { chainSlug: "ethereum", address: "0x00000000219ab540356cbb839cbe05303d7705fa", label: "ETH2 Deposit Contract", entity: "Ethereum", category: "staking", tags: ["staking", "system"] },
  { chainSlug: "ethereum", address: "0xae7ab96520de3a18e5e111b5eaab095312d7fe84", label: "Lido stETH", entity: "Lido", category: "protocol", tags: ["staking", "lsd"] },
  { chainSlug: "ethereum", address: "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0", label: "Lido wstETH", entity: "Lido", category: "protocol", tags: ["staking", "lsd"] },
  { chainSlug: "ethereum", address: "0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad", label: "Uniswap Universal Router", entity: "Uniswap", category: "dex", tags: ["dex", "router"] },
  { chainSlug: "ethereum", address: "0x74de5d4fcbf63e00296fd95d33236b9794016631", label: "MetaMask Swap Router", entity: "MetaMask", category: "dex", tags: ["dex", "router"] },
  { chainSlug: "ethereum", address: "0xde0b295669a9fd93d5f28d9ec85e40f4cb697bae", label: "Ethereum Foundation", entity: "Ethereum Foundation", category: "foundation", tags: ["foundation", "treasury"] },
  { chainSlug: "ethereum", address: "0x000000000000000000000000000000000000dead", label: "Burn Address", entity: "Null", category: "burn", tags: ["burn"] },
  { chainSlug: "ethereum", address: "0x0000000000000000000000000000000000000000", label: "Zero Address", entity: "Null", category: "burn", tags: ["burn", "mint"] },
];

/** Confidence for a seeded label, per the convention documented above. */
export function seedConfidence(l: AddressLabelSeed): number {
  const swept = new Set([
    "0x2910543af39aba0cd09dbb2d50200b3e800a63d2",
    "0x0a869d79a7052c7f1b55a8ebabbea3420f0d1e13",
    "0xe93381fb4c4f14bda253907b18fad305d799241a",
    "0x1522900b6dafac587d499a862861c0869be6e428",
  ]);
  if (swept.has(l.address.toLowerCase())) return 0.75;
  if (["bridge", "staking", "protocol", "dex", "burn", "token"].includes(l.category)) return 1;
  return 0.9;
}

/**
 * Solana labels. Kept separate because Solana whale detection is
 * tracked-address based, so this list is not just cosmetic — it IS the set of
 * accounts the Solana scanner polls. Only well-known program addresses that
 * can be checked with getAccountInfo are seeded; exchange hot wallets rotate
 * too often on Solana to hard-code responsibly.
 */
export const SOLANA_LABELS: AddressLabelSeed[] = [
  { chainSlug: "solana", address: "So11111111111111111111111111111111111111112", label: "Wrapped SOL", entity: "Solana", category: "token", tags: ["token", "wrapped"] },
  { chainSlug: "solana", address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", label: "USDC (Solana)", entity: "Circle", category: "token", tags: ["token", "stablecoin"] },
  { chainSlug: "solana", address: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", label: "USDT (Solana)", entity: "Tether", category: "token", tags: ["token", "stablecoin"] },
  { chainSlug: "solana", address: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4", label: "Jupiter Aggregator v6", entity: "Jupiter", category: "dex", tags: ["dex", "aggregator"] },
  { chainSlug: "solana", address: "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8", label: "Raydium AMM v4", entity: "Raydium", category: "dex", tags: ["dex", "amm"] },
  { chainSlug: "solana", address: "Stake11111111111111111111111111111111111111", label: "Stake Program", entity: "Solana", category: "staking", tags: ["staking", "system"] },
  { chainSlug: "solana", address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", label: "SPL Token Program", entity: "Solana", category: "protocol", tags: ["system"] },
];

/** Which categories count as an exchange for flow classification. */
export const EXCHANGE_CATEGORIES = new Set(["cex", "exchange"]);
