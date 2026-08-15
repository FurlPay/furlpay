import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { searchUniverse, universeStats, type MergedAsset } from "@/lib/markets/universe";
import { getQuotes, resolveQuote } from "@/lib/markets/quotes";

// GET /api/markets/search?q=hynix&kind=stock|etf|crypto&limit=25&fractionable=1
//
// Searches the FULL tradable universe (~13k US-listed assets synced from the
// broker) rather than the 391-symbol curated catalog. This is what makes an
// asset findable across the web app, extension, Android app and watch at once.
//
// Quotes are attached ON DEMAND for the returned page only. getQuotes() prices
// the curated set in one cached batch; pricing 13k symbols on every keystroke
// would be thousands of provider calls per search, so an uncurated asset
// returns price: null and the client renders "—" rather than a fabricated 0.
// A zero price on a money surface reads as "this is worthless", which is worse
// than an honest blank.
const MAX_LIMIT = 50;

/**
 * Explicit quote state, so clients never infer meaning from a null.
 *
 * Every client that consumed nullable prices reproduced the SAME bug
 * independently: `null >= 0` is true in JS, so unpriced rows rendered green
 * with a fabricated "+0.00%". Kotlin fails the other way — a non-null `Double`
 * throws on a JSON null and takes the whole response down. A named state means
 * each client switches on an enum instead of re-deriving semantics from the
 * absence of a value.
 *
 *   live        — a provider priced it inside the current cache window
 *   delayed     — we have a price, but it is a stale/seed fallback
 *   unavailable — no quote at all (uncurated asset, not fetched per keystroke)
 */
export type QuoteStatus = "live" | "delayed" | "unavailable";

export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "markets.search", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const p = req.nextUrl.searchParams;
  const q = (p.get("q") ?? "").slice(0, 64);
  const kindParam = p.get("kind");
  const kind = kindParam === "stock" || kindParam === "etf" || kindParam === "crypto" ? kindParam : undefined;
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(p.get("limit")) || 25));
  const fractionableOnly = p.get("fractionable") === "1";

  const matches = searchUniverse(q, { kind, limit, fractionableOnly });

  // One cached batch; misses simply carry no price.
  const quotes = await getQuotes().catch(() => null);

  const items = matches.map((a: MergedAsset) => {
    const quote = quotes ? resolveQuote(quotes, a) : undefined;
    const quoteStatus: QuoteStatus = !quote ? "unavailable" : quote.live ? "live" : "delayed";
    return {
      quoteStatus,
      symbol: a.symbol,
      name: a.name,
      kind: a.kind,
      sector: a.sector,
      industry: a.industry,
      exchange: a.exchange,
      logo: a.logo || null,
      fractionable: a.fractionable,
      curated: a.curated,
      currency: a.currency,
      // null (not 0) when unpriced — the client must render "—".
      price: quote?.price ?? null,
      changePct: quote?.changePct ?? null,
      live: quote?.live ?? false,
    };
  });

  return NextResponse.json({
    query: q,
    count: items.length,
    items,
    universe: universeStats(),
  });
}
