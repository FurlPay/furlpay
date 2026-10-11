import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { contractorPatchSchema, contractorSchema } from "@/lib/payroll/model";
import { createContractor, listContractors, PayrollConflict, updateContractor } from "@/lib/payroll/repository";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const unavailable = () => NextResponse.json({ error: "Payroll is unavailable. Configure storage and apply migration 0042." }, { status: 503, headers });
const fail = (e: unknown) => e instanceof PayrollConflict ? NextResponse.json({ error: e.message }, { status: 409, headers }) : unavailable();

// Saved contractor roster. Payout addresses are stored here and reviewed by the
// employer; batches can only pay addresses from this roster.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req); if (!auth.ok) return auth.res;
  const limited = await rateLimitOr429(req, "payroll.contractors.read", { limit: 60, windowMs: 60_000 }, auth.account.user.id); if (limited) return limited;
  try { return NextResponse.json({ contractors: await listContractors(auth.account.user.id) }, { headers }); }
  catch (e) { return fail(e); }
}
export async function POST(req: NextRequest) {
  const auth = await requireUser(req); if (!auth.ok) return auth.res;
  const limited = await rateLimitOr429(req, "payroll.contractors.write", { limit: 30, windowMs: 60_000 }, auth.account.user.id); if (limited) return limited;
  const input = await validateBody(req, contractorSchema); if (input instanceof NextResponse) return input;
  try { return NextResponse.json({ contractor: await createContractor(auth.account.user.id, input) }, { status: 201, headers }); }
  catch (e) { return fail(e); }
}
export async function PATCH(req: NextRequest) {
  const auth = await requireUser(req); if (!auth.ok) return auth.res;
  const limited = await rateLimitOr429(req, "payroll.contractors.write", { limit: 30, windowMs: 60_000 }, auth.account.user.id); if (limited) return limited;
  const input = await validateBody(req, contractorPatchSchema); if (input instanceof NextResponse) return input;
  try {
    const contractor = await updateContractor(auth.account.user.id, input);
    return NextResponse.json(contractor ? { contractor } : { error: "Contractor not found" }, { status: contractor ? 200 : 404, headers });
  } catch (e) { return fail(e); }
}
