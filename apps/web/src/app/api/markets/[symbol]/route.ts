import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { CATALOG, bySymbol, assetLogoPath, type MarketAsset } from "@/lib/markets/catalog";
import { resolveAsset } from "@/lib/markets/resolve";
import { getQuotes, resolveQuote } from "@/lib/markets/quotes";
import { digestFor } from "@/lib/markets/stats";
import { realStatsFor } from "@/lib/markets/providers";
import { insightsByTicker } from "@/lib/insights/articles";
import { optionalUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";

// GET /api/markets/[symbol] — full asset detail: quote, key stats, AI digest,
// current position, related assets and research insights mentioning it.
//
// Statistics come from `realStatsFor`: live price and 52-week range from the
// Yahoo chart endpoint, fundamentals from the company's own SEC XBRL filings.
// They previously came from `keyStatsFor`, which derived every figure from a
// hash of the ticker string — a P/E that was a function of the letters in the
// symbol. Anything the providers do not supply is now null and renders as an
// em-dash; nothing on this route invents a number.
export async function GET(req: NextRequest, props: { params: Promise<{ symbol: string }> }) {
  const params = await props.params;
  // Anonymous callers are served, so the middleware baseline (mutating methods
  // only) does not cover this. The upstreams here are free but shared and
  // rate-limited by IP, so an unbounded reader would spend the whole site's
  // budget with SEC and Yahoo, not just its own.
  const limited = await rateLimitOr429(req, "markets.symbol", { limit: 120, windowMs: 60_000 });
  if (limited) return limited;

  const sym = params.symbol.toUpperCase();
  // Resolved against the whole tradable universe, not just the curated 391.
  // Search already ranks over all 12,970 symbols, so gating this route on the
  // catalog made 12,655 linkable results dead-end on "Asset not found" —
  // Agilent, Alcoa and Albemarle among them. Curation adds a logo and a
  // sector; it was never what made the page possible.
  // Catalog, then the synced universe, then Yahoo. The third tier matters
  // because the second is a snapshot dated 2026-07-18 and the script that
  // refreshes it needs broker credentials that currently 401 — so every listing
  // since then (IPOs, ticker changes, new ETFs) is invisible locally.
  const asset = await resolveAsset(sym);
  if (!asset) return NextResponse.json({ error: "Unknown symbol" }, { status: 404 });

  // Crypto goes through the same path, quoted as a pair (BTC-USD): it has no
  // filings and no SPY beta, but it does have a real 52-week range, which it
  // otherwise would not have at all.
  const [quotes, real] = await Promise.all([
    getQuotes(),
    realStatsFor(sym, asset.kind, bySymbol.get(sym)?.cg ?? null).catch(() => null),
  ]);

  // Prefer the consolidated Yahoo print for securities; it carries an exchange
  // timestamp, which is what lets the UI claim a price is live rather than
  // merely recent. Fall back to the catalog quote (and its seed price) so a
  // provider outage degrades the number instead of emptying the page.
  // The catalog quote map is keyed by curated asset; an uncurated symbol has no
  // entry and relies on the live provider above.
  const curated = bySymbol.get(sym);
  const fallbackQuote = curated ? resolveQuote(quotes, curated) : null;
  // A price is LIVE only if its exchange timestamp is recent. EA kept printing
  // its 2026-08-04 last trade as `live: true` for two months after it was
  // delisted, because this checked only that a price existed. Seven days
  // clears any weekend-plus-holiday closure; a print older than that is a
  // halted, suspended or delisted security, shown with its date, not as live.
  const STALE_AFTER_SECONDS = 7 * 86_400;
  const staleAsOf =
    real?.marketTime != null && Date.now() / 1000 - real.marketTime > STALE_AFTER_SECONDS
      ? new Date(real.marketTime * 1000).toISOString()
      : null;
  const quote: { price: number | null; changePct: number | null; live: boolean; staleAsOf?: string } =
    staleAsOf
      ? { price: real!.price, changePct: null, live: false, staleAsOf }
      : real?.price != null
      ? // A change needs a previous close. Coalescing a missing one to 0 does
        // not degrade the claim, it replaces it with a different and wrong one:
        // "unchanged today" is a statement about the session, and it is the
        // reading a flat 0.00% produces.
        { price: real.price, changePct: real.changePct, live: true }
      : fallbackQuote
        ? { price: fallbackQuote.price, changePct: fallbackQuote.changePct, live: false }
        : // Nothing quoted this symbol. A zero price is not a degraded price —
          // it renders as $0.00 and is the number the trade sheet would size an
          // order against.
          { price: null, changePct: null, live: false };

  const stats = {
    marketCap: real?.marketCap ?? null,
    enterpriseValue: real?.enterpriseValue ?? null,
    sharesOutstanding: real?.sharesOutstanding ?? null,
    peRatio: real?.peRatio ?? null,
    priceToSales: real?.priceToSales ?? null,
    priceToBook: real?.priceToBook ?? null,
    eps: real?.epsTtm ?? null,
    revenueTtm: real?.revenueTtm ?? null,
    netIncomeTtm: real?.netIncomeTtm ?? null,
    grossMarginPct: real?.grossMarginPct ?? null,
    operatingMarginPct: real?.operatingMarginPct ?? null,
    profitMarginPct: real?.profitMarginPct ?? null,
    roePct: real?.roePct ?? null,
    roaPct: real?.roaPct ?? null,
    currentRatio: real?.currentRatio ?? null,
    debtToEquity: real?.debtToEquity ?? null,
    cash: real?.cash ?? null,
    dividendYieldPct: real?.dividendYieldPct ?? null,
    dividendPerShareTtm: real?.dividendPerShareTtm ?? null,
    payoutRatioPct: real?.payoutRatioPct ?? null,
    beta: real?.beta ?? null,
    high52w: real?.high52w ?? null,
    low52w: real?.low52w ?? null,
    dayHigh: real?.dayHigh ?? null,
    dayLow: real?.dayLow ?? null,
    previousClose: real?.previousClose ?? null,
    volume: real?.volume ?? null,
    avgVolume: real?.avgVolume ?? null,
    marketTime: real?.marketTime ?? null,
    exchange: real?.exchange ?? null,
    currency: real?.currency ?? null,
    // Crypto supply. Null for equities, which report a share count instead.
    circulatingSupply: real?.circulatingSupply ?? null,
    totalSupply: real?.totalSupply ?? null,
    maxSupply: real?.maxSupply ?? null,
    fullyDilutedValuation: real?.fullyDilutedValuation ?? null,
    athPrice: real?.athPrice ?? null,
    athDate: real?.athDate ?? null,
    atlPrice: real?.atlPrice ?? null,
    atlDate: real?.atlDate ?? null,
    marketCapRank: real?.marketCapRank ?? null,
  };

  // Related assets need a sector or industry to be related *by*. An uncurated
  // symbol has neither, and the original comparison was an equality test — so
  // `null === null` held and every uncurated stock was "related" to every other
  // asset with a missing sector. No key, no list.
  const relatedKey = asset.kind === "stock" ? asset.sector : asset.industry;
  const related = (relatedKey === null ? [] : CATALOG).filter(
    (a) =>
      a.symbol !== sym &&
      a.kind === asset.kind &&
      (asset.kind === "stock" ? a.sector : a.industry) === relatedKey
  )
    .slice(0, 6)
    .map((a) => {
      const q = resolveQuote(quotes, a);
      return {
        symbol: a.symbol,
        name: a.name,
        kind: a.kind,
        logo: assetLogoPath(a),
        // Related rows are curated, but a quote can still be missing. A zero
        // renders as "$0.00" in the row, which reads as a real, collapsed price.
        price: q?.price ?? null,
        changePct: q?.changePct ?? null,
      };
    });

  // Market data is public; the position line reflects the caller ONLY when a
  // valid session is present — never the demo account for anonymous callers.
  // optionalUser rather than a bare verifySession so a revoked, deleted or
  // locked session cannot read a holding back out of the account it no longer
  // has access to.
  const auth = await optionalUser(req);
  if (auth.kind === "rejected") return auth.res;
  const account = auth.kind === "user" ? auth.account : undefined;
  const holding = account?.holdings.find((h) => h.symbol === sym);

  const insights = insightsByTicker(sym).slice(0, 4).map((i) => ({
    slug: i.slug,
    title: i.title,
    category: i.category,
    date: i.date,
    readMins: i.readMins,
    signal: i.signal ?? null,
  }));

  // The digest narrates the 52-week position and the multiple. Both have to be
  // real for the sentence to be true, so it is omitted rather than padded when
  // the range is unknown.
  // `digestFor` reads a catalog MarketAsset, whose optional fields are
  // `undefined` where the merged universe shape uses `null`. Converted
  // explicitly rather than cast: the two nullish spellings are load-bearing in
  // the catalog's own types, and a cast would let a future field through
  // unconverted.
  const digestAsset: MarketAsset = {
    symbol: asset.symbol,
    name: asset.name,
    kind: asset.kind,
    sector: (asset.sector as MarketAsset["sector"]) ?? undefined,
    industry: asset.industry ?? undefined,
    // `merge()` fills "small" for anything uncurated, which is a guess about a
    // company's size rather than a fact about it. Passed through only when a
    // human actually wrote it down.
    cap: asset.curated ? (asset.cap as MarketAsset["cap"]) : undefined,
    chain: asset.chain ?? undefined,
  };

  // The digest narrates a move, a position in the 52-week range and a
  // multiple. Every one of those is a number, so it is written only when they
  // are all real — a summary assembled around missing inputs still reads as a
  // confident paragraph.
  const digest =
    stats.high52w != null && stats.low52w != null && quote.price != null && quote.changePct != null
      ? digestFor(
          digestAsset,
          {
            price: quote.price,
            changePct: quote.changePct,
            live: quote.live,
            ...(quote.staleAsOf ? { staleAsOf: quote.staleAsOf } : {}),
          },
          {
          marketCap: stats.marketCap ?? 0,
          peRatio: stats.peRatio,
          eps: stats.eps,
          dividendYieldPct: stats.dividendYieldPct,
          beta: stats.beta,
          high52w: stats.high52w,
          low52w: stats.low52w,
          volume: stats.volume ?? 0,
          avgVolume: stats.avgVolume ?? 0,
          circulatingSupply: null,
          athPrice: null,
        })
      : null;

  return NextResponse.json({
    asset: {
      symbol: asset.symbol,
      name: asset.name,
      kind: asset.kind,
      sector: asset.sector ?? null,
      industry: asset.industry ?? null,
      cap: asset.cap ?? "large",
      chain: asset.chain ?? null,
      logo: asset.logo || null,
      /** False for the ~12,655 symbols with no hand-written metadata: the page
       * renders, but without a logo, sector or related list. */
      curated: asset.curated,
      exchange: asset.exchange,
    },
    quote,
    stats,
    // Which upstream produced which half, the fiscal period the filed figures
    // cover, and whether they are a true TTM or a fiscal year. The UI shows
    // this: a number a reader cannot attribute is a number they cannot check.
    provenance: real?.provenance ?? {
      price: null,
      fundamentals: null,
      crypto: null,
      fiscalAsOf: null,
      incomeBasis: null,
      cik: null,
    },
    digest,
    // Whether this request carried a valid session — not who it belongs to.
    // The page needs it to decide between a trade sheet and a sign-in prompt,
    // and `position` cannot answer that: it is null both for an anonymous
    // reader and for a signed-in user who does not hold the symbol.
    authenticated: auth.kind === "user",
    position: holding
      ? {
          shares: holding.shares,
          // Unpriced holdings have no market value. Reporting 0 would show a
          // real position as worthless.
          marketValue: quote.price === null ? null : holding.shares * quote.price,
        }
      : null,
    related,
    insights,
    asOf: new Date().toISOString(),
  });
}
