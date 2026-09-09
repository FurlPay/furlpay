// ---------------------------------------------------------------------------
// NFT indexing: the adapter boundary.
//
// WHY AN INDEXER IS UNAVOIDABLE. There is no way to enumerate an address's
// ERC-721 holdings from RPC alone. The standard has no "tokens of owner" view
// (ERC721Enumerable is optional and most collections skip it), so the only
// alternative is replaying every Transfer log since each contract's deployment
// — thousands of `eth_getLogs` calls per wallet, per chain. That is what an
// indexer is for, and pretending otherwise would mean an NFT tab that never
// finds anything.
//
// WHY IT GOES THROUGH THIS SERVER. Same three reasons as the transaction
// scanner: an API key in an APK is a public API key; one integration serves
// mobile, extension and web; and only the server can cache and rate-limit what
// a vendor bills for.
//
// NOTHING HERE INVENTS AN NFT. With no provider configured, `indexerStatus()`
// reports `unconfigured` and the route says so. The client renders "NFT
// indexing is not set up for this deployment" — which is true — rather than an
// empty gallery, which would read as "you own nothing" and is a different and
// wrong statement.
//
// ADDING A PROVIDER is implementing `NftIndexer` and registering it below. The
// normalisation the client performs (native-app/lib/nft/metadata.ts) is shared
// across providers, so an adapter only has to produce the raw row shape.
// ---------------------------------------------------------------------------

export interface NftIndexerRow {
  contract: string;
  tokenId: string;
  standard?: "erc721" | "erc1155";
  balance?: string;
  name?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  thumbnailUrl?: string | null;
  mimeType?: string | null;
  /** The provider's own spam verdict, when it has one. */
  spam?: boolean;
  collection?: {
    name?: string | null;
    symbol?: string | null;
    imageUrl?: string | null;
    verified?: boolean;
  };
}

export interface NftIndexerPage {
  rows: NftIndexerRow[];
  /** Opaque provider cursor. Null when the listing is complete. */
  cursor: string | null;
}

export interface NftIndexerQuery {
  chain: string;
  owner: string;
  cursor?: string;
  limit: number;
}

export interface NftIndexer {
  readonly name: string;
  /** Chains this adapter can serve, as FurlPay chain slugs. */
  readonly chains: readonly string[];
  fetchOwned(query: NftIndexerQuery): Promise<NftIndexerPage>;
}

export type IndexerStatus =
  | { configured: true; provider: string }
  | { configured: false; reason: "no_provider" | "no_credential"; provider: string | null };

/**
 * Is an NFT indexer configured for this deployment?
 *
 * BOTH the provider name and the credential are required, and the distinction
 * between the two failure reasons matters to whoever is deploying: "no provider
 * selected" is a decision nobody has made, and "provider named but no key" is a
 * half-finished configuration that would otherwise surface as an
 * authentication error the client reports as an outage.
 */
export function indexerStatus(): IndexerStatus {
  const provider = (process.env.FURLPAY_NFT_INDEXER ?? "").trim();
  const key = (process.env.FURLPAY_NFT_INDEXER_API_KEY ?? "").trim();

  if (!provider) return { configured: false, reason: "no_provider", provider: null };
  if (!key) return { configured: false, reason: "no_credential", provider };
  return { configured: true, provider };
}

/**
 * Adapters that have been implemented.
 *
 * EMPTY, and that is the honest state. No NFT indexing vendor is contracted, so
 * there is no adapter to register — exactly as lib/providers/capability.ts
 * ships with no rows for fiat rails. A populated map here with no agreement
 * behind it would be a claim this codebase cannot support.
 *
 * See ./README.md for what implementing one requires.
 */
const ADAPTERS = new Map<string, NftIndexer>();

export function registerIndexer(adapter: NftIndexer): void {
  ADAPTERS.set(adapter.name.toLowerCase(), adapter);
}

export function resolveIndexer(): NftIndexer | null {
  const status = indexerStatus();
  if (!status.configured) return null;
  return ADAPTERS.get(status.provider.toLowerCase()) ?? null;
}

export type FetchOutcome =
  | { ok: true; page: NftIndexerPage; provider: string }
  | { ok: false; reason: "unconfigured" | "no_adapter" | "provider_error"; message: string };

/**
 * Fetch a page of owned NFTs.
 *
 * The three failure reasons are kept apart because they need different actions:
 * `unconfigured` is a deployment decision, `no_adapter` is a named provider
 * with no code behind it (a misconfiguration a retry cannot fix), and
 * `provider_error` is transient and worth retrying. Collapsing them into one
 * error would mean a client retrying forever against a vendor nobody signed up
 * with.
 */
export async function fetchOwnedNfts(query: NftIndexerQuery): Promise<FetchOutcome> {
  const status = indexerStatus();
  if (!status.configured) {
    return {
      ok: false,
      reason: "unconfigured",
      message:
        status.reason === "no_provider"
          ? "No NFT indexer is configured for this deployment."
          : `${status.provider} is named as the NFT indexer but no API credential is set.`,
    };
  }

  const adapter = resolveIndexer();
  if (!adapter) {
    return {
      ok: false,
      reason: "no_adapter",
      message: `No adapter is implemented for NFT indexer "${status.provider}".`,
    };
  }

  if (!adapter.chains.includes(query.chain)) {
    return {
      ok: false,
      reason: "provider_error",
      message: `${adapter.name} does not index ${query.chain}.`,
    };
  }

  try {
    return { ok: true, page: await adapter.fetchOwned(query), provider: adapter.name };
  } catch (e) {
    return { ok: false, reason: "provider_error", message: (e as Error).message };
  }
}

/** Test seam — never called from app code. */
export function __clearIndexersForTest(): void {
  ADAPTERS.clear();
}
