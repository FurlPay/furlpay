// ---------------------------------------------------------------------------
// Chain Adapter Registry
//
// The central directory for instantiated chain adapters. FurlPay connects to
// multiple networks, but adapters are only instantiated when first accessed
// to preserve memory and avoid spamming idle RPC connections.
//
// This maps the static configs from CHAIN_REGISTRY into active adapters.
// ---------------------------------------------------------------------------

import { ChainAdapter } from './chainAdapter';
import { EvmAdapter } from './evmAdapter';
import { SolanaAdapter } from './solanaAdapter';
import { CHAIN_REGISTRY } from '../services/chainRegistry';

const adapters = new Map<string, ChainAdapter>();

/**
 * Lazy-initializes and returns the canonical ChainAdapter for the given slug.
 * Throws a descriptive error if the chain is unknown.
 */
export function getAdapter(chainSlug: string): ChainAdapter {
  if (adapters.has(chainSlug)) {
    return adapters.get(chainSlug)!;
  }

  const config = CHAIN_REGISTRY.find(c => c.id === chainSlug);
  
  if (!config && chainSlug !== "solana") {
    // Solana might not be in CHAIN_REGISTRY yet based on current codebase state,
    // but we know we support it via SolanaAdapter. 
    // In a full implementation, Solana should be added to CHAIN_REGISTRY.
    throw new Error(
      `Unknown chain slug: "${chainSlug}". Cannot instantiate ChainAdapter. ` +
      `Ensure the network is defined in lib/services/chainRegistry.ts.`
    );
  }

  let adapter: ChainAdapter;

  if (chainSlug === "solana") {
    const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
    adapter = new SolanaAdapter({ rpcUrl });
  } else {
    adapter = new EvmAdapter({
      chainSlug: config!.id,
      chainId: config!.chainId,
      rpcUrl: config!.rpcUrl,
    });
  }

  adapters.set(chainSlug, adapter);
  return adapter;
}

/**
 * Returns true if an adapter can be constructed for the given slug.
 */
export function hasAdapter(chainSlug: string): boolean {
  if (chainSlug === "solana") return true;
  return CHAIN_REGISTRY.some(c => c.id === chainSlug);
}

/**
 * Instantiates (if needed) and returns adapters for all known networks.
 */
export function allAdapters(): readonly ChainAdapter[] {
  const allSlugs = [...CHAIN_REGISTRY.map(c => c.id), "solana"];
  return allSlugs.map(slug => getAdapter(slug));
}
