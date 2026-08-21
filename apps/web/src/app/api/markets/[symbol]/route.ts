import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { CATALOG, bySymbol, assetLogoPath } from "@/lib/markets/catalog";
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
  const asset = bySymbol.get(sym);
  if (!asset) return NextResponse.json({ error: "Unknown symbol" }, { status: 404 });

  // Crypto goes through the same path, quoted as a pair (BTC-USD): it has no
  // filings and no SPY beta, but it does have a real 52-week range, which it
  // otherwise would not have at all.
  const [quotes, real] = await Promise.all([
    getQuotes(),
    realStatsFor(sym, asset.kind).catch(() => null),
  ]);

  // Prefer the consolidated Yahoo print for securities; it carries an exchange
  // timestamp, which is what lets the UI claim a price is live rather than
  // merely recent. Fall back to the catalog quote (and its seed price) so a
  // provider outage degrades the number instead of emptying the page.
  const fallback = resolveQuote(quotes, asset) ?? { price: 0, changePct: 0, live: false };
  const quote =
    real?.price != null
      ? { price: real.price, changePct: real.changePct ?? 0, live: true }
      : fallback;

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
  };

  const related = CATALOG.filter(
    (a) =>
      a.symbol !== sym &&
      a.kind === asset.kind &&
      (asset.kind === "stock" ? a.sector === asset.sector : a.industry === asset.industry)
  )
    .slice(0, 6)
    .map((a) => {
      const q = resolveQuote(quotes, a);
      return {
        symbol: a.symbol,
        name: a.name,
        kind: a.kind,
        logo: assetLogoPath(a),
        price: q?.price ?? 0,
        changePct: q?.changePct ?? 0,
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
  const digest =
    stats.high52w != null && stats.low52w != null
      ? digestFor(asset, quote, {
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
      logo: assetLogoPath(asset),
    },
    quote,
    stats,
    // Which upstream produced which half, the fiscal period the filed figures
    // cover, and whether they are a true TTM or a fiscal year. The UI shows
    // this: a number a reader cannot attribute is a number they cannot check.
    provenance: real?.provenance ?? {
      price: null,
      fundamentals: null,
      fiscalAsOf: null,
      incomeBasis: null,
      cik: null,
    },
    digest,
    position: holding ? { shares: holding.shares, marketValue: holding.shares * quote.price } : null,
    related,
    insights,
    asOf: new Date().toISOString(),
  });
}
