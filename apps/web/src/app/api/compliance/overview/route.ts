import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { sbCount, supabaseBackend } from "@/lib/supabase";
import { listStates } from "@/lib/settlement/onboardingStore";
import { capabilities, complianceHealth, summarizeOnboarding, type OnboardingSummary } from "@/lib/compliance/overview";

// GET /api/compliance/overview — Compliance & Risk overview for compliance
// officers. Every figure is from a durable record or a configuration fact;
// a source that is unavailable is reported as null with the reason, never as 0.
export const dynamic = "force-dynamic";

const CASE_LIMIT = 500;

async function userCounts(): Promise<{ total: number | null; verified: number | null; unavailable?: string }> {
  if (supabaseBackend !== "supabase") return { total: null, verified: null, unavailable: "No durable user store is configured on this deployment." };
  try {
    const [total, verified] = await Promise.all([sbCount("users", "select=id"), sbCount("users", "select=id&kyc_status=eq.verified")]);
    return { total, verified };
  } catch {
    return { total: null, verified: null, unavailable: "The user store did not respond." };
  }
}

export async function GET(req: NextRequest) {
  const auth = await requireRole(req, "compliance_officer");
  if (!auth.ok) return auth.res;
  const limited = await rateLimitOr429(req, "compliance.overview", { limit: 60, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;

  const caps = capabilities();
  let onboarding: (OnboardingSummary & { truncated: boolean }) | null = null;
  let onboardingUnavailable: string | undefined;
  try {
    const rows = await listStates(CASE_LIMIT);
    onboarding = { ...summarizeOnboarding(rows.map((r) => r.state)), truncated: rows.length >= CASE_LIMIT };
  } catch (e) {
    onboardingUnavailable = e instanceof Error ? e.message : "Onboarding records are unavailable.";
  }
  const users = await userCounts();

  return NextResponse.json(
    {
      generatedAt: new Date().toISOString(),
      users,
      onboarding,
      onboardingUnavailable,
      capabilities: caps,
      health: complianceHealth(caps, onboarding),
      // Not recorded by any system in this repository — reported as such.
      settlement: { usdcSettled30d: null, unavailable: "Settlement execution is not implemented; no settled volume is recorded." },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
