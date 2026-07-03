import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { CATALOG, bySymbol, assetLogoPath } from "@/lib/markets/catalog";
import { getQuotes } from "@/lib/markets/quotes";
import { keyStatsFor, digestFor } from "@/lib/markets/stats";
import { insightsByTicker } from "@/lib/insights/articles";
import { db } from "@/lib/store";

// GET /api/markets/[symbol] — full asset detail: quote, key stats, AI digest,
// current position, related assets and research insights mentioning it.
export async function GET(_req: NextRequest, { params }: { params: { symbol: string } }) {
  const sym = params.symbol.toUpperCase();
  const asset = bySymbol.get(sym);
  if (!asset) return NextResponse.json({ error: "Unknown symbol" }, { status: 404 });

  const quotes = await getQuotes();
  const quote = quotes.get(sym) ?? { price: 0, changePct: 0, live: false };
  const stats = keyStatsFor(asset, quote);

  const related = CATALOG.filter(
    (a) =>
      a.symbol !== sym &&
      a.kind === asset.kind &&
      (asset.kind === "stock" ? a.sector === asset.sector : a.industry === asset.industry)
  )
    .slice(0, 6)
    .map((a) => {
      const q = quotes.get(a.symbol);
      return {
        symbol: a.symbol,
        name: a.name,
        kind: a.kind,
        logo: assetLogoPath(a),
        price: q?.price ?? 0,
        changePct: q?.changePct ?? 0,
      };
    });

  const holding = db.holdings.find((h) => h.symbol === sym);

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
