import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { markAllRead } from "@/lib/services/notifications";

export const dynamic = "force-dynamic";

// POST /api/notifications/read-all — clear the unread badge in one call.
//
// Rate limited per user rather than per IP. This is an unbounded UPDATE over
// one user's unread rows: cheap when clicked once, a way to make Postgres do
// pointless work when scripted. 5/min is far above any human use of a button
// that has nothing left to do after the first press.
//
// No body: the route takes no parameters and accepts none, so there is nothing
// to validate. Adding a schema for an empty object would be ceremony, not
// safety — the closed contract IS that it reads no input.
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const limited = await rateLimitOr429(
    req,
    "notifications.readAll",
    { limit: 5, windowMs: 60_000 },
    auth.claims.sub
  );
  if (limited) return limited;

  const updated = await markAllRead(auth.claims.sub);
  return NextResponse.json({ updated });
}
