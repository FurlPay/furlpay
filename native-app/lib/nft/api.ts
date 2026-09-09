import { api, ApiError, NetworkError } from "@/lib/api";
import { track } from "@/lib/analytics";
import type { ChainId } from "@/lib/swap/assets";
import { normalizeNftRow } from "./metadata";
import type { NftIndexerStatus, NftPage } from "./types";

// ---------------------------------------------------------------------------
// The NFT client.
//
// NORMALISATION HAPPENS HERE, ON THE CLIENT, not on the server. The server
// passes provider rows through nearly untouched; sanitising, media resolution
// and spam detection all run in native-app/lib/nft/metadata.ts. That looks
// backwards until you notice what it buys: the rules that decide what an
// attacker-controlled name is allowed to render as live next to the component
// that renders it, they are unit-tested without a server, and swapping indexers
// cannot change them.
//
// THE THREE UNAVAILABLE STATES ARE KEPT APART all the way to the screen:
// "no indexer configured" (a deployment decision — retrying is pointless),
// "the indexer failed" (retry helps), and "you own nothing" (a real, empty
// answer). Collapsing any two produces a gallery that lies about one of them.
// ---------------------------------------------------------------------------

interface NftResponse {
  status?: string;
  provider?: string;
  reason?: string;
  message?: string;
  items?: Array<Record<string, unknown>>;
  cursor?: string | null;
}

export async function fetchOwnedNfts(input: {
  chain: ChainId;
  owner: string;
  cursor?: string;
}): Promise<NftPage> {
  const params = new URLSearchParams({ chain: input.chain, owner: input.owner });
  if (input.cursor) params.set("cursor", input.cursor);

  let res: NftResponse;
  try {
    res = await api<NftResponse>(`/nft?${params.toString()}`);
  } catch (e) {
    if (e instanceof ApiError) {
      // 501 is the server saying no indexer is configured. It is NOT an error
      // the user can act on and must not be rendered as one — the screen
      // explains that indexing is unavailable in this deployment.
      const status: NftIndexerStatus =
        e.status === 501
          ? { kind: "unconfigured" }
          : { kind: "error", message: e.message };
      return { items: [], cursor: null, status };
    }
    if (e instanceof NetworkError) {
      return { items: [], cursor: null, status: { kind: "error", message: "You are offline." } };
    }
    throw e;
  }

  if (res.status !== "ok") {
    return {
      items: [],
      cursor: null,
      status:
        res.reason === "unconfigured" || res.reason === "no_adapter"
          ? { kind: "unconfigured" }
          : { kind: "error", message: res.message ?? "The NFT index could not be reached." },
    };
  }

  // Rows that cannot be normalised are DROPPED, not rendered as blanks. An item
  // with no contract or token id cannot be opened or transferred; showing it
  // produces a tile whose only behaviour is to disappoint.
  const items = (res.items ?? [])
    .map((row) => normalizeNftRow(row, input.chain))
    .filter((item): item is NonNullable<typeof item> => item !== null);

  track("nft_gallery_viewed", { chain: input.chain, count: items.length });

  return {
    items,
    cursor: typeof res.cursor === "string" && res.cursor.length > 0 ? res.cursor : null,
    status: { kind: "ok", provider: res.provider ?? "indexer" },
  };
}
