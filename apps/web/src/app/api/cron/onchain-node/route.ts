import { NextRequest, NextResponse } from "next/server";
import { requireCron } from "@/lib/cron/auth";
import { nodeChains, scanNodes } from "@/lib/onchain/nodeIndexer";
import { scanAssets } from "@/lib/onchain/assetIndexer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/cron/onchain-node — one direct-to-node pass over every chain in
// ONCHAIN_NODE_CHAINS (lib/onchain/nodeIndexer.ts, solanaNodeIndexer.ts).
// ?chain=base,solana limits the pass to those chains, so a head-driven tail
// (scripts/onchain/node-tail.mjs) can scan each chain on its own block clock.
// Each pass runs both indexers for the chain: tracked wallets (unfinalized tip
// included, idempotent) and the network-wide asset index (finalized ranges,
// committed exactly once by compare-and-set; lib/onchain/assetIndexer.ts).
//
// Built for a FREQUENT external scheduler (x-furlpay-cron-key), e.g. a timer
// on the host that runs the node, polling every few seconds: Vercel Cron on
// this plan fires at most daily, which is why the daily reconcile also runs a
// pass. Deliberately not wrapped in the cron runner: its lock lives in KV, and
// overlapping passes are already safe without it — ingest is idempotent on
// event_key and the cursor only moves by compare-and-set in Postgres.
export async function GET(req: NextRequest) {
  const auth = requireCron(req);
  if (!auth.ok) return auth.res;
  if (nodeChains().length === 0) {
    return NextResponse.json({ ok: false, status: "not_configured", reason: "ONCHAIN_NODE_CHAINS is empty or names chains without an RPC URL." }, { status: 503 });
  }
  const only = req.nextUrl.searchParams.get("chain")?.split(",").map((c) => c.trim().toLowerCase()).filter(Boolean);
  if (only && only.some((c) => !nodeChains().includes(c))) {
    return NextResponse.json({ ok: false, status: "not_configured", reason: "chain is not in ONCHAIN_NODE_CHAINS or has no RPC URL." }, { status: 400 });
  }
  const started = Date.now();
  // Wallet scan first (small, user-facing), then the asset index with what is left.
  const reports = await scanNodes({ deadline: () => Date.now() - started > 20_000, only });
  const assets = await scanAssets({ deadline: () => Date.now() - started > 45_000, only });
  const all = [...reports.map((r) => r.status), ...assets.map((a) => a.status)];
  const failed = all.filter((s) => s === "failed").length;
  return NextResponse.json({ ok: failed === 0, reports, assets }, { status: failed === all.length && failed > 0 ? 502 : 200 });
}
