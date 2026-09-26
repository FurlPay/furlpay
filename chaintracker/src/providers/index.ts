// Provider registry and the capability matrix.
//
// Business logic asks this module "who can answer X for chain Y" rather than
// importing an adapter directly, which is what keeps a provider swappable. The
// capability matrix is computed from configuration, not hard-coded, so the
// answers stay true when a key is added or a network is enabled.

import { env } from "../config/env.js";
import { EvmProvider } from "./evm.js";
import { NonEvmProvider } from "./nonEvm.js";
import { CoinGeckoProvider } from "./coingecko.js";
import { DefiLlamaProvider } from "./defillama.js";
import { HeliusProvider } from "./helius.js";
import { EtherscanProvider } from "./etherscan.js";
import { BirdeyeProvider } from "./birdeye.js";
import type { Provider } from "./base.js";
import type { ChainRow, ProviderHealth } from "../types/index.js";

export const evm = new EvmProvider();
export const nonEvm = new NonEvmProvider();
export const coingecko = new CoinGeckoProvider();
export const defillama = new DefiLlamaProvider();
export const helius = new HeliusProvider();
export const etherscan = new EtherscanProvider();
export const birdeye = new BirdeyeProvider();

export const ALL_PROVIDERS: Provider[] = [
  evm,
  nonEvm,
  coingecko,
  defillama,
  helius,
  etherscan,
  birdeye,
];

export function healthAll(): ProviderHealth[] {
  return ALL_PROVIDERS.map((p) => p.health());
}

export async function pingAll(): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  await Promise.all(
    ALL_PROVIDERS.map(async (p) => {
      if (!p.configured) {
        out.set(p.name, false);
        return;
      }
      try {
        out.set(p.name, await p.ping());
      } catch {
        out.set(p.name, false);
      }
    }),
  );
  return out;
}

/* ------------------------------------------------------------------ */
/* Capability matrix                                                   */
/* ------------------------------------------------------------------ */

export interface ChainCapabilities {
  slug: string;
  /** Can we read a block height / liveness for this chain? */
  head: boolean;
  /** Can we read gas price? */
  gas: boolean;
  /** Can we read an address balance? */
  balance: boolean;
  /** Can we detect whale transfers, and by which strategy? */
  whales: "block-scan" | "tracked-address" | "none";
  /** Can we read indexed address history (Etherscan)? */
  addressHistory: boolean;
  /** Market data — requires the chain to have its own listed token. */
  market: boolean;
  /** DeFi metrics from DeFiLlama. */
  defi: boolean;
  /** The provider actually serving chain data. */
  primary: string;
  /** Human-readable reasons for anything false. */
  notes: string[];
}

export function capabilitiesFor(chain: ChainRow): ChainCapabilities {
  const notes: string[] = [];
  const isEvm = chain.chainType === "evm";
  const isSolana = chain.chainType === "solana";

  const head = isEvm || isSolana || nonEvmSupported(chain);
  if (!head) notes.push(`no public head endpoint mapped for ${chain.chainType}`);

  const gas = isEvm;
  if (!gas && !isSolana) notes.push("gas price is an EVM concept on this build");

  const balance = isEvm || isSolana;
  if (!balance) notes.push("balance lookups need a chain-specific indexer");

  let whales: ChainCapabilities["whales"] = "none";
  if (isEvm) whales = "block-scan";
  else if (isSolana) whales = "tracked-address";
  else notes.push(`whale detection for ${chain.chainType} needs a paid indexer`);

  const addressHistory = etherscan.supports(chain);
  if (!addressHistory && isEvm) notes.push("no Etherscan V2 chainid mapped");

  const market = !!chain.coingeckoId;
  if (!market) {
    notes.push(
      chain.symbol === null
        ? "chain has no native token, so it has no market cap by definition"
        : "no CoinGecko id mapped",
    );
  }

  const defi = !!chain.defillamaSlug;
  if (!defi) notes.push("not tracked by DeFiLlama");

  let primary = "public RPC";
  if (isSolana) primary = env.heliusKey ? "helius" : "solana public RPC";
  else if (isEvm) primary = evm.usingAlchemy(chain) ? "alchemy" : "public RPC";
  else if (nonEvmSupported(chain)) primary = "public chain API";

  return { slug: chain.slug, head, gas, balance, whales, addressHistory, market, defi, primary, notes };
}

const NON_EVM_HEAD = new Set([
  "cosmos", "near", "substrate", "stellar", "algorand", "aptos",
  "sui", "tron", "cardano", "hedera", "icp", "starknet",
]);

function nonEvmSupported(chain: ChainRow): boolean {
  return NON_EVM_HEAD.has(chain.chainType) && chain.publicRpc.length > 0;
}

/** Which provider reads chain state for this chain. */
export function headProviderFor(chain: ChainRow): "evm" | "helius" | "nonEvm" | "none" {
  if (chain.chainType === "evm") return "evm";
  if (chain.chainType === "solana") return "helius";
  if (nonEvmSupported(chain)) return "nonEvm";
  return "none";
}

export { MetricUnavailable } from "./defillama.js";
export { ProEndpointError } from "./etherscan.js";
export { CG_PLATFORM } from "./coingecko.js";
