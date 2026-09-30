import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { buildTransactionGraph } from "@/lib/services/transactionGraph";

export const dynamic = "force-dynamic";

// GET /api/analytics/graph?limit= — aggregated counterparty graph over the
// CALLER's transactions (nodes, flow edges, top recipients/sources).
//
// This used to rely on the middleware session gate alone and build the graph
// from the seeded demo account, so every signed-in user saw the demo user's
// counterparties. The graph is now built from requireUser's account.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const limited = await rateLimitOr429(req, "analytics.graph", { limit: 60, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;

  const raw = Number(req.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), 50) : 10;
  return NextResponse.json(buildTransactionGraph(auth.account.transactions, limit));
}
