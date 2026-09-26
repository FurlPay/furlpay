import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { requireUser } from "@/lib/authz";
import { buildPnl } from "@/lib/services/reports";

export const dynamic = "force-dynamic";

// GET /api/reports/pnl — unified profit & loss across equities (unrealized),
// crypto disposals (realized) and cashback income for the authenticated caller.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "reports.pnl", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  return NextResponse.json(buildPnl(auth.account));
}

