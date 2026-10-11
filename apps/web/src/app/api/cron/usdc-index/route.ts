import { NextRequest, NextResponse } from "next/server";
import { requireCron } from "@/lib/cron/auth";
import { runUsdcIndex } from "@/lib/onchain/usdcIndex/indexer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/cron/usdc-index[?mode=live|backfill|all] — one Ethereum USDC index
// pass (lib/onchain/usdcIndex/indexer.ts): newly finalized ranges first, then
// historical units with the remaining budget, then the materialised windows.
// Meant for a frequent external scheduler (x-furlpay-cron-key), e.g.
// scripts/onchain/usdc-index-worker.mjs. Overlapping passes are safe: live
// commits are compare-and-set, backfill units are leased.
export async function GET(req: NextRequest) {
  const auth = requireCron(req);
  if (!auth.ok) return auth.res;
  const m = req.nextUrl.searchParams.get("mode");
  const mode = m === "live" || m === "backfill" ? m : "all";
  const started = Date.now();
  const out = await runUsdcIndex({ mode, deadline: () => Date.now() - started > 25_000, backfillDeadline: () => Date.now() - started > 45_000 });
  const status = out.status === "not_configured" ? 503 : out.ok ? 200 : 502;
  return NextResponse.json(out, { status });
}
