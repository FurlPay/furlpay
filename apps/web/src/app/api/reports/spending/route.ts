import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { buildSpendingSummary } from "@/lib/services/spendingSummary";

export const dynamic = "force-dynamic";

// GET /api/reports/spending — rolling 7-day spending summary with a generated
// narrative (Auto Commentary). Session-gated by middleware.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "reports.spending", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  return NextResponse.json(buildSpendingSummary());
}
