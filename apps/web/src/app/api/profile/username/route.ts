import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { validateBody } from "@/lib/validate";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { audit } from "@/lib/audit";
import { setAccountUsername } from "@/lib/username";

export const dynamic = "force-dynamic";

// PUT /api/profile/username — set, change or clear (null) YOUR username.
//
// The account is always the session subject: the body carries only the name,
// and a body naming a user is rejected by the strict schema, so nobody can set
// another account's username. Rules and uniqueness: lib/username.ts and
// migration 0029 (the unique index decides races).
//
//   200 { username }            saved (or unchanged)
//   400 { error: "invalid" }    fails the rules, with a human detail
//   409 { error: "taken" }      held by another account or wallet handle
//   503 { error: "unavailable"} the store cannot take it (e.g. 0029 not applied)
const Body = z.object({ username: z.string().max(64).nullable() }).strict();

export async function PUT(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  // Renames are rare; a tight budget also stops name enumeration through 409s.
  const limited = await rateLimitOr429(req, "profile.username", { limit: 10, windowMs: 10 * 60_000 });
  if (limited) return limited;

  const body = await validateBody(req, Body, { maxBytes: 1024 });
  if (body instanceof NextResponse) return body;

  const r = await setAccountUsername(auth.account, body.username);
  if (!r.ok) {
    const status = r.reason === "invalid" ? 400 : r.reason === "taken" ? 409 : 503;
    return NextResponse.json({ error: r.reason, detail: r.detail }, { status, headers: { "cache-control": "no-store" } });
  }
  audit("profile.username_changed", auth.account.user.id);
  return NextResponse.json({ username: r.username }, { headers: { "cache-control": "no-store" } });
}
