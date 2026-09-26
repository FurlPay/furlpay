import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { retrieveDisclosurePackage } from "@/lib/compliance/authorityRequest";

export const dynamic = "force-dynamic";

const DiscloseBodySchema = z.object({
  token: z.string().trim().min(30).max(128),
});

// POST /api/compliance/authority-requests/[id]/disclose
// Redeems the single-use, cryptographically signed disclosure token.
// The token is burned immediately to prevent replay, and an immutable audit event is appended.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const limited = await rateLimitOr429(req, "compliance.auth_req.disclose", {
    limit: 10,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const { id } = await props.params;
  const body = await validateBody(req, DiscloseBodySchema);
  if (body instanceof NextResponse) return body;

  try {
    const pkg = await retrieveDisclosurePackage(id, body.token);
    return NextResponse.json({
      ok: true,
      disclosurePackage: pkg,
      notice: "This disclosure package has been released under authorized statutory authority. This access token has now been permanently invalidated.",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Disclosure retrieval failed.";
    return NextResponse.json({ ok: false, error: msg }, { status: 403 });
  }
}
