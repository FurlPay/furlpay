// Shared domain types.
//
// The distinction that matters most here is between the three value families
// the prompt insists must never be conflated: a *token* market cap, a *chain*
// TVL, and chain *economic activity*. They live on different records on
// purpose, and a chain with no native token simply has no token record.

export type ChainType =
  | "evm"
  | "solana"
  | "cosmos"
  | "substrate"
  | "cardano"
  | "stellar"
  | "hedera"
  | "algorand"
  | "icp"
  | "sui"
  | "aptos"
  | "tron"
  | "near"
  | "starknet";

export type Layer = "L0" | "L1" | "L2" | "L3";
export type Tier = 1 | 2 | 3;

export interface ChainSeed {
  slug: string;
  name: string;
  /**
   * Ticker of the chain's own token, or null when the chain has none.
   * Base and Robinhood Chain are null — they must never be given a market cap.
   */
  symbol: string | null;
  chainType: ChainType;
  layer: Layer;
  parentChain: string | null;
  evmChainId: number | null;
  alchemySubdomain: string | null;
  publicRpc: string[];
  explorerUrl: string;
  explorerName: string;
  etherscanChainId: number | null;
  coingeckoId: string | null;
  defillamaSlug: string | null;
  /** The asset used to pay gas — not necessarily the chain's own token. */
  nativeToken: string;
  nativeDecimals: number;
  logo: string;
  coinLogo: string;
  categories: string[];
  blockTimeSec: number;
  tier: Tier;
  scanNativeTransfers: boolean;
  whaleThresholdsUsd: number[];
  color: number;
}

export interface ChainRow extends Omit<ChainSeed, "publicRpc" | "categories" | "whaleThresholdsUsd"> {
  id: number;
  publicRpc: string[];
  categories: string[];
  whaleThresholdsUsd: number[];
  enabled: boolean;
  isTestnet: boolean;
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

/* ------------------------------------------------------------------ */
/* Market data — belongs to a TOKEN, never to a chain                  */
/* ------------------------------------------------------------------ */

export interface MarketQuote {
  coingeckoId: string;
  symbol: string;
  priceUsd: number | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  volume24hUsd: number | null;
  change24hPct: number | null;
  change7dPct: number | null;
  change30dPct: number | null;
  circulatingSupply: number | null;
  totalSupply: number | null;
  maxSupply: number | null;
  athUsd: number | null;
  atlUsd: number | null;
  sparkline7d: number[] | null;
  fetchedAt: number;
  source: string;
}

/* ------------------------------------------------------------------ */
/* DeFi metrics — belong to a CHAIN                                    */
/* ------------------------------------------------------------------ */

export interface DefiMetrics {
  chainSlug: string;
  tvlUsd: number | null;
  tvlChange24hPct: number | null;
  stablecoinMcapUsd: number | null;
  dexVolume24hUsd: number | null;
  fees24hUsd: number | null;
  revenue24hUsd: number | null;
  rwaTvlUsd: number | null;
  protocolCount: number | null;
  fetchedAt: number;
  source: string;
}

/* ------------------------------------------------------------------ */
/* Chain activity — read from the chain itself, not from a market API  */
/* ------------------------------------------------------------------ */

export interface ChainHead {
  chainSlug: string;
  blockHeight: number | null;
  blockTimestamp: number | null;
  /** Measured, not the configured constant. Null until two samples exist. */
  observedBlockTimeSec: number | null;
  gasPriceGwei: number | null;
  txCount24h: number | null;
  fetchedAt: number;
  source: string;
  healthy: boolean;
  latencyMs: number | null;
  error: string | null;
}

/* ------------------------------------------------------------------ */
/* Addresses                                                           */
/* ------------------------------------------------------------------ */

export type AddressCategory =
  | "whale"
  | "exchange"
  | "cex"
  | "dex"
  | "protocol"
  | "treasury"
  | "foundation"
  | "team"
  | "bridge"
  | "mev"
  | "staking"
  | "validator"
  | "burn"
  | "contract"
  | "token"
  | "unknown";

export interface WalletRecord {
  id: number;
  chainSlug: string;
  address: string;
  label: string | null;
  entity: string | null;
  category: AddressCategory;
  balanceNative: number | null;
  balanceUsd: number | null;
  txCount: number | null;
  firstSeen: number | null;
  lastSeen: number | null;
  whaleScore: number | null;
  tags: string[];
  /** 0..1 — how much we trust the label. Seeded labels are 1, inferred lower. */
  confidence: number;
  source: string | null;
}

export interface AddressLabelSeed {
  chainSlug: string;
  address: string;
  label: string;
  entity: string;
  category: AddressCategory;
  tags?: string[];
}

/* ------------------------------------------------------------------ */
/* Whales                                                              */
/* ------------------------------------------------------------------ */

export type WhaleTier = "fish" | "dolphin" | "shark" | "whale" | "humpback" | "mega" | "titan";

export type WhaleEventType =
  | "native_transfer"
  | "token_transfer"
  | "stablecoin_transfer"
  | "exchange_deposit"
  | "exchange_withdrawal"
  | "bridge_transfer"
  | "treasury_movement"
  | "dex_transfer"
  | "mint"
  | "burn";

export interface WhaleEvent {
  chainSlug: string;
  txHash: string;
  /** Distinguishes multiple transfers inside one transaction. */
  logIndex: number | null;
  blockNumber: number | null;
  timestamp: number;
  tokenSymbol: string;
  tokenAddress: string | null;
  amount: number;
  amountUsd: number;
  priceUsd: number | null;
  fromAddress: string;
  toAddress: string;
  fromLabel: string | null;
  toLabel: string | null;
  fromCategory: AddressCategory;
  toCategory: AddressCategory;
  eventType: WhaleEventType;
  tier: WhaleTier;
  /** 0..1 — drops when the USD value rests on a stale or inferred price. */
  confidence: number;
  source: string;
  explorerUrl: string;
}

/* ------------------------------------------------------------------ */
/* Providers                                                           */
/* ------------------------------------------------------------------ */

export type ProviderKind = "blockchain" | "market" | "defi" | "news" | "intelligence";

export interface ProviderHealth {
  name: string;
  kind: ProviderKind;
  configured: boolean;
  state: "closed" | "open" | "half-open";
  lastOkAt: number | null;
  lastErrorAt: number | null;
  lastError: string | null;
  calls: number;
  failures: number;
  avgLatencyMs: number | null;
  /** Provider-specific budget consumed this month, when metered. */
  budgetUsed: number | null;
  budgetLimit: number | null;
}

/* ------------------------------------------------------------------ */
/* Alerts                                                              */
/* ------------------------------------------------------------------ */

export type AlertKind = "price" | "whale" | "transaction" | "gas" | "tvl" | "system";
export type Comparator = "above" | "below" | "change";

export interface AlertRule {
  id: number;
  guildId: string;
  channelId: string | null;
  userId: string | null;
  kind: AlertKind;
  chainSlug: string | null;
  target: string | null;
  comparator: Comparator;
  threshold: number;
  cooldownSec: number;
  enabled: boolean;
  lastFiredAt: number | null;
  createdAt: number;
}

/** Where each alert family is routed for one guild. */
export interface GuildSettings {
  guildId: string;
  categoryPrefix: string;
  channels: Record<string, string>;
  whaleMinUsd: number;
  enabledChains: string[] | null;
  setupAt: number | null;
}
