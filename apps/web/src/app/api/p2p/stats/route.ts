import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { orderStats } from "@/lib/services/p2p";

export const dynamic = "force-dynamic";

// GET /api/p2p/stats — the caller's own trading record (counts, completion
// rate, rating). Scoped to the session user; there is no path to another
// account's stats beyond the public maker badge on an ad.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const limited = await rateLimitOr429(req, "p2p.stats", { limit: 60, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;

  return NextResponse.json(orderStats(auth.account.user.id));
}
