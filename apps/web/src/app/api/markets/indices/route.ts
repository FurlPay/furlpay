import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { getQuotes } from "@/lib/markets/quotes";

// GET /api/markets/indices — major index proxies for the Market Pulse strip.
// ETF proxies keep everything on the same keyless quote pipeline.
const INDICES = [
  { id: "sp500", label: "S&P 500", proxy: "SPY" },
  { id: "nasdaq", label: "NASDAQ 100", proxy: "QQQ" },
  { id: "dow", label: "Dow Jones", proxy: "DIA" },
  { id: "russell", label: "Russell 2000", proxy: "IWM" },
  { id: "btc", label: "Bitcoin", proxy: "BTC" },
  { id: "eth", label: "Ethereum", proxy: "ETH" },
] as const;

export async function GET() {
  const quotes = await getQuotes();
  const items = INDICES.map((ix) => {
    const q = quotes.get(ix.proxy);
    return {
      id: ix.id,
      label: ix.label,
      proxy: ix.proxy,
      price: q?.price ?? 0,
      changePct: q?.changePct ?? 0,
      live: q?.live ?? false,
    };
  });

  // Simple market-sentiment score from index breadth (0..100, Fear & Greed style).
  const avg = items.slice(0, 4).reduce((s, i) => s + i.changePct, 0) / 4;
  const sentiment = Math.round(Math.max(0, Math.min(100, 50 + avg * 18)));

  return NextResponse.json({ items, sentiment, asOf: new Date().toISOString() });
}
