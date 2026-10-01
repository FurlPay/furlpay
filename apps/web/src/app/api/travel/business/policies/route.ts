import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { demoOnlyUnavailable } from "@/lib/demoGate";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
export const dynamic = "force-dynamic";
import { getTeam, updatePolicy, SpendingPolicy } from "@/lib/travel/business";

// The policy belongs to an ownerless in-memory team (see ../team): anyone could
// rewrite any team's approval threshold and MCC locks anonymously. Demo-only
// until teams are owned and persisted.
const POLICY_REASON = "Business travel policies have no owner or durable store yet.";

// GET /api/travel/business/policies?teamId=<id> — current spending policy.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "travel.business.policies", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const gate = demoOnlyUnavailable("Business travel policies", POLICY_REASON);
  if (gate) return gate;

  const team = getTeam(req.nextUrl.searchParams.get("teamId") ?? undefined);
  if (!team) return NextResponse.json({ error: "Team not found." }, { status: 404 });
  return NextResponse.json({ teamId: team.id, policy: team.policy });
}

const PolicyPatch = z.object({
  teamId: z.string().max(80).optional(),
  perTripBudgetUsd: z.number().nonnegative().max(1_000_000).optional(),
  maxHotelStars: z.number().int().min(1).max(5).optional(),
  maxFlightCabin: z.enum(["Economy", "Premium", "Business", "First"]).optional(),
  approvalThresholdUsd: z.number().nonnegative().max(1_000_000).optional(),
  mccLocks: z.array(z.string().regex(/^\d{4}$/)).max(50).optional(),
});

// PATCH /api/travel/business/policies — update spending policy fields.
// Body: { teamId?, perTripBudgetUsd?, maxHotelStars?, maxFlightCabin?,
//         approvalThresholdUsd?, mccLocks? }
export async function PATCH(req: NextRequest) {
  const limited = await rateLimitOr429(req, "travel.business.policies.update", { limit: 20, windowMs: 60_000 });
  if (limited) return limited;
  const gate = demoOnlyUnavailable("Business travel policies", POLICY_REASON);
  if (gate) return gate;

  const body = await validateBody(req, PolicyPatch, { maxBytes: 8 * 1024 });
  if (body instanceof NextResponse) return body;
  const { teamId = "team_demo", ...rest } = body;
  const patch: Partial<SpendingPolicy> = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));

  const team = updatePolicy(teamId, patch);
  if (!team) return NextResponse.json({ error: "Team not found." }, { status: 404 });
  return NextResponse.json({ teamId: team.id, policy: team.policy });
}
