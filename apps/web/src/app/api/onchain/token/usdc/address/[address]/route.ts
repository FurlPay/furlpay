import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { addressActivity, usdcIndexView } from "@/lib/onchain/usdcIndex/view";

export const dynamic = "force-dynamic";

// GET /api/onchain/token/usdc/address/:address — PUBLIC. An address's USDC
// activity within the retained window of finalized events (both directions,
// newest first). Public chain data only: the index holds every address on the
// network, so a result says nothing about whether it is a FurlPay user.
export async function GET(req: NextRequest, ctx: { params: Promise<{ address: string }> }) {
  const limited = await rateLimitOr429(req, "onchain-usdc-address", { limit: 20, windowMs: 60_000 });
  if (limited) return limited;
  const { address } = await ctx.params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return NextResponse.json({ ok: false, error: { code: "invalid_address", message: "Expected a 0x-prefixed 20-byte address." } }, { status: 400 });
  const view = await usdcIndexView();
  if (!view.available) return NextResponse.json({ ok: false, error: { code: "index_unavailable", message: view.reason } }, { status: 503 });
  try {
    const a = await addressActivity(address, 25);
    return NextResponse.json({ ok: true, data: { address: address.toLowerCase(), retainedDays: view.retentionDays, finalizedThrough: view.indexed, ...a } }, { headers: { "cache-control": "public, max-age=10, s-maxage=30" } });
  } catch {
    return NextResponse.json({ ok: false, error: { code: "index_unavailable", message: "The USDC index store is unavailable." } }, { status: 503 });
  }
}
