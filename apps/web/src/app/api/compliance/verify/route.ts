// ---------------------------------------------------------------------------
// POST /api/compliance/verify — start identity verification for a user.
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { kvSet } from "@/lib/kv";
import { getCountryRule } from "@/lib/compliance/ruleEngine";
import { getIdentityProvider } from "@/lib/compliance/providers/factory";

import { rateLimitOr429 } from "@/lib/rateLimit";

const Body = z.object({
  country: z.string().length(2),
  referenceId: z.string().max(200).optional(),
});

export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "compliance.verify", { limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  // requireUser, not a cookie-only verifySession. Two reasons, both load-bearing:
  //  1. tokenFromRequest also accepts `Authorization: Bearer`, which is how the
  //     native app authenticates. Reading only the cookie made this route
  //     unreachable from Android — the app could display a KYC status it had no
  //     way to change.
  //  2. It applies the revocation denylist, deleted-account tombstone, account
  //     lock and MCP connector scopes. Starting an identity verification on a
  //     revoked session is exactly what those gates exist to stop.
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const userId = auth.account.user.id;
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.errors },
      { status: 400 },
    );
  }

  const { country, referenceId } = parsed.data;
  const code = country.toUpperCase();
  const rule = getCountryRule(code);

  if (rule.autoBlock) {
    return NextResponse.json(
      { error: "Verification not available for this jurisdiction" },
      { status: 403 },
    );
  }

  const provider = await getIdentityProvider();
  const ref = referenceId ?? crypto.randomUUID();

  const session = await provider.startVerification(userId, {
    requiredDocs: rule.requiredDocs,
    requiredChecks: rule.requiredChecks,
    referenceId: ref,
    country: code,
  });

  // Audit trail
  const auditId = crypto.randomUUID();
  await kvSet(`audit:verify:${auditId}`, {
    id: auditId,
    userId,
    action: "start_verification",
    provider: provider.name,
    result: session.status,
    timestamp: Date.now(),
    metadata: { sessionId: session.sessionId, country: code, rule },
  });

  return NextResponse.json({
    sessionId: session.sessionId,
    sessionUrl: session.sessionUrl,
    requiredDocs: rule.requiredDocs,
    requiredChecks: rule.requiredChecks,
    eddRequired: rule.eddRequired,
  });
}
