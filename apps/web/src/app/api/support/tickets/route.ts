import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { validateBody } from "@/lib/validate";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { kvGet, kvSet, kvSetNx } from "@/lib/kv";
import { createTicket, listTickets, TICKET_CATEGORIES } from "@/lib/support";

// /api/support/tickets — authenticated ticket registry. The anonymous path
// stays /api/support/message (chat bubble → mailbox); accounts get durable,
// listable tickets with compliance routing.

// Safe system references only — short, shape-checked, never secrets. The app
// attaches these itself (e.g. the selected transaction) so users don't have to
// copy technical ids by hand.
const RefsSchema = z
  .object({
    correlationId: z.string().regex(/^[\w-]{1,64}$/).optional(),
    transactionId: z.string().regex(/^[\w:.-]{1,80}$/).optional(),
    txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
    bookingId: z.string().regex(/^[\w-]{1,64}$/).optional(),
    cardEventId: z.string().regex(/^[\w-]{1,64}$/).optional(),
  })
  .strict()
  .optional();

const CreateSchema = z.object({
  category: z.enum(TICKET_CATEGORIES),
  subject: z.string().trim().min(4).max(120),
  body: z.string().trim().min(10).max(5000),
  refs: RefsSchema,
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

  // Idempotent create: a retry after an ambiguous timeout returns the ticket
  // the first attempt made instead of filing a duplicate.
  const idem = req.headers.get("idempotency-key")?.trim();
  const idemKey = idem && /^[\w-]{8,64}$/.test(idem) ? `support:idem:tkt:${user.id}:${idem}` : null;
  if (idemKey) {
    const won = await kvSetNx(idemKey, "pending", 24 * 3600);
    if (!won) {
      const existingId = await kvGet<string>(idemKey);
      const existing = (await listTickets(user.id)).find((t) => t.id === existingId);
      if (existing) return NextResponse.json({ ticket: existing, redactions: 0 });
      return NextResponse.json({ error: "Duplicate request — check your tickets." }, { status: 409 });
    }
  }

  const { redactions, ...ticket } = await createTicket({
    userId: user.id,
    email: user.email,
    category: body.category,
    subject: body.subject,
    body: body.body,
    refs: body.refs,
  });
  if (idemKey) await kvSet(idemKey, ticket.id, 24 * 3600).catch(() => {});
  return NextResponse.json(
    {
      ticket,
      // Non-zero when a card number / seed phrase / API token was stripped
      // server-side — the UI tells the user so they aren't surprised.
      redactions,
    },
    { status: 201 }
  );
}

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const limited = await rateLimitOr429(req, "support.tickets.read", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const tickets = await listTickets(auth.account.user.id);
  return NextResponse.json({ tickets });
}
