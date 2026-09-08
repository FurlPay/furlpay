import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { CATALOG, assetLogoPath } from "@/lib/markets/catalog";
import { getQuotes, resolveQuote } from "@/lib/markets/quotes";
import { getExtras, resolveExtras } from "@/lib/markets/extras";
import { MarketDataEngine } from "@/lib/marketdata/symbolState";
import { rank, type MoverBoard } from "@/lib/marketdata/movers";
import { credentialsFromEnv, detectEntitlement } from "@/lib/marketdata/providers/alpaca";
import { DEFAULT_ELIGIBILITY } from "@/lib/marketdata/types";

/** Public market data, identical for every reader — see the note in
 *  api/markets/table/route.ts. Matched to the 60s quote cache TTL. */
const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
} as const;


// GET /api/markets/movers?board=gainers|losers|most_active_dollar|biggest_change&limit=20
//
// Rankings through the market-data engine rather than an ad-hoc sort.
//
// WHAT CHANGED. This route used to sort the catalog by `changePct` and slice
// the ends. That has no eligibility gate, no freshness check and no tie-break,
// which means a stale quote could sit at the top of Top Gainers indefinitely,
// two symbols at the same percent could swap places between requests, and a
// $0.02 stock ticking to $0.03 outranked the entire market at +50%.
//
// It now hydrates the engine from the same cached quotes the rest of Markets
// uses and asks the ranking engine, which applies eligibility, freshness,
// liquidity floors and a deterministic total order.
//
// THE VOLUME BOARD IS ABSENT ON PURPOSE. `most_active_volume` is a valid board
// the engine can produce, but only from consolidated volume. This deployment's
// entitlement is IEX — measured at 1.97%-3.50% of consolidated, varying by
// symbol, so it cannot even be scaled. Asking for it returns an explanation
// rather than a plausible wrong list. `most_active_dollar` is offered instead:
// dollar volume from a single venue is still only that venue's, but it is
// labelled as such and is not presented as market-wide activity.
//
// NOT STREAMING. Serving this from a serverless function means snapshot data
// on the quote cache's 60s TTL. The engine is written for a stream and a
// long-lived worker can feed it; a request handler cannot hold a socket open.
// See docs/REALTIME-MARKET-DATA.md.

const BOARDS: MoverBoard[] = [
  "gainers",
  "losers",
  "most_active_volume",
  "most_active_dollar",
  "biggest_change",
];

/** Cached per instance: the entitlement is a property of the credentials, not
 *  of the request, and probing it costs two API calls. */
let entitlementCache: { at: number; consolidated: boolean; feed: string; detail: string } | null = null;
const ENTITLEMENT_TTL_MS = 15 * 60_000;

async function entitlement() {
  if (entitlementCache && Date.now() - entitlementCache.at < ENTITLEMENT_TTL_MS) {
    return entitlementCache;
  }
  const creds = credentialsFromEnv();
  const detected = creds ? await detectEntitlement(creds).catch(() => null) : null;
  entitlementCache = {
    at: Date.now(),
    consolidated: detected?.consolidated ?? false,
    feed: detected?.feed ?? "yahoo",
    detail:
      detected?.detail ??
      "No Alpaca entitlement detected; prices come from the keyless delayed fallback.",
  };
  return entitlementCache;
}

export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "markets.movers", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const p = req.nextUrl.searchParams;
  const boardParam = p.get("board") ?? p.get("type") ?? "gainers";
  const board = (BOARDS as string[]).includes(boardParam) ? (boardParam as MoverBoard) : "gainers";
  const limit = Math.min(100, Math.max(1, Number(p.get("limit")) || 20));

  const [quotes, extras, ent] = await Promise.all([
    getQuotes(),
    getExtras().catch(() => new Map()),
    entitlement(),
  ]);

  // Hydrate the engine from the cached snapshot. `asOf` is the cache's own
  // timestamp: these are snapshots, and pretending each carries a distinct
  // venue timestamp would fabricate a freshness signal we do not have.
  const asOf = Date.now();
  const engine = new MarketDataEngine();

  for (const asset of CATALOG) {
    const quote = resolveQuote(quotes, asset);
    if (!quote || !(quote.price > 0)) continue;
    const extra = resolveExtras(extras, asset);

    // Reconstruct the previous close from price and percent change — the only
    // route to it from this cache. Skipped when the change is unknown, which
    // correctly leaves the symbol ineligible rather than inventing a base.
    const changePct = quote.changePct;
    const previousClose =
      Number.isFinite(changePct) && changePct !== -100
        ? quote.price / (1 + changePct / 100)
        : null;

    engine.hydrate(asset.symbol, {
      previousClose,
      lastPrice: quote.price,
      volume: extra.volume24h ?? 0,
      dollarVolume: (extra.volume24h ?? 0) * quote.price,
      status: "regular",
      // Only a live quote gets a timestamp. A seed-price fallback has no
      // freshness to claim, so it stays `unknown` and is excluded.
      exchangeTimestamp: quote.live ? asOf : null,
      source: ent.consolidated ? "sip" : quote.live ? "iex" : "seed",
    });
  }

  const result = rank(engine.all(), board, {
    limit,
    now: asOf,
    volumeIsConsolidated: ent.consolidated,
    policy: DEFAULT_ELIGIBILITY,
  });

  const logos = new Map(CATALOG.map((a) => [a.symbol, assetLogoPath(a)]));
  const names = new Map(CATALOG.map((a) => [a.symbol, a.name]));
  const kinds = new Map(CATALOG.map((a) => [a.symbol, a.kind]));

  // ---- Backward compatibility -----------------------------------------
  //
  // /investing and the terminal rail already consume `{ gainers, losers }`
  // from this route. Changing the shape underneath them would break two live
  // screens for a refactor they did not ask for, so both keys are still
  // served — now built by the SAME ranking engine as `rows`, which means they
  // silently gained eligibility, freshness and deterministic tie-breaks.
  const legacy = (b: MoverBoard) =>
    rank(engine.all(), b, { limit, now: asOf, volumeIsConsolidated: ent.consolidated }).rows.map(
      (r) => ({
        symbol: r.symbol,
        name: names.get(r.symbol) ?? r.symbol,
        kind: kinds.get(r.symbol) ?? "stock",
        logo: logos.get(r.symbol) ?? null,
        price: r.price,
        changePct: r.changePercent,
        live: r.freshness === "live",
      })
    );

  return NextResponse.json({
    // Legacy keys, unchanged in shape. See the note above.
    gainers: legacy("gainers"),
    losers: legacy("losers"),

    board: result.board,
    rows: result.rows.map((r) => ({
      ...r,
      name: names.get(r.symbol) ?? r.symbol,
      logo: logos.get(r.symbol) ?? null,
    })),
    /** Populated when the board cannot honestly be produced — currently the
     *  volume board on a single-venue entitlement. */
    unavailable: result.unavailable,
    /** Why symbols did not rank, by reason. An empty board is explainable. */
    excluded: result.excluded,
    universe: result.universe,
    eligible: result.eligible,
    /** What the numbers came from, so a client can label them honestly. */
    provenance: {
      feed: ent.feed,
      consolidated: ent.consolidated,
      detail: ent.detail,
      /** Snapshot, not stream. Stated so nothing downstream calls it live. */
      transport: "snapshot",
      boards: BOARDS,
    },
    asOf: new Date(asOf).toISOString(),
  }, { headers: CACHE_HEADERS });
}
