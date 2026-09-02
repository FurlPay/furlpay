import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { searchUniverse, universeStats, type MergedAsset } from "@/lib/markets/universe";
import { getQuotes, resolveQuote } from "@/lib/markets/quotes";
import { searchSymbols } from "@/lib/markets/providers/yahoo";
import { searchInstruments, assetClassLabel } from "@/lib/markets/instruments";

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

  // Widen to Yahoo when the local snapshot has little or nothing to offer.
  //
  // `universe.json` is a broker sync dated 2026-07-18, refreshed by a script
  // that needs credentials which currently 401 — so it cannot see anything
  // listed since. A user searching a company that IPO'd last month gets no
  // result and no explanation, which reads as "this app does not have it"
  // rather than "this list is old".
  //
  // Only on a thin local result, and never for crypto, which lives entirely in
  // the catalog and is already complete. The local rows stay first: they are
  // exact and carry curation, while these are a fuzzy name match.
  const seen = new Set(matches.map((m) => m.symbol.toUpperCase()));
  if (q && kind !== "crypto" && matches.length < Math.min(limit, 5)) {
    const online = await searchSymbols(q, limit - matches.length).catch(() => null);
    for (const hit of online ?? []) {
      if (seen.has(hit.symbol)) continue;
      if (kind && hit.kind !== kind) continue;
      // `fractionable` is a broker property. Nothing online knows it, so a
      // fractionable-only filter cannot honestly include these.
      if (fractionableOnly) continue;
      seen.add(hit.symbol);
      matches.push({
        symbol: hit.symbol,
        name: hit.name,
        kind: hit.kind,
        sector: null,
        industry: null,
        cap: "small",
        chain: null,
        logo: "",
        exchange: hit.exchange,
        fractionable: false,
        curated: false,
        currency: "USD",
      });
      if (matches.length >= limit) break;
    }
  }

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

  // Market instruments that are not securities: gold, FX pairs, indices, the
  // ten-year. They have no CUSIP and no issuer, so they are not in the
  // universe and cannot be found by the search above — a reader typing
  // "XAUUSD" or "gold" would otherwise get nothing.
  //
  // Returned in their own list rather than mixed into `items`. The two have
  // different identity models and different fields, and flattening them would
  // invite a caller to treat an FX pair as a tradable catalog asset.
  const instruments = searchInstruments(q, 8).map((i) => ({
    symbol: i.symbol,
    displayName: i.displayName,
    assetClass: i.assetClass,
    assetClassLabel: assetClassLabel(i.assetClass),
    currency: i.currency,
    /** Null, not a placeholder image, when there is no honest artwork. */
    logo: i.logo ?? null,
    exchange: i.exchange ?? null,
    supports: {
      price: i.priceSupported,
      volume: i.volumeSupported,
      marketCap: i.marketCapSupported,
    },
    providerNote: i.providerNote ?? null,
    /** Quotes come from /api/markets/instruments/[symbol]; search does not
     *  price them, for the same reason it does not price uncurated symbols. */
    href: `/api/markets/instruments/${i.symbol}`,
  }));

  return NextResponse.json({
    query: q,
    count: items.length,
    items,
    instruments,
    universe: universeStats(),
  });
}
