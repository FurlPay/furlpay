// ---------------------------------------------------------------------------
// Canonical asset identity.
//
// A SYMBOL IS NOT AN IDENTITY. "USDC" names at least seven distinct tokens
// across the networks this repository already references, and two of those are
// testnet issues of the others. Code that compares symbols will happily accept
// a mainnet mint on a devnet payment — which is the defect this module exists
// to make unrepresentable.
//
// Identity is the triple (chain, network, address). Everything else on the
// record — decimals, symbol, name — is carried WITH the identity so that no
// caller has to look them up, and so that no global constant can be wrong for
// the asset actually in hand.
//
// The shape follows Tangem's `CryptoCurrency` (reference/tangem-app-android):
// network and decimals live ON the currency, validated at construction, so a
// token that disagrees with its own network cannot be built. The mechanism is
// ours; the discipline is theirs.
// ---------------------------------------------------------------------------

/** A settlement environment. Testnets are FIRST-CLASS, not a flag: the whole
 *  point is that devnet USDC and mainnet USDC are different assets. */
export type AssetNetwork =
  | "solana:mainnet-beta"
  | "solana:devnet"
  | "base:mainnet"
  | "base:sepolia"
  | "arbitrum:mainnet"
  | "arbitrum:sepolia"
  | "polygon:mainnet"
  | "test:local";

export type AssetChain = "solana" | "base" | "arbitrum" | "polygon" | "test";

/**
 * What kind of environment settles here. THREE kinds, not two.
 *
 *   mainnet     real money
 *   testnet     a real chain, valueless tokens, real signatures
 *   simulation  NO CHAIN AT ALL — nothing is ever broadcast
 *
 * Collapsing `simulation` into `testnet` is the mistake that lets a demo
 * receipt be mistaken for a devnet one. A testnet signature is a real
 * signature that anyone can look up; a simulated reference is not, and the
 * type says so.
 */
export type NetworkKind = "mainnet" | "testnet" | "simulation";

export interface AssetId {
  /** Chain family. Determines address format and comparison rules. */
  readonly chain: AssetChain;
  /** Chain + environment. The discriminator that separates devnet from live. */
  readonly network: AssetNetwork;
  /** Mint (Solana) or contract (EVM). Part of identity. Never a symbol. */
  readonly address: string;
  /** Base units per whole unit, as an exponent. Belongs to the ASSET; there is
   *  deliberately no global default to fall back on. */
  readonly decimals: number;
  /** DISPLAY ONLY. Never compared, never used as a key. */
  readonly symbol: string;
  readonly name: string;
}

export function networkKind(network: AssetNetwork): NetworkKind {
  if (network === "test:local") return "simulation";
  if (network === "solana:devnet" || network === "base:sepolia" || network === "arbitrum:sepolia") {
    return "testnet";
  }
  return "mainnet";
}

/** True when a settlement reference from this network can be looked up by a
 *  third party. False for simulation, where a "reference" proves nothing. */
export function hasVerifiableEvidence(network: AssetNetwork): boolean {
  return networkKind(network) !== "simulation";
}

export function chainOf(network: AssetNetwork): AssetChain {
  return network.split(":")[0] as AssetChain;
}

// ── the registry: one source of truth ──────────────────────────────────────

/**
 * Every asset FurlPay can price, authorize or settle.
 *
 * THIS IS THE ONLY PLACE AN ASSET ADDRESS MAY BE WRITTEN DOWN. A second
 * hardcoded mint elsewhere is a second source of truth, and the two drift the
 * moment one is updated — which is exactly how a mainnet address reaches a
 * devnet code path.
 *
 * Keyed by `chain:network|address` so lookup is by identity, never by symbol.
 */
const REGISTRY: readonly AssetId[] = Object.freeze([
  {
    chain: "solana",
    network: "solana:mainnet-beta",
    address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    decimals: 6,
    symbol: "USDC",
    name: "USD Coin",
  },
  {
    // Circle's devnet issue. Present because the devnet rail is a SUPPORTED
    // configuration — its absence is what forced a second hardcoded mint into
    // examples/agent-paid-api.
    chain: "solana",
    network: "solana:devnet",
    address: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    decimals: 6,
    symbol: "USDC",
    name: "USD Coin (devnet)",
  },
  {
    chain: "base",
    network: "base:mainnet",
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    decimals: 6,
    symbol: "USDC",
    name: "USD Coin",
  },
  {
    chain: "base",
    network: "base:sepolia",
    address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    decimals: 6,
    symbol: "USDC",
    name: "USD Coin (sepolia)",
  },
  {
    chain: "arbitrum",
    network: "arbitrum:mainnet",
    address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    decimals: 6,
    symbol: "USDC",
    name: "USD Coin",
  },
  {
    chain: "arbitrum",
    network: "arbitrum:sepolia",
    address: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    decimals: 6,
    symbol: "USDC",
    name: "USD Coin (sepolia)",
  },
  {
    // THE SIMULATION ASSET. Its address is deliberately not valid base58 and
    // not valid hex, so it cannot be pasted into an explorer, mistaken for a
    // mint, or matched by an address regex. Declaring it here rather than
    // letting callers pass arbitrary strings is what keeps "unknown network"
    // an error instead of an escape hatch.
    chain: "test",
    network: "test:local",
    address: "TESTRAIL-NOT-A-REAL-ASSET",
    decimals: 6,
    symbol: "TEST-USDC",
    name: "Simulated USDC (no chain)",
  },
  {
    chain: "polygon",
    network: "polygon:mainnet",
    address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    decimals: 6,
    symbol: "USDC",
    name: "USD Coin",
  },
]);

/** EVM addresses are case-insensitive; Solana base58 is not. Normalising the
 *  wrong one would either merge two distinct mints or split one contract into
 *  two identities. */
function normalizeAddress(chain: AssetChain, address: string): string {
  return chain === "solana" ? address.trim() : address.trim().toLowerCase();
}

const byKey = new Map<string, AssetId>(
  REGISTRY.map((a) => [`${a.network}|${normalizeAddress(a.chain, a.address)}`, a])
);

export class UnknownAssetError extends Error {
  constructor(network: string, address: string) {
    super(
      `no asset registered as ${address} on ${network}. ` +
        "Assets must be declared in @furlpay/gateway assets.ts — a hardcoded address " +
        "elsewhere is a second source of truth."
    );
    this.name = "UnknownAssetError";
  }
}

export class AssetNetworkMismatchError extends Error {
  constructor(address: string, expected: string, actual: string) {
    super(
      `asset ${address} belongs to ${actual}, but the payment declares ${expected}. ` +
        "Authorizing on one network and settling on another is not a configuration " +
        "choice; it is a lost payment."
    );
    this.name = "AssetNetworkMismatchError";
  }
}

/**
 * Resolve an asset by identity.
 *
 * THE NETWORK IS REQUIRED. A lookup by address alone would return the first
 * registered match, and since a testnet issue can share an address shape with
 * its mainnet counterpart, "first match" is precisely the wrong answer.
 */
export function resolveAsset(network: AssetNetwork, address: string): AssetId {
  const chain = chainOf(network);
  const hit = byKey.get(`${network}|${normalizeAddress(chain, address)}`);
  if (!hit) {
    // Distinguish "unknown anywhere" from "known, but on a DIFFERENT network".
    // The second is the dangerous case and deserves the louder error.
    const elsewhere = REGISTRY.find(
      (a) => normalizeAddress(a.chain, a.address) === normalizeAddress(chainOf(a.network), address)
    );
    if (elsewhere) throw new AssetNetworkMismatchError(address, network, elsewhere.network);
    throw new UnknownAssetError(network, address);
  }
  return hit;
}

/**
 * The default settlement asset for a network. Replaces NETWORK_USDC.
 *
 * Selected by NETWORK, not by symbol. Matching on `symbol === "USDC"` would
 * reintroduce exactly the identity-by-symbol assumption this module exists to
 * remove — and it would silently pick the wrong token the day two assets on
 * one network share a symbol.
 *
 * Ambiguity is an error rather than a guess: when a second asset is registered
 * for a network, this throws and forces the caller to name which one it means.
 */
export function nativeStablecoin(network: AssetNetwork): AssetId {
  const hits = REGISTRY.filter((a) => a.network === network);
  if (hits.length === 0) throw new Error(`no asset registered for network "${network}"`);
  if (hits.length > 1) {
    throw new Error(
      `network "${network}" has ${hits.length} registered assets ` +
        `(${hits.map((a) => a.symbol).join(", ")}) — pass \`asset\` explicitly.`
    );
  }
  return hits[0];
}

/** Identity comparison. Deliberately ignores symbol, name and decimals: two
 *  records that agree on (chain, network, address) but disagree on decimals
 *  are a registry bug, not two different assets. */
export function sameAsset(a: AssetId, b: AssetId): boolean {
  return (
    a.chain === b.chain &&
    a.network === b.network &&
    normalizeAddress(a.chain, a.address) === normalizeAddress(b.chain, b.address)
  );
}

export function isAssetNetwork(value: string): value is AssetNetwork {
  return REGISTRY.some((a) => a.network === value);
}

export function listAssets(): readonly AssetId[] {
  return REGISTRY;
}

export function networksForChain(chain: AssetChain): AssetNetwork[] {
  return [...new Set(REGISTRY.filter((a) => a.chain === chain).map((a) => a.network))];
}

export function allNetworks(): AssetNetwork[] {
  return [...new Set(REGISTRY.map((a) => a.network))];
}

// ── legacy network names ───────────────────────────────────────────────────

/**
 * Map the short network names already in the wild onto canonical networks.
 *
 * The gateway, its CLI and the x402 payloads on the wire all use bare strings
 * like "base" and "solana". Those cannot be broken in this commit — an agent
 * mid-integration would start failing — so they are translated rather than
 * rejected. NOTE THE ASYMMETRY THIS FIXES: "arbitrum-sepolia" and
 * "base-sepolia" were already accepted while "solana-devnet" was not, which is
 * why the devnet rail had to invent its own mint constant.
 */
const LEGACY_NETWORKS: Readonly<Record<string, AssetNetwork>> = Object.freeze({
  solana: "solana:mainnet-beta",
  "solana-devnet": "solana:devnet",
  "solana-mainnet": "solana:mainnet-beta",
  base: "base:mainnet",
  "base-sepolia": "base:sepolia",
  arbitrum: "arbitrum:mainnet",
  "arbitrum-sepolia": "arbitrum:sepolia",
  polygon: "polygon:mainnet",
  // The example's test rail. Mapped rather than special-cased so it goes
  // through exactly the same resolution path as a real network.
  "test-network": "test:local",
  "test-local": "test:local",
});

/** Canonicalise a legacy or already-canonical network name. Returns null when
 *  the name is not a network FurlPay supports at all. */
export function canonicalNetwork(name: string): AssetNetwork | null {
  if (isAssetNetwork(name)) return name;
  return LEGACY_NETWORKS[name] ?? null;
}

export function legacyNetworkNames(): string[] {
  return Object.keys(LEGACY_NETWORKS);
}
