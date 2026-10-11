import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { PayrollConflict } from "@/lib/payroll/repository";
import { createInvite } from "@/lib/payroll/selfService";
// The configured public origin, never the request's Host header: a spoofed Host must not mint invite links to another site.
import { publicOrigin } from "@/lib/publicOrigin";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
// POST: a single-use, 7-day invite link for a roster contractor. The employer shares it;
// FurlPay sends no email. The token rides in the URL fragment, so it never reaches a server log.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req); if (!auth.ok) return auth.res;
  const limited = await rateLimitOr429(req, "payroll.invite", { limit: 20, windowMs: 60_000 }, auth.account.user.id); if (limited) return limited;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid contractor ID" }, { status: 400, headers });
  try {
    const invite = await createInvite(auth.account.user.id, id);
    return NextResponse.json({ url: `${publicOrigin(req)}/payroll/join#t=${invite.token}`, expiresAt: invite.expiresAt, email: invite.email }, { status: 201, headers });
  } catch (e) {
    if (e instanceof PayrollConflict) return NextResponse.json({ error: e.message }, { status: 409, headers });
    return NextResponse.json({ error: "Payroll is unavailable. Configure storage and apply migration 0044." }, { status: 503, headers });
  }
}
