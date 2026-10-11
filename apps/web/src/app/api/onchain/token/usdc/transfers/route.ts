import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { recentTransfers, usdcIndexView } from "@/lib/onchain/usdcIndex/view";

export const dynamic = "force-dynamic";

const SHORT: Record<string, number> = { "1m": 60, "5m": 300, "1h": 3600 };
const LONG = new Set(["24h", "7d", "30d", "90d"]);
const KIND = ["transfer", "mint", "burn"];

// GET /api/onchain/token/usdc/transfers?window=1m|5m|1h|24h|7d|30d|90d&sort=recent|largest&limit=
// PUBLIC. Short windows read retained finalized events (a bounded block
// range); largest over 24H and longer comes from the per-bucket top-10 lists
// the indexer materialises — never a sort over the lifetime table.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "onchain-usdc-transfers", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  const sp = req.nextUrl.searchParams;
  const window = sp.get("window") ?? "1h";
  const sort = sp.get("sort") === "largest" ? "largest" : "recent";
  const limit = Math.min(100, Math.max(1, Number(sp.get("limit") ?? "25") || 25));
  if (!(window in SHORT) && !LONG.has(window)) return NextResponse.json({ ok: false, error: { code: "invalid_window", message: "window must be 1m, 5m, 1h, 24h, 7d, 30d or 90d" } }, { status: 400 });
  if (LONG.has(window) && sort !== "largest") return NextResponse.json({ ok: false, error: { code: "invalid_window", message: "Recent transfers are served for windows up to 1h." } }, { status: 400 });
  const view = await usdcIndexView();
  if (!view.available) return NextResponse.json({ ok: false, error: { code: "index_unavailable", message: view.reason } }, { status: 503 });
  try {
    if (LONG.has(window)) {
      const w = view.windows[window] as { top?: unknown[]; from?: string; to?: string } | undefined;
      const transfers = (w?.top ?? []).slice(0, Math.min(limit, 10)).map((x) => {
        const [amountRaw, block, logIndex, tx, from, to, kind] = x as [string, number, number, string, string, string, number];
        return { block, logIndex, tx, from, to, amountRaw, kind: KIND[kind] ?? "transfer" };
      });
      return NextResponse.json({ ok: true, data: { window, sort, from: w?.from ?? null, to: w?.to ?? null, finalizedThrough: view.indexed, transfers, source: "materialised top-10 per bucket" } }, { headers: { "cache-control": "public, max-age=10, s-maxage=15" } });
    }
    const transfers = await recentTransfers(SHORT[window], sort, limit, view.indexed.time ?? undefined);
    return NextResponse.json({ ok: true, data: { window, sort, finalizedThrough: view.indexed, transfers, source: "retained finalized events" } }, { headers: { "cache-control": "public, max-age=5, s-maxage=10" } });
  } catch {
    return NextResponse.json({ ok: false, error: { code: "index_unavailable", message: "The USDC index store is unavailable." } }, { status: 503 });
  }
}
