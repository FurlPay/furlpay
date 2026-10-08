import { NextRequest, NextResponse } from "next/server";
import { parseSeriesRange, usdcSeries, type SeriesGranularity } from "./view";

// Shared handler (the route files rate-limit first) for GET /api/onchain/token/usdc/metrics/{hourly,daily} —
// PUBLIC, public chain data only. 400 on a malformed or oversized range;
// 503 index_unavailable when the index cannot be read (never an empty series
// that looks like zero activity).
export async function seriesGet(req: NextRequest, g: SeriesGranularity): Promise<NextResponse> {
  const sp = req.nextUrl.searchParams;
  const chain = sp.get("chain");
  if (chain && chain !== "ethereum") return NextResponse.json({ ok: false, error: { code: "invalid_chain", message: "Only chain=ethereum is indexed." } }, { status: 400 });
  const range = parseSeriesRange(g, sp.get("from"), sp.get("to"));
  if ("error" in range) return NextResponse.json({ ok: false, error: { code: "invalid_range", message: range.error } }, { status: 400 });
  const data = await usdcSeries(g, range.from, range.to);
  if (!data.available) {
    return NextResponse.json({ ok: false, error: { code: "index_unavailable", message: data.reason ?? "The USDC index is not available." } }, { status: 503, headers: { "cache-control": "no-store" } });
  }
  return NextResponse.json({ ok: true, data }, { headers: { "cache-control": "public, max-age=30, s-maxage=60, stale-while-revalidate=0" } });
}
