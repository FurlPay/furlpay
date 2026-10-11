import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { PayrollConflict } from "@/lib/payroll/repository";
import { myContractorProfiles, payoutAddressSchema, setPayoutAddress } from "@/lib/payroll/selfService";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
// The contractor's own payroll profiles (one per employer that invited them).
export async function GET(req: NextRequest) {
  const auth = await requireUser(req); if (!auth.ok) return auth.res;
  const limited = await rateLimitOr429(req, "payroll.me.read", { limit: 60, windowMs: 60_000 }, auth.account.user.id); if (limited) return limited;
  try { return NextResponse.json({ profiles: await myContractorProfiles(auth.account.user.id) }, { headers }); }
  catch { return NextResponse.json({ error: "Payroll is unavailable right now." }, { status: 503, headers }); }
}
// PATCH {contractorId, payoutAddress, signature}: the new address must sign the registration message.
export async function PATCH(req: NextRequest) {
  const auth = await requireUser(req); if (!auth.ok) return auth.res;
  const limited = await rateLimitOr429(req, "payroll.me.address", { limit: 5, windowMs: 60_000 }, auth.account.user.id); if (limited) return limited;
  const input = await validateBody(req, payoutAddressSchema); if (input instanceof NextResponse) return input;
  try {
    const out = await setPayoutAddress(auth.account.user.id, input);
    return NextResponse.json(out ? { profile: out } : { error: "Profile not found" }, { status: out ? 200 : 404, headers });
  } catch (e) {
    if (e instanceof PayrollConflict) return NextResponse.json({ error: e.message }, { status: 409, headers });
    return NextResponse.json({ error: "Payroll is unavailable right now." }, { status: 503, headers });
  }
}
