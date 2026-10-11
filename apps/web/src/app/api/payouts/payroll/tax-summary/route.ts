import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { taxSummary } from "@/lib/payroll/tax";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
// GET ?year=YYYY → 1099-NEC threshold watch for US contractors (see lib/payroll/tax.ts). Not a filing.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req); if (!auth.ok) return auth.res;
  const limited = await rateLimitOr429(req, "payroll.tax.read", { limit: 20, windowMs: 60_000 }, auth.account.user.id); if (limited) return limited;
  const year = z.coerce.number().int().min(2020).max(2100).safeParse(req.nextUrl.searchParams.get("year") ?? new Date().getUTCFullYear());
  if (!year.success) return NextResponse.json({ error: "Invalid year" }, { status: 400, headers });
  try { return NextResponse.json(await taxSummary(auth.account.user.id, year.data), { headers }); }
  catch { return NextResponse.json({ error: "Tax summary is unavailable. Configure storage and apply migration 0042." }, { status: 503, headers }); }
}
