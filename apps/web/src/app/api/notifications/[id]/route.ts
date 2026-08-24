import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { validateBody } from "@/lib/validate";
import { NotificationPatchSchema } from "@/lib/schemas";
import { markRead } from "@/lib/services/notifications";

export const dynamic = "force-dynamic";

// PATCH /api/notifications/:id — mark one notification read.
//
// IDOR: `markRead` filters on id AND user_id, so a caller passing another
// user's notification id updates nothing. The 404 below is deliberately the
// same response for "does not exist" and "belongs to somebody else" — a
// distinguishable error would turn this endpoint into an id oracle that
// confirms which notifications exist on other accounts.
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const body = await validateBody(req, NotificationPatchSchema);
  if (body instanceof NextResponse) return body;

  const { id } = await props.params;
  const ok = await markRead(auth.claims.sub, id);
  if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({ id, read: true });
}
