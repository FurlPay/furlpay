import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { CATALOG, assetLogoPath } from "@/lib/markets/catalog";
import { getQuotes } from "@/lib/markets/quotes";

// GET /api/markets/movers?kind=stock|etf|crypto&limit=6 — top gainers/losers.
export async function GET(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get("kind");
  const limit = Number(req.nextUrl.searchParams.get("limit")) || 6;
  const quotes = await getQuotes();

  const rows = CATALOG.filter((a) => (!kind || a.kind === kind) && a.industry !== "Stablecoin")
    .map((a) => {
      const q = quotes.get(a.symbol);
      return {
        symbol: a.symbol,
        name: a.name,
        kind: a.kind,
        logo: assetLogoPath(a),
        price: q?.price ?? 0,
        changePct: q?.changePct ?? 0,
        live: q?.live ?? false,
      };
    })
    .filter((r) => r.price > 0);

  const sorted = [...rows].sort((a, b) => b.changePct - a.changePct);
  return NextResponse.json({
    gainers: sorted.slice(0, limit),
    losers: sorted.slice(-limit).reverse(),
    asOf: new Date().toISOString(),
  });
}
