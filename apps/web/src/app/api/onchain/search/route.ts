import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { isOperator } from "@/lib/authz";
import { searchEvents } from "@/lib/onchain/live";

export const dynamic = "force-dynamic";

// GET /api/onchain/search?q=<tx hash | address | chain | asset symbol>[&cursor=<id>]
// PUBLIC, rate-limited. Strictly shaped inputs only (see searchEvents); public
// callers search FurlPay's own treasury/watch activity — searching an address
// must not reveal whether it is a FurlPay user's wallet. The admin searches all.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "onchain-search", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 120);
  const rawCursor = req.nextUrl.searchParams.get("cursor");
  const cursor = rawCursor && /^\d{1,15}$/.test(rawCursor) ? Number(rawCursor) : null;
  if (rawCursor && cursor === null) return NextResponse.json({ ok: false, error: { code: "invalid_cursor", message: "cursor must be an event id" } }, { status: 400 });
  const full = await isOperator(req);
  try {
    const r = await searchEvents(q, full, cursor);
    if (!r) return NextResponse.json({ ok: false, error: { code: "unsupported_query", message: "Search by transaction hash, address, chain or asset symbol." } }, { status: 400 });
    return NextResponse.json({ ok: true, data: { ...r, scope: full ? "all" : "furlpay_owned" } }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: { code: "search_unavailable", message: "The onchain store is unavailable." } }, { status: 503 });
  }
}
