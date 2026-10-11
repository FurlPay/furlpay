import { getChain } from "@/lib/services/chainRegistry";

// ---------------------------------------------------------------------------
// Asset registry for onchain intelligence. An asset is identified by its
// CONTRACT (EVM address / Solana mint) per chain — never by symbol: the
// bridged USDC.e contracts on Polygon and Arbitrum report symbol() = "USDC"
// on-chain (verified 2026-10-07: "USD Coin (PoS)" 0x2791…, "USD Coin (Arb1)"
// 0xff97…), so a symbol match would silently merge two different tokens.
//
// `indexed: false` keeps an asset defined (so it can be recognised, labelled
// and explicitly excluded) without the network indexer reading it. Turning
// USDC.e on later is a registry change, not an indexer rewrite.
//
// Native USDC addresses come from the chain registry (the same source the
// payment rails use); nothing here is a second copy of them.
// ---------------------------------------------------------------------------

export type AssetId = "usdc" | "usdc.e";

export interface AssetDef {
  id: AssetId;
  symbol: string;
  name: string;
  issuer: string;
  kind: "native" | "bridged";
  /** decimals() every deployment must report; the indexer refuses a contract that disagrees. */
  decimals: number;
  /** Read by the network indexer and shown on the dashboard. */
  indexed: boolean;
  /** Why an asset is not indexed — shown in the UI so the exclusion is explicit. */
  exclusion: string | null;
  /** chain -> contract (EVM lowercased; Solana base58 as-is). */
  deployments: Record<string, string>;
}

const lowerEvm = (a: string) => (/^0x[0-9a-fA-F]{40}$/.test(a) ? a.toLowerCase() : a);

function nativeUsdc(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of ["ethereum", "base", "arbitrum", "polygon", "solana"]) {
    const a = getChain(c)?.usdc?.native;
    if (a) out[c] = lowerEvm(a);
  }
  return out;
}

export function assetRegistry(): AssetDef[] {
  return [
    {
      id: "usdc",
      symbol: "USDC",
      name: "USD Coin (native)",
      issuer: "Circle",
      kind: "native",
      decimals: 6,
      indexed: true,
      exclusion: null,
      deployments: nativeUsdc(),
    },
    {
      id: "usdc.e",
      symbol: "USDC.e",
      name: "USD Coin (bridged)",
      issuer: "Bridge-issued (not Circle)",
      kind: "bridged",
      decimals: 6,
      indexed: false,
      exclusion: "Bridged USDC.e is a different token from Circle-issued native USDC (a bridge's claim on USDC locked on Ethereum). It is not summed into USDC.",
      deployments: {
        // Arbitrum: from the chain registry. Polygon: PoS-bridge USDC, verified on-chain 2026-10-07.
        ...(getChain("arbitrum")?.usdc?.bridged ? { arbitrum: lowerEvm(getChain("arbitrum")!.usdc!.bridged!) } : {}),
        polygon: "0x2791bca1f2de4661ed88a30c99a7a9449aa84174",
      },
    },
  ];
}

export function getAsset(id: string): AssetDef | null {
  return assetRegistry().find((a) => a.id === id) ?? null;
}

/** The registry asset a contract belongs to on a chain, or null. Address-based only. */
export function classifyContract(chain: string, contract: string | null | undefined): AssetDef | null {
  if (!contract) return null;
  const c = lowerEvm(contract);
  return assetRegistry().find((a) => a.deployments[chain] === c) ?? null;
}

/** Assets the network indexer reads on `chain`. */
export function indexedAssetsOn(chain: string): { asset: AssetDef; contract: string }[] {
  return assetRegistry()
    .filter((a) => a.indexed && a.deployments[chain])
    .map((a) => ({ asset: a, contract: a.deployments[chain] }));
}
