import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { isOperator } from "@/lib/authz";
import { txDetail } from "@/lib/onchain/live";

export const dynamic = "force-dynamic";

// GET /api/onchain/tx?key=<event key> — PUBLIC, rate-limited. Transaction
// inspector data. A user-wallet event is returned redacted to what the public
// feed already shows; FurlPay-owned activity in full with explorer links; the
// admin also gets the ledger correlation and the revision (reorg) history.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "onchain-tx", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const key = req.nextUrl.searchParams.get("key") ?? "";
  if (key.length > 300) return NextResponse.json({ ok: false, error: { code: "invalid_key", message: "key too long" } }, { status: 400 });
  const full = await isOperator(req);
  try {
    const d = await txDetail(key, full);
    if (!d) return NextResponse.json({ ok: false, error: { code: "not_found", message: "No such event." } }, { status: 404 });
    return NextResponse.json({ ok: true, data: d }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: { code: "unavailable", message: "The onchain store is unavailable." } }, { status: 503 });
  }
}
