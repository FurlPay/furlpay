import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { importRoster } from "@/lib/payroll/selfService";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
// POST {csv}: all-or-nothing validation (any invalid row imports nothing and lists every error);
// emails already on the roster are skipped, never overwritten.
export async function POST(req: NextRequest) {
  const auth = await requireUser(req); if (!auth.ok) return auth.res;
  const limited = await rateLimitOr429(req, "payroll.import", { limit: 5, windowMs: 60_000 }, auth.account.user.id); if (limited) return limited;
  const input = await validateBody(req, z.object({ csv: z.string().min(1).max(90_000) }).strict()); if (input instanceof NextResponse) return input;
  try {
    const out = await importRoster(auth.account.user.id, input.csv);
    return NextResponse.json(out, { status: out.errors.length ? 422 : 200, headers });
  } catch { return NextResponse.json({ error: "Payroll is unavailable. Configure storage and apply migration 0044." }, { status: 503, headers }); }
}
