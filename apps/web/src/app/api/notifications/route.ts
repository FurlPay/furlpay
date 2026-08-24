import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { NotificationListSchema } from "@/lib/schemas";
import { listNotifications } from "@/lib/services/notifications";

export const dynamic = "force-dynamic";

// GET /api/notifications — the session user's notification history, newest
// first, keyset-paginated.
//
// The user id comes from the session and is never accepted from the query
// string. There is no `?userId=` on this route by design: the service layer
// scopes every read by owner, and the only owner this route will ever pass is
// the authenticated one.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  // Query parameters are validated with the same rigour as a body — `before`
  // is interpolated into a PostgREST filter, so "it's only a GET" is not a
  // reason to trust it.
  const parsed = NotificationListSchema.safeParse(
    Object.fromEntries(req.nextUrl.searchParams)
  );
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 }
    );
  }

  const page = await listNotifications(auth.claims.sub, parsed.data);
  return NextResponse.json(page);
}
