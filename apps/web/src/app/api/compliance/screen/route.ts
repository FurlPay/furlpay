// ---------------------------------------------------------------------------
// POST /api/compliance/screen — AML / PEP / sanctions screening.
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { readJsonBody } from "@/lib/validate";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { kvSet } from "@/lib/kv";
import { getScreeningProvider } from "@/lib/compliance/providers/factory";

import { rateLimitOr429 } from "@/lib/rateLimit";

const Body = z.object({
  name: z.string().min(1).max(200),
  dateOfBirth: z.string().max(20).optional(),
  country: z.string().length(2).optional(),
  entityType: z.enum(["person", "company"]).default("person"),
  walletAddresses: z.array(z.string().max(200)).max(10).optional(),
});

export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "compliance.screen", { limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  // See the note in ../verify/route.ts: cookie-only auth locked the native app
  // out of its own compliance flow and skipped revocation/deletion/lock checks.
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const userId = auth.account.user.id;
  const parsed = Body.safeParse(await readJsonBody(req));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.errors },
      { status: 400 },
    );
  }

  const { name, dateOfBirth, country, entityType, walletAddresses } = parsed.data;
  const provider = await getScreeningProvider();
  const ref = crypto.randomUUID();

  const result = await provider.screenSanctions({
    name,
    dateOfBirth,
    country: country?.toUpperCase(),
    entityType,
    referenceId: ref,
    walletAddresses,
  });

  // Audit trail
  const auditId = crypto.randomUUID();
  await kvSet(`audit:screen:${auditId}`, {
    id: auditId,
    userId,
    action: "screen_sanctions",
    provider: provider.name,
    result: result.riskLevel,
    timestamp: Date.now(),
    metadata: {
      query: { name, dateOfBirth, country, entityType },
      matched: result.matched,
      hitCount: result.hits.length,
    },
  });

  return NextResponse.json({
    matched: result.matched,
    riskLevel: result.riskLevel,
    hits: result.hits,
    screenedAt: result.screenedAt,
    auditId,
  });
}
