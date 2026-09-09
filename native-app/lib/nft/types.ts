import type { ChainId } from "@/lib/swap/assets";

// ---------------------------------------------------------------------------
// NFT domain model.
//
// TWO KINDS OF FACT, AND THEY ARE NOT EQUALLY TRUSTWORTHY. Everything here is
// one or the other, and the type keeps them apart:
//
//   INDEXED     came from an indexer's database. Fast, complete, and a claim.
//               An indexer can be stale, can be wrong, and returns whatever a
//               contract's metadata says — including a collection name copied
//               from a real one.
//
//   VERIFIED    read from the chain by this device. Slow, narrow, and true.
//               Only `ownerOf` / `balanceOf` produce this.
//
// The gallery renders INDEXED data because rendering fifty items would
// otherwise be fifty RPC calls. The SEND flow requires VERIFIED data, because
// signing a transfer of something the wallet does not own produces a
// transaction that burns gas and reverts — and the user was told they owned it.
//
// SPAM IS THE DEFAULT ASSUMPTION FOR UNKNOWN COLLECTIONS. Airdropped NFTs are
// the primary phishing vector on every EVM chain: a token appears in a wallet
// with a name like "$5000 USDC Voucher — claim at …". They cannot be refused
// (anyone can send to any address) so they must be SEPARATED, never hidden
// entirely — hiding them means a user cannot see what an attacker sent them.
// ---------------------------------------------------------------------------

export type NftStandard = "erc721" | "erc1155";

export interface NftMedia {
  /**
   * Resolved, loadable URL — https only.
   *
   * `ipfs://` and `ar://` are rewritten to a gateway before they reach here,
   * because React Native's Image cannot fetch either scheme and renders a
   * permanently blank box instead of an error.
   */
  url: string | null;
  /** Present when the indexer produced a small preview; avoids fetching full art. */
  thumbnailUrl: string | null;
  mimeType: string | null;
}

export interface NftItem {
  /** Stable across refreshes: `${chain}:${contract}:${tokenId}`. */
  id: string;
  chain: ChainId;
  contract: string;
  tokenId: string;
  standard: NftStandard;
  /** ERC-1155 can hold many of one id; ERC-721 is always "1". Decimal string. */
  balance: string;
  name: string | null;
  description: string | null;
  media: NftMedia;
  collection: NftCollection;
  /**
   * Why this item is considered spam, or null when it is not.
   *
   * A REASON rather than a boolean so the UI can say what triggered it. "Hidden
   * because we thought so" is not something a user can argue with, and they are
   * the only one who knows whether they bought this.
   */
  spamReason: string | null;
}

export interface NftCollection {
  contract: string;
  name: string | null;
  symbol: string | null;
  imageUrl: string | null;
  /**
   * The indexer's verification badge, when it has one.
   *
   * Purely informational and NEVER load-bearing for a transfer. It reflects a
   * marketplace's opinion, not ownership.
   */
  verified: boolean;
}

/** What `ownerOf` / `balanceOf` said, on this device, just now. */
export interface OwnershipProof {
  owned: boolean;
  /** Decimal string. "0" when not owned; ERC-721 returns "1" or "0". */
  balance: string;
  /** The address the contract reports as owner (ERC-721 only). */
  owner: string | null;
  checkedAt: number;
}

export type NftIndexerStatus =
  /** A provider is configured and answered. */
  | { kind: "ok"; provider: string }
  /** No indexer is configured for this deployment. NOT an error, and not "no NFTs". */
  | { kind: "unconfigured" }
  /** Configured but failed. Distinct from unconfigured — retrying may help. */
  | { kind: "error"; message: string };

export interface NftPage {
  items: NftItem[];
  /** Opaque; pass back to fetch the next page. Null when the list is complete. */
  cursor: string | null;
  status: NftIndexerStatus;
}

/** Group a flat list into collections, most-populated first. */
export function groupByCollection(items: NftItem[]): Array<{ collection: NftCollection; items: NftItem[] }> {
  const groups = new Map<string, { collection: NftCollection; items: NftItem[] }>();

  for (const item of items) {
    // Keyed by chain AND contract: the same contract address on Base and
    // Arbitrum is two different collections, and merging them would show a user
    // one group whose items cannot all be transferred on one network.
    const key = `${item.chain}:${item.contract.toLowerCase()}`;
    const existing = groups.get(key);
    if (existing) existing.items.push(item);
    else groups.set(key, { collection: item.collection, items: [item] });
  }

  return [...groups.values()].sort((a, b) => {
    // Verified collections first, then by size, then by name — a stable order,
    // so the gallery does not reshuffle between refreshes.
    if (a.collection.verified !== b.collection.verified) return a.collection.verified ? -1 : 1;
    if (a.items.length !== b.items.length) return b.items.length - a.items.length;
    return (a.collection.name ?? "").localeCompare(b.collection.name ?? "");
  });
}

/** Split spam out without discarding it. */
export function partitionSpam(items: NftItem[]): { clean: NftItem[]; spam: NftItem[] } {
  const clean: NftItem[] = [];
  const spam: NftItem[] = [];
  for (const item of items) (item.spamReason ? spam : clean).push(item);
  return { clean, spam };
}
