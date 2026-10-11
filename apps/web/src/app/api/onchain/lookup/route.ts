import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { lookup } from "@/lib/onchain/lookup";

export const dynamic = "force-dynamic";

// GET /api/onchain/lookup?q=<EVM tx hash | EVM address | Solana signature | Solana address>
// PUBLIC, tightly rate-limited (each call fans out to FurlPay's own RPC nodes,
// never a public fallback). Public chain data only: it never consults FurlPay's
// store, so it cannot reveal whether an address belongs to a FurlPay user.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "onchain-lookup", { limit: 10, windowMs: 60_000 });
  if (limited) return limited;
  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 120);
  const r = await lookup(q);
  if (!r) return NextResponse.json({ ok: false, error: { code: "unsupported_query", message: "Enter a full transaction hash or address (EVM or Solana)." } }, { status: 400 });
  return NextResponse.json({ ok: true, data: r }, { headers: { "cache-control": "no-store" } });
}
