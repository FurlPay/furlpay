import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { usdcNetwork, WINDOWS, type UsdcWindow } from "@/lib/onchain/usdcNetwork";

export const dynamic = "force-dynamic";

// GET /api/onchain/usdc?window=60|300 — PUBLIC. Network-wide native USDC read
// from FurlPay's configured chain nodes (lib/onchain/usdcNetwork.ts): head,
// exact supply, per-chain state and indexer health. Public chain data only.
//
// RPC BUDGET: one read per window is shared by EVERY viewer and instance for
// 30 s (Next data cache), so visitor count does not drive RPC spend. Each
// chain's `readAt` is the real time of the node read, which the UI shows.
// RPC URLs never appear in the response.
const SHARED_TTL_S = 30;
const cachedRead = unstable_cache((w: UsdcWindow) => usdcNetwork(w), ["onchain-usdc-v2"], { revalidate: SHARED_TTL_S, tags: ["onchain-usdc"] });

export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "onchain-usdc", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const w = Number(req.nextUrl.searchParams.get("window") ?? "60");
  if (!(WINDOWS as readonly number[]).includes(w)) {
    return NextResponse.json({ ok: false, error: { code: "invalid_window", message: `window must be one of ${WINDOWS.join(", ")}` } }, { status: 400 });
  }
  // Outside a Next runtime with a data cache (tests, scripts) read directly.
  const data = await cachedRead(w as UsdcWindow).catch(() => usdcNetwork(w as UsdcWindow));
  return NextResponse.json({ ok: true, data }, { headers: { "cache-control": `public, max-age=10, s-maxage=${SHARED_TTL_S}` } });
}
