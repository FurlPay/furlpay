// ---------------------------------------------------------------------------
// FURL cross-chain bridge configuration.
//
// NOTHING HERE IS DEPLOYED. Every spoke's `token` is null and every
// `supplyBaseUnits` is null, because no contract exists on any of these chains
// and nothing is locked on Solana.
//
// `null` is not `0`. A spoke with zero supply would mean "deployed, nothing
// bridged"; a spoke with null means "there is no contract". Collapsing the two
// would let a reader — or an aggregator — conclude the bridge exists and is
// simply unused, which is a different and much more flattering claim than the
// truth.
//
// WHEN A SPOKE GOES LIVE: set `token` to the deployed CanonicalFURL address and
// read `supplyBaseUnits` from its `totalSupply()`. `bridgeIsLive()` flips on its
// own; there is no separate flag to remember to change.
// ---------------------------------------------------------------------------

export interface FurlSpoke {
  readonly chain: string;
  readonly chainId: number;
  /** CanonicalFURL address, or null when not deployed. */
  readonly token: string | null;
  /** `totalSupply()` in base units, or null when unknown/undeployed. */
  readonly supplyBaseUnits: bigint | null;
  /** Wormhole NTT manager, or null. */
  readonly nttManager: string | null;
}

/**
 * The planned spokes, from packages/contracts/deployment.yaml.
 *
 * Listed before deployment on purpose: the shape of the intended system is
 * public, and the `deployed: false` that the API returns for each is a fact
 * worth publishing rather than an absence worth hiding.
 */
export const FURL_SPOKES: readonly FurlSpoke[] = [
  { chain: "Arbitrum One", chainId: 42161, token: null, supplyBaseUnits: null, nttManager: null },
  { chain: "Base", chainId: 8453, token: null, supplyBaseUnits: null, nttManager: null },
];

/** True only once at least one spoke contract actually exists. */
export function bridgeIsLive(): boolean {
  return FURL_SPOKES.some((s) => s.token !== null);
}

/** Spokes with a deployed contract. Empty today. */
export function deployedSpokes(): readonly FurlSpoke[] {
  return FURL_SPOKES.filter((s) => s.token !== null);
}
