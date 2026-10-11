import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { requireApiKey } from "@/lib/apiKeyAuth";
import { listPayments } from "@/lib/services/payments";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// GET /api/v1/payments — the API-key authenticated payments surface.
//
// This is the route that makes `payments:read` mean something. A permission
// offered in the key-creation UI but checked nowhere is a label, and a label
// that says "restricted" is worse than no label at all: it tells an operator
// they have limited a credential when they have not.
//
// A key without `payments:read` gets 403 here, not 402 or 401 — it presented
// a valid credential and the answer is still no, so retrying with the same
// key is pointless and the status says so.
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "v1.payments.read", { limit: 120, windowMs: 60_000 });
  if (limited) return limited;

  const auth = await requireApiKey(req, { scope: "payments:read" });
  if (!auth.ok) return auth.res;

  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit")) || 50, 200);
  // Scoped to the account that owns the key. `payments:read` is permission to
  // read that account's payments, not every account's.
  const payments = listPayments(auth.record.userId, limit);

  return NextResponse.json(
    {
      payments,
      count: payments.length,
      // Echoing the environment lets a caller catch a sandbox key pointed at
      // production before it produces a confusing empty result set.
      environment: auth.record.environment,
    },
    { headers: { "cache-control": "no-store" } }
  );
}
