import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { requireUser } from "@/lib/authz";
import { listPayments } from "@/lib/services/payments";

export const dynamic = "force-dynamic";

// GET /api/payments/history?limit=50 — the SIGNED-IN account's most recent
// payments, newest first.
//
// This handler had no auth check of its own and listed every account's
// payments; the middleware's session requirement was the only thing in front
// of it, so any signed-in user could read everyone's records. It now resolves
// the user and returns only that user's payments.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "payments.history", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit")) || 50, 200);
  const payments = listPayments(auth.account.user.id, limit);
  return NextResponse.json({ payments, count: payments.length }, { headers: { "cache-control": "no-store" } });
}
