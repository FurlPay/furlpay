import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { buildTransactionGraph } from "@/lib/services/transactionGraph";

export const dynamic = "force-dynamic";

// GET /api/analytics/graph?limit= — aggregated counterparty graph over the
// user's transactions (nodes, flow edges, top recipients/sources). Session-
// gated by middleware.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "analytics.graph", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const raw = Number(req.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), 50) : 10;
  return NextResponse.json(buildTransactionGraph(limit));
}
