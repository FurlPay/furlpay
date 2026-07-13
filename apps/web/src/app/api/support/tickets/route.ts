import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { validateBody } from "@/lib/validate";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { createTicket, listTickets, TICKET_CATEGORIES } from "@/lib/support";

// /api/support/tickets — authenticated ticket registry. The anonymous path
// stays /api/support/message (chat bubble → mailbox); accounts get durable,
// listable tickets with compliance routing.

const CreateSchema = z.object({
  category: z.enum(TICKET_CATEGORIES),
  subject: z.string().trim().min(4).max(120),
  body: z.string().trim().min(10).max(5000),
});

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  // Authenticated, but ticket spam is still spam.
  const limited = await rateLimitOr429(req, "support.tickets", { limit: 5, windowMs: 10 * 60_000 });
  if (limited) return limited;

  const body = await validateBody(req, CreateSchema);
  if (body instanceof NextResponse) return body;

  const user = auth.account.user;
  const ticket = await createTicket({
    userId: user.id,
    email: user.email,
    category: body.category,
    subject: body.subject,
    body: body.body,
  });
  return NextResponse.json({ ticket }, { status: 201 });
}

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const tickets = await listTickets(auth.account.user.id);
  return NextResponse.json({ tickets });
}
