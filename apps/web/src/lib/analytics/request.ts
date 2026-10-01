import { NextRequest, NextResponse } from "next/server";
import { opsError } from "@/lib/ops/respond";
import type { AuthResult } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { parseRange } from "./range";
import { parseProduct } from "./dashboard";
import { dashboardCached } from "./cache";
import type { Dashboard } from "./dashboard";

type Admin = Extract<AuthResult, { ok: true }>;

/**
 * The common back half of every /api/ops/analytics/* route. The ROUTE calls
 * requireOpsAdmin() itself first (the route-manifest scanner checks for it in
 * the file, and an anonymous or non-admin caller must learn nothing, not even
 * whether its parameters were valid); this applies the per-admin limit and
 * strict parameters, then serves the shared cached build.
 */
export async function analyticsDashboard(
  req: NextRequest,
  admin: Admin,
  limiterName: string
): Promise<{ ok: true; dashboard: Dashboard } | { ok: false; res: NextResponse }> {
  const limited = await rateLimitOr429(req, limiterName, { limit: 30, windowMs: 60_000 }, admin.account.user.id);
  if (limited) return { ok: false, res: limited };

  const parsed = parseRange(req.nextUrl.searchParams);
  if (!parsed.ok) return { ok: false, res: opsError("invalid_range", parsed.error, 400) };
  const product = parseProduct(req.nextUrl.searchParams.get("product"));
  if (!product) return { ok: false, res: opsError("invalid_product", "unknown product", 400) };

  return { ok: true, dashboard: await dashboardCached(parsed.range, product) };
}
