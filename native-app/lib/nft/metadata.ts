import type { NftItem, NftMedia } from "./types";

// ---------------------------------------------------------------------------
// Turning what an indexer said into something safe to render.
//
// NFT METADATA IS ATTACKER-CONTROLLED. Anyone can mint a token with any name,
// any description and any image URL, and send it to any address unsolicited.
// So every string here is treated the way lib/tokens/erc20Metadata.ts treats a
// token symbol: sanitised, length-capped, and never trusted to be what it says.
//
// THE THREE THINGS THAT GO WRONG, in order of how often:
//
//   1. `ipfs://` and `ar://` URLs. React Native's Image component cannot fetch
//      either and renders a permanently blank box — not an error, not a
//      placeholder, just nothing. Rewritten to a gateway here.
//
//   2. Airdropped phishing. A token named "$5,000 USDC — claim at evil.example"
//      lands in the wallet looking like a notification. These are separated,
//      never hidden: a user must be able to see what was sent to them.
//
//   3. `data:` and `javascript:` URLs. A data: URI is legal in metadata and is
//      a way to smuggle content past a CSP; javascript: is never legitimate.
//      Both are dropped rather than rendered.
// ---------------------------------------------------------------------------

/**
 * IPFS gateway.
 *
 * A PUBLIC one, deliberately, and it is a privacy cost worth naming: fetching
 * through a gateway tells that gateway which NFTs this user holds. The
 * alternative — an embedded local IPFS node — is not viable on a phone, and
 * showing no art at all is worse for a gallery whose whole purpose is looking
 * at pictures. Configurable so a deployment can point at its own.
 */
const IPFS_GATEWAY = (process.env.EXPO_PUBLIC_IPFS_GATEWAY ?? "https://ipfs.io/ipfs/").replace(/\/*$/, "/");
const ARWEAVE_GATEWAY = "https://arweave.net/";

/** Same reasoning as lib/tokens/erc20Metadata.ts — escapes, never literal bytes. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;
const INVISIBLE_CHARS = /[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;

export function sanitizeNftText(raw: unknown, maxLength = 128): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(CONTROL_CHARS, "").replace(INVISIBLE_CHARS, "").trim().slice(0, maxLength);
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Resolve a metadata URL to something React Native can actually load.
 *
 * Returns null for anything unloadable or unsafe, and null renders as the
 * placeholder tile. A broken image URL and an absent one look identical to a
 * user, so there is nothing gained by passing through a URL that cannot load.
 */
export function resolveMediaUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const url = raw.trim();
  if (url === "") return null;

  if (url.startsWith("ipfs://")) {
    // `ipfs://ipfs/<cid>` is a real and common malformation; collapsing the
    // duplicate segment is the difference between art and a 404.
    const path = url.slice("ipfs://".length).replace(/^ipfs\//, "");
    return path ? `${IPFS_GATEWAY}${path}` : null;
  }
  if (url.startsWith("ar://")) {
    const path = url.slice("ar://".length);
    return path ? `${ARWEAVE_GATEWAY}${path}` : null;
  }

  // https only. http:// is blocked by Android's cleartext policy in release
  // builds anyway (see the network security config), so passing it through
  // would produce a blank tile on device and a working one in dev.
  if (url.startsWith("https://")) return url;

  // data:, javascript:, file: and everything else. A data: URI is legal in NFT
  // metadata and is also how content gets smuggled past a content policy;
  // rendering one from an attacker-chosen token is not worth the art.
  return null;
}

export function resolveMedia(raw: {
  imageUrl?: unknown;
  thumbnailUrl?: unknown;
  mimeType?: unknown;
}): NftMedia {
  return {
    url: resolveMediaUrl(raw.imageUrl),
    thumbnailUrl: resolveMediaUrl(raw.thumbnailUrl),
    mimeType: sanitizeNftText(raw.mimeType, 64),
  };
}

/**
 * Phrases that only ever appear on an airdropped lure.
 *
 * Matched against name AND description. Deliberately narrow: this list decides
 * what gets moved out of a user's main gallery, and a false positive hides
 * something they bought. Every entry is a call to action, which is what
 * separates a scam airdrop from a legitimately odd collection name.
 */
const SPAM_PHRASES = [
  "claim your",
  "claim now",
  "claim reward",
  "free mint",
  "airdrop claim",
  "visit to claim",
  "voucher",
  "you have received",
  "reward pending",
  "verify your wallet",
  "connect wallet to",
];

/** A URL in the NAME is essentially never legitimate — the name is not a link field. */
const URL_IN_NAME = /(https?:\/\/|www\.|\.(com|xyz|io|net|org|app|finance|cash)\b)/i;

export interface SpamSignals {
  name: string | null;
  description: string | null;
  collectionName: string | null;
  /** The indexer's own verification badge, when it offers one. */
  collectionVerified: boolean;
  /** True when the indexer itself flagged it. */
  indexerFlagged?: boolean;
}

/**
 * Why this item looks like spam, or null.
 *
 * A REASON, not a boolean — the UI shows it, and "hidden because we said so" is
 * not something a user can evaluate. A verified collection is never flagged:
 * marketplace verification is a stronger signal than any phrase match, and
 * flagging a verified collection would be a visible, embarrassing error.
 */
export function detectSpam(signals: SpamSignals): string | null {
  if (signals.collectionVerified) return null;

  if (signals.indexerFlagged) return "Flagged as spam by the NFT index.";

  const name = (signals.name ?? "").toLowerCase();
  const description = (signals.description ?? "").toLowerCase();
  const collection = (signals.collectionName ?? "").toLowerCase();
  const haystack = `${name} ${description} ${collection}`;

  for (const phrase of SPAM_PHRASES) {
    if (haystack.includes(phrase)) return "This looks like an unsolicited airdrop asking you to claim something.";
  }

  if (signals.name && URL_IN_NAME.test(signals.name)) {
    return "The name contains a web address, which legitimate collections do not use.";
  }

  return null;
}

/**
 * Normalise one indexer row into an NftItem.
 *
 * Returns null for a row missing the fields that make an NFT addressable — a
 * contract and a token id. Those two are what a transfer needs, and an item
 * that cannot be transferred is an item that can only disappoint someone who
 * taps it.
 */
export function normalizeNftRow(
  row: Record<string, unknown>,
  chain: NftItem["chain"],
): NftItem | null {
  const contract = typeof row.contract === "string" ? row.contract.toLowerCase() : "";
  const tokenId = typeof row.tokenId === "string" ? row.tokenId : "";
  if (!/^0x[0-9a-f]{40}$/.test(contract) || tokenId === "") return null;

  // Anything that is not explicitly 1155 is treated as 721: it is by far the
  // more common standard, and detectStandard() re-checks on the chain before a
  // transfer is built.
  const standard = row.standard === "erc1155" ? "erc1155" : "erc721";

  const collectionRaw = (row.collection ?? {}) as Record<string, unknown>;
  const collectionName = sanitizeNftText(collectionRaw.name, 96);
  const collectionVerified = collectionRaw.verified === true;

  const name = sanitizeNftText(row.name, 128);
  const description = sanitizeNftText(row.description, 512);

  return {
    id: `${chain}:${contract}:${tokenId}`,
    chain,
    contract,
    tokenId,
    standard,
    balance: typeof row.balance === "string" && /^\d+$/.test(row.balance) ? row.balance : "1",
    name,
    description,
    media: resolveMedia({
      imageUrl: row.imageUrl,
      thumbnailUrl: row.thumbnailUrl,
      mimeType: row.mimeType,
    }),
    collection: {
      contract,
      name: collectionName,
      symbol: sanitizeNftText(collectionRaw.symbol, 32),
      imageUrl: resolveMediaUrl(collectionRaw.imageUrl),
      verified: collectionVerified,
    },
    spamReason: detectSpam({
      name,
      description,
      collectionName,
      collectionVerified,
      indexerFlagged: row.spam === true,
    }),
  };
}
