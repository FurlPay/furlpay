import { NextRequest } from "next/server";
import { requireOpsAdmin, opsError, opsOk } from "@/lib/ops/respond";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { parseRange } from "@/lib/analytics/range";
import { buildOnchainDashboard, parseChain } from "@/lib/onchain/dashboard";

export const dynamic = "force-dynamic";

// GET /api/ops/onchain?range=24h|7d|30d|90d|custom[&from&to]&chain=all|<chain>
// (ADMIN_ONLY). Every card of /onchain in one response, polled every 30s.
// The admin check runs first so an anonymous caller learns nothing, not even
// whether its parameters were valid.
export async function GET(req: NextRequest) {
  const auth = await requireOpsAdmin(req);
  if (!auth.ok) return auth.res;
  const limited = await rateLimitOr429(req, "ops-onchain", { limit: 30, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;

  const range = parseRange(req.nextUrl.searchParams);
  if (!range.ok) return opsError("invalid_range", range.error, 400);
  const chain = parseChain(req.nextUrl.searchParams.get("chain"));
  if (!chain) return opsError("invalid_chain", "unknown chain", 400);

  return opsOk(await buildOnchainDashboard(range.range, chain));
}
