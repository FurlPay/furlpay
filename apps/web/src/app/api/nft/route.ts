import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { fetchOwnedNfts, indexerStatus } from "@/lib/nft/indexer";

export const dynamic = "force-dynamic";

// GET /api/nft?chain=…&owner=0x…&cursor=…
//
// The NFTs an address holds, from a configured indexer.
//
// AUTHENTICATED even though holdings are public on-chain data. Two reasons:
// each call bills at a vendor once one is configured, and an open endpoint
// would be a free NFT-portfolio lookup for arbitrary addresses attached to
// FurlPay's rate limit and FurlPay's key.
//
// `owner` IS NOT TAKEN FROM THE SESSION. A user may legitimately look at an
// address they control but have not linked (a hardware wallet, a second
// account), and the response contains nothing private — it is public chain
// data either way. It is validated as an address so it cannot become a
// path-traversal or injection vector into a provider URL.

const CHAINS = new Set(["ethereum", "polygon", "base", "arbitrum"]);
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** One screen of tiles. Larger pages cost more at the vendor for art nobody scrolled to. */
const PAGE_SIZE = 50;

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  // Tighter than the middleware baseline: a gallery scrolling through pages is
  // a per-page vendor charge, and a stuck client must exhaust its own budget
  // rather than the RPC/indexer quota the signer flow depends on.
  const limited = await rateLimitOr429(req, "nft.owned", { limit: 60, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;

  const params = req.nextUrl.searchParams;
  const chain = (params.get("chain") ?? "").trim();
  const owner = (params.get("owner") ?? "").trim();
  const cursor = params.get("cursor")?.slice(0, 512) ?? undefined;

  if (!CHAINS.has(chain)) {
    return NextResponse.json({ error: "unsupported_chain" }, { status: 400 });
  }
  if (!ADDRESS_RE.test(owner)) {
    return NextResponse.json({ error: "invalid_owner" }, { status: 400 });
  }

  const outcome = await fetchOwnedNfts({ chain, owner, cursor, limit: PAGE_SIZE });

  if (!outcome.ok) {
    // 501 for a deployment that has not chosen an indexer, 502 for one that has
    // and could not reach it. The client renders those differently: the first
    // says "NFT indexing is not set up", the second offers a retry. An empty
    // 200 for either would read as "you own no NFTs", which is a claim this
    // server is in no position to make.
    const status = outcome.reason === "provider_error" ? 502 : 501;
    return NextResponse.json(
      { status: "unavailable", reason: outcome.reason, message: outcome.message, items: [], cursor: null },
      { status },
    );
  }

  return NextResponse.json({
    status: "ok",
    provider: outcome.provider,
    chain,
    items: outcome.page.rows,
    cursor: outcome.page.cursor,
  });
}

// HEAD /api/nft — is indexing available at all?
//
// Lets the app decide whether to show the NFT tab before spending a paged
// request on it. Deliberately body-less and cheap.
export async function HEAD(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return new NextResponse(null, { status: 401 });

  const status = indexerStatus();
  return new NextResponse(null, {
    status: status.configured ? 204 : 501,
    headers: { "X-Nft-Indexer": status.configured ? status.provider : "none" },
  });
}
