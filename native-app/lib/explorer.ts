import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { cacheGet, cacheSet } from "./db";

// ---------------------------------------------------------------------------
// Block-explorer links, resolved from the server's chain registry.
//
// NO LOCAL CHAIN TABLE. The obvious implementation is a map of slug → explorer
// URL right here, and it is wrong for the same reason the token-address map was
// wrong: it is a second source of truth that can only be corrected by an
// app-store release. Robinhood Chain runs on Blockscout today; when a network
// moves explorer, a shipped constant sends users to a 404 and there is nothing
// to do about it for a week.
//
// The server already owns this (CHAIN_REGISTRY), so the app reads it and caches
// it. Chain metadata changes about never, so a stale cache is fine — and the
// failure mode is deliberately "no link" rather than a guessed one. A link that
// silently goes to the wrong chain's explorer would show the user "transaction
// not found" for a transaction that exists, which reads as lost funds.
// ---------------------------------------------------------------------------

export interface ChainInfo {
  id: string;
  name: string;
  chainId: number;
  explorer: string;
}

const CACHE_KEY = "chains";

/**
 * Chain metadata, cached indefinitely.
 *
 * Served from cache first and refreshed in the background: a transaction detail
 * screen must be able to render an explorer link offline, and the data it needs
 * has not changed since the last time the app had a network.
 */
export async function fetchChains(): Promise<ChainInfo[]> {
  try {
    const res = await api<{ chains: ChainInfo[] }>("/chain/status");
    const chains = (res.chains ?? []).filter((c) => c && c.explorer && c.id);
    if (chains.length) cacheSet(CACHE_KEY, chains);
    return chains;
  } catch {
    return cacheGet<ChainInfo[]>(CACHE_KEY)?.value ?? [];
  }
}

/** Cached chain metadata without a network round trip. */
export function cachedChains(): ChainInfo[] {
  return cacheGet<ChainInfo[]>(CACHE_KEY)?.value ?? [];
}

function findChain(chains: ChainInfo[], chain: string | number): ChainInfo | undefined {
  if (typeof chain === "number") return chains.find((c) => c.chainId === chain);
  const slug = chain.toLowerCase();
  return chains.find((c) => c.id.toLowerCase() === slug);
}

/**
 * Explorer URL for a transaction, or `null` when we cannot say.
 *
 * Null on an unknown chain or a malformed hash, on purpose — see the header.
 * Callers render the link only when it exists rather than a dead button.
 */
export function explorerTxUrl(
  chain: string | number,
  txHash: string | null | undefined,
  chains: ChainInfo[] = cachedChains()
): string | null {
  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) return null;
  const info = findChain(chains, chain);
  if (!info?.explorer) return null;
  return `${info.explorer.replace(/\/+$/, "")}/tx/${txHash}`;
}

/** Explorer URL for an address, same rules. */
export function explorerAddressUrl(
  chain: string | number,
  address: string | null | undefined,
  chains: ChainInfo[] = cachedChains()
): string | null {
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) return null;
  const info = findChain(chains, chain);
  if (!info?.explorer) return null;
  return `${info.explorer.replace(/\/+$/, "")}/address/${address}`;
}

/** Human name for a chain slug — "Base" rather than "base". */
export function chainName(chain: string | number, chains: ChainInfo[] = cachedChains()): string {
  const info = findChain(chains, chain);
  if (info?.name) return info.name;
  // Falls back to the slug rather than "Unknown": the slug is at least true.
  return typeof chain === "number" ? `Chain ${chain}` : chain;
}

export function useChains() {
  return useQuery({
    queryKey: ["chains"],
    queryFn: fetchChains,
    // Chain metadata is effectively static; refetching it per screen is waste.
    staleTime: 24 * 60 * 60 * 1000,
    initialData: cachedChains,
  });
}
