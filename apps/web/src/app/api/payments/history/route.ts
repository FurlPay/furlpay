import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { listPayments } from "@/lib/services/payments";

export const dynamic = "force-dynamic";

// GET /api/payments/history?limit=50 — most recent payments, newest first.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "payments.history", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit")) || 50, 200);
  const payments = listPayments(limit);
  return NextResponse.json({ payments, count: payments.length });
}
