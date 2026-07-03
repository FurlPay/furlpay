import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { CATALOG, assetLogoPath, AssetKind } from "@/lib/markets/catalog";
import { getQuotes } from "@/lib/markets/quotes";

// GET /api/markets?kind=stock|etf|crypto&q=<search> — tradable asset catalog
// with the latest prices (live providers, 60s cache, seed fallback).
export async function GET(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get("kind") as AssetKind | null;
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();

  const quotes = await getQuotes();

  let assets = CATALOG;
  if (kind) assets = assets.filter((a) => a.kind === kind);
  if (q) {
    assets = assets.filter(
      (a) => a.symbol.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)
    );
  }

  const items = assets.map((a) => {
    const quote = quotes.get(a.symbol);
    return {
      symbol: a.symbol,
      name: a.name,
      kind: a.kind,
      logo: assetLogoPath(a),
      price: quote?.price ?? 0,
      changePct: quote?.changePct ?? 0,
      live: quote?.live ?? false,
    };
  });

  return NextResponse.json({ items, asOf: new Date().toISOString() });
}
