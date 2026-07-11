import { NextRequest } from "next/server";
import { requireOpsAdmin, opsOk } from "@/lib/ops/respond";
import { listSecurityEvents } from "@/lib/ops/events";

export const dynamic = "force-dynamic";

// GET /api/ops/security?limit= — real payment-security signals (replay
// rejections, bad signatures, quote/challenge tampering, over-limit attempts).
export async function GET(req: NextRequest) {
  const auth = await requireOpsAdmin(req);
  if (!auth.ok) return auth.res;
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit")) || 200, 1000);
  const events = await listSecurityEvents(limit);
  const bySeverity = events.reduce<Record<string, number>>((a, e) => ((a[e.severity] = (a[e.severity] ?? 0) + 1), a), {});
  return opsOk({ events, count: events.length, bySeverity });
}
