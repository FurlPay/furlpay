import { NextRequest } from "next/server";
import { requireOpsAdmin, opsOk, opsError } from "@/lib/ops/respond";
import { txEventsBetween, summarize } from "@/lib/ops/metrics";

export const dynamic = "force-dynamic";

const WINDOWS_MS: Record<string, number> = {
  "1h": 3_600_000,
  "24h": 86_400_000,
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
};

// GET /api/ops/transactions/summary?window=24h — aggregated cards data.
// Settlement-latency percentiles are intentionally absent: per-event latency
// is not recorded in the ledger yet, and this endpoint does not fabricate.
export async function GET(req: NextRequest) {
  const auth = await requireOpsAdmin(req);
  if (!auth.ok) return auth.res;

  const window = req.nextUrl.searchParams.get("window") || "24h";
  const windowMs = WINDOWS_MS[window];
  if (!windowMs) return opsError("bad_window", `window must be one of ${Object.keys(WINDOWS_MS).join(", ")}`, 400);

  const to = Date.now();
  const events = await txEventsBetween(to - windowMs, to);
  return opsOk({ window, ...summarize(events) });
}
