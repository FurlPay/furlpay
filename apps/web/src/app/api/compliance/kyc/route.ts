import { NextRequest, NextResponse } from "next/server";
import { readJsonBody } from "@/lib/validate";
import { z } from "zod";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { getIdentityProvider } from "@/lib/compliance/providers/factory";
import { getCountryRule } from "@/lib/compliance/ruleEngine";
import { kvIncr } from "@/lib/kv";

// Every call opens a session at a paid identity provider, and the caller has
// no account. The per-IP limit alone is not a budget: it is per address, and
// addresses are cheap. This is the ceiling on what anonymous callers can open
// across ALL addresses in an hour. Past it the route refuses rather than keep
// spending; a signed-in user verifies through /api/compliance/verify, which is
// bound to their account and unaffected.
const ANON_SESSIONS_PER_HOUR = (() => {
  const n = Number(process.env.KYC_ANON_SESSIONS_PER_HOUR);
  return Number.isInteger(n) && n > 0 ? n : 200;
})();

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
  const limited = await rateLimitOr429(req, "compliance.kyc", { limit: 5, windowMs: 600_000 });
  if (limited) return limited;

  const parsed = KycBody.safeParse(await readJsonBody(req));
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

  // Counted only for requests that would actually reach the provider. If the
  // counter cannot be read the route fails closed: an unmetered paid call is
  // the thing this exists to prevent.
  let opened: number;
  try {
    opened = await kvIncr("kyc:anon:sessions", 3600);
  } catch {
    return NextResponse.json({ error: "verification_unavailable" }, { status: 503 });
  }
  if (opened > ANON_SESSIONS_PER_HOUR) {
    return NextResponse.json(
      { error: "verification_busy", detail: "Identity verification is busy. Try again later." },
      { status: 503, headers: { "Retry-After": "600" } },
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
