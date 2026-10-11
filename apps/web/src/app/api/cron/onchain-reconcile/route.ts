import { NextRequest, NextResponse } from "next/server";
import { requireCron } from "@/lib/cron/auth";
import { cronHttpStatus, runJob } from "@/lib/cron/runner";
import { syncOnchain } from "@/lib/onchain/sync";
import { scanNodes } from "@/lib/onchain/nodeIndexer";
import { scanAssets } from "@/lib/onchain/assetIndexer";
import { refreshRwaSnapshot } from "@/lib/rwaRefresh";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// GET /api/cron/onchain-reconcile — daily pass over Allium's Realtime API for
// every tracked address: fill stream gaps, promote past-finality events,
// mark events the provider no longer returns as reorged, flag ledger
// disagreements. 26 h lookback so consecutive daily runs overlap.
//
// Daily because the project's Vercel plan allows at most one run per day per
// cron (see lib/cron/runner). The stream (Beam webhook) is the realtime path;
// this is the safety net. Operators can run it on demand via
// POST /api/ops/onchain/sync, which does not depend on the runner's KV lock.
export async function GET(req: NextRequest) {
  const auth = requireCron(req);
  if (!auth.ok) return auth.res;
  const outcome = await runJob(
    "onchain.reconcile",
    async (ctx) => {
      const r = await syncOnchain("reconcile", { lookbackHours: 26, deadline: ctx.expired });
      ctx.metric("provider_events", r.providerEvents);
      ctx.metric("inserted", r.counts.inserted);
      ctx.metric("duplicates", r.counts.duplicates);
      ctx.metric("reorg_replaced", r.counts.reorg_replaced);
      ctx.metric("marked_reorged", r.markedReorged);
      ctx.metric("ledger_flagged", r.ledgerFlagged);
      ctx.note(`onchain reconcile: ${r.status}${r.reason ? ` (${r.reason})` : ""}; ${r.addresses} addresses; ${r.errors.length} errors`);
      // Direct-to-node pass for every opted-in chain (no-op when none is).
      for (const n of await scanNodes({ deadline: ctx.expired })) {
        ctx.note(`node ${n.chain}: ${n.status}${n.reason ? ` (${n.reason})` : ""}; blocks ${n.from}..${n.scannedThrough}; ${n.logs} logs; ${n.counts.inserted} new; ${n.markedReorged} proven reorged`);
      }
      // Network-wide asset index (USDC): catch up finalized ranges from each cursor.
      for (const a of await scanAssets({ deadline: ctx.expired })) {
        ctx.note(`asset ${a.asset}@${a.chain}: ${a.status}${a.reason ? ` (${a.reason})` : ""}; cursor ${a.cursorBefore}..${a.cursorAfter}; ${a.commits} commits${a.reconciled === false ? "; SUPPLY DID NOT RECONCILE" : ""}`);
      }
      // Tokenized assets: replace today's snapshot from the saved Allium query.
      const rwa = await refreshRwaSnapshot();
      ctx.note(`rwa refresh: ${rwa.status}${rwa.reason ? ` (${rwa.reason})` : `, ${rwa.rows} rows, ${rwa.changed} changed`}`);
      if (r.status === "failed") throw new Error(r.errors[0] ?? "onchain reconcile failed");
    },
    { budgetMs: 240_000 }
  );
  return NextResponse.json(outcome, { status: cronHttpStatus(outcome) });
}
