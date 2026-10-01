import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { demoOnlyUnavailable } from "@/lib/demoGate";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
export const dynamic = "force-dynamic";
import { createTeam, getTeam } from "@/lib/travel/business";

// Business travel teams live in a per-instance in-memory Map with no owner: any
// caller could create a team with a self-declared USDC wallet balance and read
// any team's member emails. Demo-only until teams are owned and persisted.
const TEAMS_REASON = "Business travel teams have no owner or durable store yet.";

// GET /api/travel/business/team?id=<teamId> — fetch a team (demo team by default).
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "travel.business.team", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const gate = demoOnlyUnavailable("Business travel teams", TEAMS_REASON);
  if (gate) return gate;

  const team = getTeam(req.nextUrl.searchParams.get("id") ?? undefined);
  if (!team) return NextResponse.json({ error: "Team not found." }, { status: 404 });
  return NextResponse.json({ team });
}

const CreateTeam = z.object({
  name: z.string().trim().min(1).max(80),
  walletUsdc: z.number().nonnegative().max(1_000_000).optional(),
  members: z
    .array(z.object({ email: z.string().email().max(254), role: z.enum(["admin", "traveler"]) }))
    .max(50)
    .optional(),
});

// POST /api/travel/business/team — create a business travel team.
// Body: { name, walletUsdc?, members?: [{ email, role }] }
export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "travel.business.team.create", { limit: 10, windowMs: 600_000 });
  if (limited) return limited;
  const gate = demoOnlyUnavailable("Business travel teams", TEAMS_REASON);
  if (gate) return gate;

  const body = await validateBody(req, CreateTeam, { maxBytes: 16 * 1024 });
  if (body instanceof NextResponse) return body;
  const team = createTeam(body.name, body.walletUsdc ?? 0, body.members ?? []);
  return NextResponse.json({ team }, { status: 201 });
}
