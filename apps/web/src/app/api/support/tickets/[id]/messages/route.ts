import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { validateBody } from "@/lib/validate";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { kvGet, kvSet, kvSetNx } from "@/lib/kv";
import { addMessage, getTicketForUser, listMessages } from "@/lib/support";

// POST /api/support/tickets/[id]/messages — customer reply on their own
// ticket. Owner-only (404 otherwise); bodies pass secret redaction; an
// Idempotency-Key header makes retries after ambiguous timeouts safe — the
// same key returns the original message instead of duplicating it.

const Schema = z.object({
  body: z.string().trim().min(1).max(5000),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const limited = await rateLimitOr429(req, "support.ticket.message", { limit: 20, windowMs: 10 * 60_000 });
  if (limited) return limited;

  const body = await validateBody(req, Schema);
  if (body instanceof NextResponse) return body;

  const userId = auth.account.user.id;
  const ticket = await getTicketForUser(userId, params.id);
  if (!ticket) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const idem = req.headers.get("idempotency-key")?.trim();
  const idemKey = idem && /^[\w-]{8,64}$/.test(idem) ? `support:idem:msg:${userId}:${idem}` : null;
  if (idemKey) {
    const won = await kvSetNx(idemKey, "pending", 24 * 3600);
    if (!won) {
      // Replay of a key we've seen: return the message the first attempt
      // created (or 409 if it is still literally in flight).
      const existingId = await kvGet<string>(idemKey);
      const existing = (await listMessages(ticket.id)).find((m) => m.id === existingId);
      if (existing) return NextResponse.json({ message: existing, ticket, redactions: 0 });
      return NextResponse.json({ error: "Duplicate request — check the thread." }, { status: 409 });
    }
  }

  const result = await addMessage({ ownerUserId: userId, ticketId: ticket.id, author: "user", body: body.body });
  // Swap the pending marker for the real message id so replays can find it.
  if (idemKey) await kvSet(idemKey, result.message.id, 24 * 3600).catch(() => {});

  return NextResponse.json(
    { message: result.message, ticket: result.ticket, redactions: result.redactions },
    { status: 201 }
  );
}
