import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
export const dynamic = "force-dynamic";
import { getQuotes } from "@/lib/markets/quotes";
import { getExtras, resolveExtras } from "@/lib/markets/extras";

/** Public market data, identical for every reader — see the note in
 *  api/markets/table/route.ts. Matched to the 60s quote cache TTL. */
const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
} as const;


// GET /api/markets/indices — major index proxies for the Market Pulse strip.
// ETF proxies keep everything on the same keyless quote pipeline.
const INDICES = [
  { id: "sp500", label: "S&P 500", proxy: "SPY", kind: "etf" },
  { id: "nasdaq", label: "NASDAQ 100", proxy: "QQQ", kind: "etf" },
  { id: "dow", label: "Dow Jones", proxy: "DIA", kind: "etf" },
  { id: "russell", label: "Russell 2000", proxy: "IWM", kind: "etf" },
  { id: "btc", label: "Bitcoin", proxy: "BTC", kind: "crypto" },
  { id: "eth", label: "Ethereum", proxy: "ETH", kind: "crypto" },
] as const;

export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "markets.indices", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  // Extras carry the sparkline. Optional: a card without history draws its
  // number and no chart, which is a smaller loss than an empty strip.
  const [quotes, extras] = await Promise.all([getQuotes(), getExtras().catch(() => new Map())]);

  const items = INDICES.map((ix) => {
    const q = quotes.get(ix.proxy);
    const extra = resolveExtras(extras, { kind: ix.kind, symbol: ix.proxy });
    return {
      id: ix.id,
      label: ix.label,
      proxy: ix.proxy,
      // Nullable, not zero-defaulted. A 0.00 on an index card reads as a
      // catastrophic market event rather than as a missing quote.
      price: q?.price ?? null,
      changePct: q?.changePct ?? null,
      /** Real closing prices, oldest to newest, or null. */
      spark: extra.spark,
      live: q?.live ?? false,
    };
  });

  // Simple market-sentiment score from index breadth (0..100, Fear & Greed
  // style). Only computed when all four equity proxies are actually priced —
  // averaging over missing quotes would silently pull the reading toward 50.
  const equity = items.slice(0, 4);
  const priced = equity.filter((i) => i.changePct != null);
  const sentiment =
    priced.length === equity.length
      ? Math.round(
          Math.max(
            0,
            Math.min(100, 50 + (priced.reduce((s, i) => s + (i.changePct as number), 0) / priced.length) * 18)
          )
        )
      : null;

  return NextResponse.json(
    { items, sentiment, asOf: new Date().toISOString() },
    { headers: CACHE_HEADERS }
  );
}
