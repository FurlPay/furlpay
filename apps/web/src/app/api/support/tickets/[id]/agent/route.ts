import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/authz";
import { validateBody } from "@/lib/validate";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { addMessage, findTicketOwner, getTicketForUser, setTicketStatus, TICKET_STATUSES } from "@/lib/support";
import { sendPushToUser } from "@/lib/push";
import { recordSecurityEvent } from "@/lib/ops/events";

// POST /api/support/tickets/[id]/agent — support-agent reply and/or status
// change. Admin-role only (requireRole enforces the single FURLPAY_ADMIN_EMAIL
// account). The reply is recorded as an `agent` message — the app renders it
// as a human agent, and this route must never be wired to AI output.
// The customer is push-notified (FCM/web-push; fails soft when unconfigured)
// and the in-app inbox picks the push up on delivery.

const Schema = z
  .object({
    body: z.string().trim().min(1).max(5000).optional(),
    status: z.enum(TICKET_STATUSES).optional(),
  })
  .refine((v) => v.body !== undefined || v.status !== undefined, {
    message: "Provide a reply body, a status, or both",
  });

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireRole(req, "admin");
  if (!auth.ok) return auth.res;
  const limited = await rateLimitOr429(req, "support.ticket.agent", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const body = await validateBody(req, Schema);
  if (body instanceof NextResponse) return body;

  const ownerId = await findTicketOwner(params.id);
  if (!ownerId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ticket = await getTicketForUser(ownerId, params.id);
  if (!ticket) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let updated = ticket;
  if (body.body) {
    const res = await addMessage({ ownerUserId: ownerId, ticketId: ticket.id, author: "agent", body: body.body });
    if (res.ticket) updated = res.ticket;
  }
  if (body.status) {
    const res = await setTicketStatus(ownerId, ticket.id, body.status);
    if (res) updated = res;
  }

  await recordSecurityEvent({
    kind: "support_agent_action",
    rail: "transfers",
    severity: "info",
    detail: `[${ticket.category}] ${ticket.id}: ${body.body ? "reply" : ""}${body.body && body.status ? "+" : ""}${body.status ?? ""}`,
    actor: auth.account.user.id,
  }).catch(() => {});

  // Fails soft: push being unconfigured must not block the reply itself.
  await sendPushToUser(ownerId, {
    title: "FurlPay Support",
    body: body.body ? body.body.slice(0, 140) : `Your ticket is now ${body.status}.`,
    url: `/support/${ticket.id}`,
    tag: `support-${ticket.id}`,
  }).catch(() => {});

  return NextResponse.json({ ticket: updated });
}
