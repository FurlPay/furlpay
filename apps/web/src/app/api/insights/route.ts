import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { getSortedInsights } from "@/lib/insights/articles";

// GET /api/insights?limit=&category=&ticker= — insight article metadata for
// in-app surfaces (investing hub, asset pages). The portal itself renders the
// articles server-side from lib/insights.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "insights", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const p = req.nextUrl.searchParams;
  const limit = Number(p.get("limit")) || 0;
  const category = p.get("category");
  const ticker = p.get("ticker")?.toUpperCase();

  let list = getSortedInsights();
  if (category) list = list.filter((a) => a.category === category);
  if (ticker) list = list.filter((a) => a.tickers.includes(ticker));

  const items = list.map((a) => ({
    slug: a.slug,
    title: a.title,
    excerpt: a.excerpt,
    category: a.category,
    date: a.date,
    readMins: a.readMins,
    signal: a.signal ?? null,
    tickers: a.tickers,
    featured: !!a.featured,
  }));

  return NextResponse.json({ items: limit > 0 ? items.slice(0, limit) : items });
}
