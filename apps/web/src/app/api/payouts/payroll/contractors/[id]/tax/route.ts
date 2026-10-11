import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { PayrollConflict } from "@/lib/payroll/repository";
import { recordTaxForm, taxFormSchema, TaxKeyUnavailable } from "@/lib/payroll/taxForms";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
// POST: record a payee-signed W-9 / W-8BEN the employer holds (see lib/payroll/taxForms.ts).
// The TIN is sealed and never returned; the response carries the last 4 only.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req); if (!auth.ok) return auth.res;
  const limited = await rateLimitOr429(req, "payroll.tax.write", { limit: 10, windowMs: 60_000 }, auth.account.user.id); if (limited) return limited;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid contractor ID" }, { status: 400, headers });
  const input = await validateBody(req, taxFormSchema); if (input instanceof NextResponse) return input;
  try {
    const tax = await recordTaxForm(auth.account.user.id, id, input, auth.account.user.id);
    return NextResponse.json(tax ? { tax } : { error: "Contractor not found" }, { status: tax ? 200 : 404, headers });
  } catch (e) {
    if (e instanceof PayrollConflict) return NextResponse.json({ error: e.message }, { status: 409, headers });
    if (e instanceof TaxKeyUnavailable) return NextResponse.json({ error: "Tax form storage is not configured (FURLPAY_TAX_ENCRYPTION_KEY)." }, { status: 503, headers });
    return NextResponse.json({ error: "Payroll is unavailable. Configure storage and apply migration 0042." }, { status: 503, headers });
  }
}
