// ---------------------------------------------------------------------------
// Adapting /api/markets/search hits into table rows.
//
// The markets table loads a curated catalog of a few hundred assets. The search
// box above it spans the full tradable universe plus the non-security
// instruments, so most of what it can find has no row in that catalog. This
// module is the seam between the two shapes.
//
// Its whole job is to keep absent data absent. The search route prices only the
// curated batch and returns no seven-day change, market cap, volume or price
// history at all, so almost every field here is null — and null must survive
// the trip. Every client that let a null become a 0 reproduced the same bug:
// `null >= 0` is true in JavaScript, so unpriced rows rendered green with a
// fabricated "+0.00%". An em-dash says "we do not have this number"; a zero
// says "this is worth nothing".
// ---------------------------------------------------------------------------

import type { TableRow, AssetKindFilter } from "./table";

/** The shape /api/markets/search returns. Securities and non-security
 *  instruments arrive in two lists because they have different identity
 *  models — an FX pair has no CUSIP, no issuer and no market cap. */
export interface RemoteSearchResponse {
  items: {
    symbol: string;
    name: string;
    kind: AssetKindFilter;
    sector: string | null;
    logo: string | null;
    price: number | null;
    changePct: number | null;
    live: boolean;
  }[];
  instruments?: {
    symbol: string;
    displayName: string;
    assetClassLabel: string;
    logo: string | null;
  }[];
}

/**
 * Adapt search hits to table rows.
 *
 * Everything the search cannot answer stays null rather than becoming a zero.
 * The route prices only the curated batch, so an uncurated symbol has no quote;
 * seven-day change, market cap, volume and the sparkline are not in the search
 * response at all. AssetTable renders each of those as an em-dash, which says
 * "we do not have this number" — a 0 would say "this is worth nothing".
 *
 * `rank` is a large finite sentinel because rank IS the curated catalog
 * position, and these rows have none. Under the default popularity sort they
 * land after every curated row, which is the truthful ordering: we are not
 * claiming an uncurated micro-cap is more popular than Apple, only that it
 * exists and you can open it. Finite, not Infinity: the comparator subtracts
 * two ranks, and `Infinity - Infinity` is NaN, which is not a sort result.
 */
const UNCURATED_RANK = Number.MAX_SAFE_INTEGER;

export function remoteSearchRows(d: RemoteSearchResponse): TableRow[] {
  const instruments: TableRow[] = (d.instruments ?? []).map((i) => ({
    symbol: i.symbol,
    name: i.displayName,
    kind: "instrument" as AssetKindFilter,
    category: i.assetClassLabel,
    logo: i.logo,
    price: null,
    changePct: null,
    changePct7d: null,
    marketCap: null,
    volume24h: null,
    spark: null,
    live: false,
    rank: UNCURATED_RANK,
  }));
  const securities: TableRow[] = d.items.map((i) => ({
    symbol: i.symbol,
    name: i.name,
    kind: i.kind,
    category: i.sector,
    logo: i.logo,
    price: i.price,
    changePct: i.changePct,
    changePct7d: null,
    marketCap: null,
    volume24h: null,
    spark: null,
    live: i.live,
    rank: UNCURATED_RANK,
  }));
  return [...instruments, ...securities];
}

