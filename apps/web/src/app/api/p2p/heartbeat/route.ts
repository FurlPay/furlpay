import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { reportOnline } from "@/lib/services/p2p";

export const dynamic = "force-dynamic";

// POST /api/p2p/heartbeat — the maker's "I'm at my desk" ping. Drives the
// online dot on ads; takers avoid makers who cannot release right now.
// No body: presence is the fact that an authenticated call arrived.
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const limited = await rateLimitOr429(req, "p2p.heartbeat", { limit: 30, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;

  reportOnline(auth.account.user.id);
  return NextResponse.json({ ok: true });
}
