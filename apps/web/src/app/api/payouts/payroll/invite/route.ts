import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { PayrollConflict } from "@/lib/payroll/repository";
import { acceptInvite, previewInvite } from "@/lib/payroll/selfService";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
// POST {token, action: "preview" | "accept"}: the signed-in contractor's side of an invite.
// Accepting requires the account email to match the roster email.
export async function POST(req: NextRequest) {
  const auth = await requireUser(req); if (!auth.ok) return auth.res;
  // Tokens are 256-bit; the tight budget still makes guessing attempts cheap to stop.
  const limited = await rateLimitOr429(req, "payroll.invite.redeem", { limit: 10, windowMs: 60_000 }, auth.account.user.id); if (limited) return limited;
  const input = await validateBody(req, z.object({ token: z.string().max(64), action: z.enum(["preview", "accept"]) }).strict()); if (input instanceof NextResponse) return input;
  const user = { id: auth.account.user.id, email: auth.account.user.email };
  try {
    return NextResponse.json(input.action === "preview" ? await previewInvite(input.token, user) : await acceptInvite(input.token, user), { headers });
  } catch (e) {
    if (e instanceof PayrollConflict) return NextResponse.json({ error: e.message }, { status: 409, headers });
    return NextResponse.json({ error: "Payroll is unavailable right now." }, { status: 503, headers });
  }
}
