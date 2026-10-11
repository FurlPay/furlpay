import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { payrollAnalytics } from "@/lib/payroll/analytics";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const Query = z.object({ months: z.coerce.number().int().min(1).max(24).default(6) }).strict();

// GET /api/payouts/payroll/analytics?months=6 — the signed-in employer's payroll
// totals by cycle, status, chain and contractor (lib/payroll/analytics.ts).
// "paid" counts only lines whose execution was verified on-chain; pending and
// prepared amounts are reported separately, and fees are quotes.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req); if (!auth.ok) return auth.res;
  const limited = await rateLimitOr429(req, "payroll.analytics", { limit: 30, windowMs: 60_000 }, auth.account.user.id); if (limited) return limited;
  const q = Query.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!q.success) return NextResponse.json({ error: "months must be an integer from 1 to 24" }, { status: 400, headers });
  try {
    return NextResponse.json(await payrollAnalytics(auth.account.user.id, q.data.months), { headers });
  } catch {
    return NextResponse.json({ error: "Payroll analytics are unavailable. Configure storage and apply migration 0042." }, { status: 503, headers });
  }
}
