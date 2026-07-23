import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { CATALOG, bySymbol, assetLogoPath } from "@/lib/markets/catalog";
import { getQuotes, resolveQuote } from "@/lib/markets/quotes";
import { keyStatsFor, digestFor } from "@/lib/markets/stats";
import { insightsByTicker } from "@/lib/insights/articles";
import { optionalUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";

// GET /api/markets/[symbol] — full asset detail: quote, key stats, AI digest,
// current position, related assets and research insights mentioning it.
export async function GET(req: NextRequest, { params }: { params: { symbol: string } }) {
  // Anonymous callers are served, so the middleware baseline (mutating methods
  // only) does not cover this. getQuotes() reaches a paid upstream, making an
  // unbounded reader someone else's quota bill as well as ours.
  const limited = await rateLimitOr429(req, "markets.symbol", { limit: 120, windowMs: 60_000 });
  if (limited) return limited;

  const sym = params.symbol.toUpperCase();
  const asset = bySymbol.get(sym);
  if (!asset) return NextResponse.json({ error: "Unknown symbol" }, { status: 404 });

  const quotes = await getQuotes();
  const quote = resolveQuote(quotes, asset) ?? { price: 0, changePct: 0, live: false };
  const stats = keyStatsFor(asset, quote);

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
    digest: digestFor(asset, quote, stats),
    position: holding ? { shares: holding.shares, marketValue: holding.shares * quote.price } : null,
    related,
    insights,
    asOf: new Date().toISOString(),
  });
}
