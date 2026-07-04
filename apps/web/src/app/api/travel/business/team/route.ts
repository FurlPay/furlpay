import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { createTeam, getTeam } from "@/lib/travel/business";

// GET /api/travel/business/team?id=<teamId> — fetch a team (demo team by default).
export async function GET(req: NextRequest) {
  const team = getTeam(req.nextUrl.searchParams.get("id") ?? undefined);
  if (!team) return NextResponse.json({ error: "Team not found." }, { status: 404 });
  return NextResponse.json({ team });
}

// POST /api/travel/business/team — create a business travel team.
// Body: { name, walletUsdc?, members?: [{ email, role }] }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!body.name || typeof body.name !== "string") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const team = createTeam(
    body.name.trim(),
    Math.max(0, Number(body.walletUsdc) || 0),
    Array.isArray(body.members) ? body.members : [],
  );
  return NextResponse.json({ team }, { status: 201 });
}
