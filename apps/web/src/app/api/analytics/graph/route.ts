import { NextRequest, NextResponse } from "next/server";
import { buildTransactionGraph } from "@/lib/services/transactionGraph";

export const dynamic = "force-dynamic";

// GET /api/analytics/graph?limit= — aggregated counterparty graph over the
// user's transactions (nodes, flow edges, top recipients/sources). Session-
// gated by middleware.
export function GET(req: NextRequest) {
  const raw = Number(req.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), 50) : 10;
  return NextResponse.json(buildTransactionGraph(limit));
}
