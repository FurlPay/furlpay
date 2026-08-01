import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { validateBody } from "@/lib/validate";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { getTicketForUser, listMessages, setTicketStatus } from "@/lib/support";

// /api/support/tickets/[id] — one ticket + its conversation, owner-only.
// Non-owners get 404 (same as nonexistent), so ticket ids are not an oracle.

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const limited = await rateLimitOr429(req, "support.ticket.read", { limit: 120, windowMs: 60_000 });
  if (limited) return limited;

  const ticket = await getTicketForUser(auth.account.user.id, params.id);
  if (!ticket) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const messages = await listMessages(ticket.id);
  return NextResponse.json({ ticket, messages });
}

// The ONLY status transition the owner may perform is closing their own
// ticket. Everything else (in_progress, resolved, …) is support-side truth
// and goes through the agent route.
const PatchSchema = z.object({ status: z.literal("closed") });

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const limited = await rateLimitOr429(req, "support.ticket.patch", { limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  const body = await validateBody(req, PatchSchema);
  if (body instanceof NextResponse) return body;

  const ticket = await getTicketForUser(auth.account.user.id, params.id);
  if (!ticket) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const updated = await setTicketStatus(auth.account.user.id, ticket.id, "closed");
  return NextResponse.json({ ticket: updated });
}
