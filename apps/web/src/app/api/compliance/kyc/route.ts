import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { getIdentityProvider } from "@/lib/compliance/providers/factory";
import { getCountryRule } from "@/lib/compliance/ruleEngine";

const KycBody = z.object({
  fullName: z.string().min(1).max(200),
  dateOfBirth: z.string().max(20),
  documentNumber: z.string().min(1).max(100),
  country: z.string().length(2).optional(),
  selfieProvided: z.boolean().optional(),
});

// POST /api/compliance/kyc — start identity verification via Persona/Sumsub.
// Public route (runs during signup before a session exists).
export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "compliance.kyc", { limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  const parsed = KycBody.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.errors },
      { status: 400 },
    );
  }

  const { fullName, country } = parsed.data;
  const code = (country ?? "US").toUpperCase();
  const rule = getCountryRule(code);

  if (rule.autoBlock) {
    return NextResponse.json(
      { error: "Verification not available for this jurisdiction" },
      { status: 403 },
    );
  }

  const provider = await getIdentityProvider();
  const ref = crypto.randomUUID();

  const session = await provider.startVerification(fullName, {
    requiredDocs: rule.requiredDocs,
    requiredChecks: rule.requiredChecks,
    referenceId: ref,
    country: code,
  });

  return NextResponse.json({
    sessionId: session.sessionId,
    sessionUrl: session.sessionUrl,
    provider: provider.name,
    requiredDocs: rule.requiredDocs,
    requiredChecks: rule.requiredChecks,
  });
}
