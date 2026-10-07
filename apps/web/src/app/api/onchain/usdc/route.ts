import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { usdcNetwork, WINDOWS, type UsdcWindow } from "@/lib/onchain/usdcNetwork";

export const dynamic = "force-dynamic";

// GET /api/onchain/usdc?window=60|300 — PUBLIC. Network-wide native USDC read
// from FurlPay's configured chain nodes (lib/onchain/usdcNetwork.ts): head,
// exact supply, per-chain state and indexer health. Public chain data only.
//
// RPC BUDGET + FRESHNESS: the CDN shares one response across all viewers for
// at most 60 s (no stale-while-revalidate, so a quiet page is never served an
// older read), and each instance reuses its own read for 30 s. Each chain's
// `readAt` / `generatedAt` is the real node-read time, which the UI shows.
// RPC URLs never appear in the response.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "onchain-usdc", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const w = Number(req.nextUrl.searchParams.get("window") ?? "60");
  if (!(WINDOWS as readonly number[]).includes(w)) {
    return NextResponse.json({ ok: false, error: { code: "invalid_window", message: `window must be one of ${WINDOWS.join(", ")}` } }, { status: 400 });
  }
  const data = await usdcNetwork(w as UsdcWindow);
  return NextResponse.json({ ok: true, data }, { headers: { "cache-control": "public, max-age=15, s-maxage=60, stale-while-revalidate=0" } });
}
