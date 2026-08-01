import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { getTrip } from "@/lib/travel/store";
import { requireUser } from "@/lib/authz";

// GET /api/travel/trips/:id — a single trip's details (powers booking/[id]).
// Scoped to the caller: someone else's booking id 404s rather than resolving.
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const trip = getTrip(params.id, auth.account.user.id);
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  return NextResponse.json({ trip });
}
