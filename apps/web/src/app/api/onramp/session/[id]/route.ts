import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { getOnrampSession } from "@/lib/services/onramp";

export const dynamic = "force-dynamic";

// GET /api/onramp/session/:id — poll a headless on-ramp session's status.
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const limited = await rateLimitOr429(req, "onramp.session.id", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const params = await props.params;
  const session = getOnrampSession(params.id);
  if (!session) return NextResponse.json({ error: "not_found" }, { status: 404 });
  // Never the clientSecret: it is returned once, at creation, to the creator.
  // A poll by id is not proof of being that creator, and echoing the secret
  // here would make the id alone sufficient to act on the session.
  const { clientSecret: _secret, ...status } = session;
  return NextResponse.json(status);
}
