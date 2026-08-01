import { NextRequest, NextResponse } from "next/server";
import { getOnrampSession } from "@/lib/services/onramp";

export const dynamic = "force-dynamic";

// GET /api/onramp/session/:id — poll a headless on-ramp session's status.
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = getOnrampSession(params.id);
  if (!session) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(session);
}
