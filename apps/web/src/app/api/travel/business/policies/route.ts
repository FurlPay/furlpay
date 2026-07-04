import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { getTeam, updatePolicy, SpendingPolicy } from "@/lib/travel/business";

// GET /api/travel/business/policies?teamId=<id> — current spending policy.
export async function GET(req: NextRequest) {
  const team = getTeam(req.nextUrl.searchParams.get("teamId") ?? undefined);
  if (!team) return NextResponse.json({ error: "Team not found." }, { status: 404 });
  return NextResponse.json({ teamId: team.id, policy: team.policy });
}

// PATCH /api/travel/business/policies — update spending policy fields.
// Body: { teamId?, perTripBudgetUsd?, maxHotelStars?, maxFlightCabin?,
//         approvalThresholdUsd?, mccLocks? }
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const teamId = body.teamId ?? "team_demo";

  const patch: Partial<SpendingPolicy> = {};
  if (body.perTripBudgetUsd !== undefined) patch.perTripBudgetUsd = Math.max(0, Number(body.perTripBudgetUsd) || 0);
  if (body.maxHotelStars !== undefined) patch.maxHotelStars = Math.min(5, Math.max(1, Number(body.maxHotelStars) || 4));
  if (["Economy", "Premium", "Business", "First"].includes(body.maxFlightCabin)) patch.maxFlightCabin = body.maxFlightCabin;
  if (body.approvalThresholdUsd !== undefined) patch.approvalThresholdUsd = Math.max(0, Number(body.approvalThresholdUsd) || 0);
  if (Array.isArray(body.mccLocks)) patch.mccLocks = body.mccLocks.map(String);

  const team = updatePolicy(teamId, patch);
  if (!team) return NextResponse.json({ error: "Team not found." }, { status: 404 });
  return NextResponse.json({ teamId: team.id, policy: team.policy });
}
