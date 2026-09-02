import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { CATALOG, assetLogoPath } from "@/lib/markets/catalog";
import { collectionBySlug } from "@/lib/markets/collections";
import { instrumentRows } from "@/lib/markets/instrumentRows";
import { getQuotes, resolveQuote } from "@/lib/markets/quotes";
import { getExtras, resolveExtras } from "@/lib/markets/extras";
import {
  applyFilters,
  defaultDirFor,
  isCapBand,
  isSortKey,
  paginate,
  sortRows,
  type AssetKindFilter,
  type CapBand,
  type SortDir,
  type TableRow,
} from "@/lib/markets/table";

// GET /api/markets/table — the paginated asset table behind /markets.
//
// Everything the table can do, it does HERE rather than in the browser. The
// curated catalog is ~390 rows today and the tradable universe is ~13,000; a
// client that filters and sorts in memory has to hold all of them, which is a
// multi-megabyte payload to render twenty-five lines. Filtering, sorting and
// slicing on the server means the wire carries one page.
//
// Query parameters:
//   kind=stock,etf,crypto      collection=<slug>       watch=SYM,SYM,...
//   q=<substring>              performance=gainers|losers
//   cap=large,mid,small        priceMin/priceMax       volumeMin/volumeMax
//   sort=popularity|price|change|change7d|marketCap|volume|name   dir=asc|desc
//   page=1                     pageSize=25
//
// Market cap and volume come from lib/markets/extras.ts. An ETF has no market
// cap to report and an unpriced asset has no volume — both arrive null and the
// client renders an em-dash. No field on this route is ever defaulted to zero.

const MAX_PAGE_SIZE = 100;
const KINDS: AssetKindFilter[] = ["stock", "etf", "crypto", "instrument"];

function csv(v: string | null): string[] {
  return (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function num(v: string | null): number | null {
  if (v == null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "markets.table", { limit: 90, windowMs: 60_000 });
  if (limited) return limited;

  const p = req.nextUrl.searchParams;

  // Quotes are required; extras are not. A CoinGecko rate-limit or a Yahoo
  // outage must cost the table its cap/volume columns, not the whole page.
  //
  // Instruments are on the same footing as extras: a Yahoo outage costs the
  // table its commodity and FX rows, not the equities beside them.
  const [quotes, extras, instruments] = await Promise.all([
    getQuotes(),
    getExtras().catch(() => new Map()),
    instrumentRows(CATALOG.length).catch(() => [] as TableRow[]),
  ]);

  const collection = p.get("collection") ? collectionBySlug(p.get("collection") as string) : null;

  const catalogRows: TableRow[] = CATALOG.map((a, i) => {
    const quote = resolveQuote(quotes, a);
    const extra = resolveExtras(extras, a);
    return {
      symbol: a.symbol,
      name: a.name,
      kind: a.kind,
      category: a.sector ?? a.industry ?? null,
      logo: assetLogoPath(a),
      // Catalog order is the curated one — the ranking an editor gave it — so
      // it doubles as the popularity axis without inventing a score.
      rank: i,
      price: quote?.price ?? null,
      changePct: quote?.changePct ?? null,
      changePct7d: extra.changePct7d,
      marketCap: extra.marketCap,
      volume24h: extra.volume24h,
      spark: extra.spark,
      live: quote?.live ?? false,
    };
  });

  const rows: TableRow[] = [...catalogRows, ...instruments];

  const kinds = csv(p.get("kind")).filter((k): k is AssetKindFilter =>
    (KINDS as string[]).includes(k)
  );
  const capBands = csv(p.get("cap")).filter((c): c is CapBand => isCapBand(c));
  const perf = p.get("performance");

  // A collection and an explicit watchlist both narrow to a symbol set; when
  // both are present the intersection is what the reader asked for.
  const collectionSymbols = collection?.symbols ?? null;
  const watchSymbols = p.get("watch") ? csv(p.get("watch")).map((s) => s.toUpperCase()) : null;
  const symbols =
    collectionSymbols && watchSymbols
      ? collectionSymbols.filter((s) => watchSymbols.includes(s.toUpperCase()))
      : (collectionSymbols ?? watchSymbols);

  const filtered = applyFilters(rows, {
    kinds,
    capBands,
    performance: perf === "gainers" || perf === "losers" ? perf : null,
    priceMin: num(p.get("priceMin")),
    priceMax: num(p.get("priceMax")),
    volumeMin: num(p.get("volumeMin")),
    volumeMax: num(p.get("volumeMax")),
    query: p.get("q"),
    symbols,
  });

  const sortParam = p.get("sort");
  const sort = isSortKey(sortParam) ? sortParam : "popularity";
  const dirParam = p.get("dir");
  const dir: SortDir = dirParam === "asc" || dirParam === "desc" ? dirParam : defaultDirFor(sort);

  const sorted = sortRows(filtered, sort, dir);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(p.get("pageSize")) || 25));
  const page = paginate(sorted, Number(p.get("page")) || 1, pageSize);

  return NextResponse.json({
    ...page,
    sort,
    dir,
    /** How many rows exist before any filter — what "12,970 assets" counts. */
    catalogTotal: rows.length,
    /** Whether the cap/volume columns had a source this request. Lets the
     *  client label the column honestly instead of showing silent em-dashes. */
    extrasAvailable: extras.size > 0,
    collection: collection
      ? { slug: collection.slug, title: collection.title, blurb: collection.blurb }
      : null,
    asOf: new Date().toISOString(),
  });
}
