import { NextResponse } from "next/server";
import { db } from "@/lib/store";

// GET /api/investing/portfolio — holdings, dividends & performance metrics.
export async function GET() {
  const marketValue = db.holdings.reduce((s, h) => s + h.marketValue, 0);
  const dayChange = db.holdings.reduce((s, h) => s + (h.marketValue * h.changePct) / 100, 0);

  // Illustrative dividend schedule.
  const dividends = [
    { symbol: "AAPL", amount: 0.25, status: "paid", exDate: "2026-05-12" },
    { symbol: "VOO", amount: 1.62, status: "pending", exDate: "2026-07-25" },
  ];

  return NextResponse.json({
    holdings: db.holdings,
    dividends,
    performance: {
      marketValue,
      dayChange,
      dayChangePct: marketValue ? (dayChange / marketValue) * 100 : 0,
    },
  });
}
