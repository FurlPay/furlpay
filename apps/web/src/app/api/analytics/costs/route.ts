import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { getMonthlyCosts } from "@/lib/costTracker";

export const dynamic = "force-dynamic";

// GET /api/analytics/costs?month=YYYY-MM — estimated infra spend per external
// service for the month (defaults to the current one). Session-gated by
// middleware.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "analytics.costs", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const raw = req.nextUrl.searchParams.get("month");
  const m = raw && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : undefined;
  return NextResponse.json(await getMonthlyCosts(m));
}
