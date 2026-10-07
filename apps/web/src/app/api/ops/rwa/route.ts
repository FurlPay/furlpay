import { NextRequest } from "next/server";
import { requireOpsAdmin, opsError, opsOk } from "@/lib/ops/respond";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { RwaQuery, SnapshotDate, rwaSearch, rwaSummary } from "@/lib/rwa";

export const dynamic = "force-dynamic";

// GET /api/ops/rwa?view=summary[&snapshot=YYYY-MM-DD]   (default: latest snapshot)
// GET /api/ops/rwa?view=search&q=&assetClass=&chain=&issuer=&minUsd=&sort=&limit=&offset=&snapshot=
// (ADMIN_ONLY). The tokenized-assets index behind /analytics/rwa. Admin only
// because the data is a licensed Allium export (see lib/rwa.ts).
export async function GET(req: NextRequest) {
  const auth = await requireOpsAdmin(req);
  if (!auth.ok) return auth.res;
  const limited = await rateLimitOr429(req, "ops-rwa", { limit: 60, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;

  const sp = req.nextUrl.searchParams;
  const view = sp.get("view") ?? "summary";
  if (view === "summary") {
    const snap = sp.get("snapshot");
    if (snap !== null && !SnapshotDate.safeParse(snap).success) return opsError("invalid_snapshot", "snapshot must be YYYY-MM-DD", 400);
    const r = await rwaSummary(snap ?? undefined);
    return r.ok ? opsOk(r.data) : r.kind === "not_loaded" ? opsError("not_loaded", r.reason, 404) : opsError("unavailable", r.reason, 503);
  }
  if (view !== "search") return opsError("invalid_view", "view must be summary or search", 400);

  const parsed = RwaQuery.safeParse(Object.fromEntries([...sp.entries()].filter(([k, v]) => k !== "view" && v !== "")));
  if (!parsed.success) return opsError("invalid_query", parsed.error.issues[0]?.message ?? "invalid query", 400);
  const r = await rwaSearch(parsed.data);
  return r.ok ? opsOk(r.data) : r.kind === "not_loaded" ? opsError("not_loaded", r.reason, 404) : opsError("unavailable", r.reason, 503);
}
