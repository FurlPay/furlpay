import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { usdcNetwork, WINDOWS, type UsdcWindow } from "@/lib/onchain/usdcNetwork";

export const dynamic = "force-dynamic";

// GET /api/onchain/usdc?window=60|300 — PUBLIC. Network-wide native USDC read
// live from FurlPay's configured chain nodes (lib/onchain/usdcNetwork.ts):
// exact supply at latest and finalized blocks, and every USDC Transfer in the
// last `window` seconds. Public chain data only; no FurlPay user data. Callers
// on an instance share one node read per window every 8 s. RPC URLs never
// appear in the response.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "onchain-usdc", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const w = Number(req.nextUrl.searchParams.get("window") ?? "60");
  if (!(WINDOWS as readonly number[]).includes(w)) {
    return NextResponse.json({ ok: false, error: { code: "invalid_window", message: `window must be one of ${WINDOWS.join(", ")}` } }, { status: 400 });
  }
  const data = await usdcNetwork(w as UsdcWindow);
  return NextResponse.json({ ok: true, data }, { headers: { "cache-control": "public, max-age=5, s-maxage=8" } });
}
