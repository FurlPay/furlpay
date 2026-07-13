import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { requireUser } from "@/lib/authz";
import { getQuotes } from "@/lib/markets/quotes";

// GET /api/investing/portfolio — holdings, dividends & performance metrics,
// scoped to the acting user. Holdings are marked to the latest quotes (live
// providers, seed fallback) before valuation so prices match the Markets tab.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const account = auth.account;

  const quotes = await getQuotes().catch(() => null);
  if (quotes) {
    for (const h of account.holdings) {
      const q = quotes.get(h.symbol);
      if (q) {
        h.price = q.price;
        h.changePct = q.changePct;
      }
      h.marketValue = h.shares * h.price;
    }
  }

  const marketValue = account.holdings.reduce((s, h) => s + h.marketValue, 0);
  const dayChange = account.holdings.reduce((s, h) => s + (h.marketValue * h.changePct) / 100, 0);
  const costBasis = account.holdings.reduce((s, h) => s + (h.costBasis ?? 0), 0);
  const totalReturn = marketValue - costBasis;

  // Illustrative dividend schedule.
  const dividends = [
    { symbol: "AAPL", amount: 0.25, status: "paid", exDate: "2026-05-12" },
    { symbol: "VOO", amount: 1.62, status: "pending", exDate: "2026-07-25" },
  ];

  return NextResponse.json({
    holdings: account.holdings,
    dividends,
    performance: {
      marketValue,
      dayChange,
      dayChangePct: marketValue ? (dayChange / marketValue) * 100 : 0,
      totalReturn,
      totalReturnPct: costBasis ? (totalReturn / costBasis) * 100 : 0,
    },
  });
}
