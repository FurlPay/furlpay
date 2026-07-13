import { randomUUID } from "crypto";
import { kvGet, kvSet, kvListPush } from "@/lib/kv";
import { recordSecurityEvent } from "@/lib/ops/events";
import { sendEmail } from "@/lib/email";

// ---------------------------------------------------------------------------
// Support tickets — stored in OUR kv layer, not a support SaaS, so transaction
// hashes and account details never leave the vault (the compliance reason a
// regulated stablecoin product self-hosts support data). The Zendesk JWT SSO
// route (/api/support/sso) exists for the day an enterprise partner mandates a
// SOC2 help desk; until then this registry IS the help desk.
//
// Category routing mirrors the ops queues: kyc-category tickets also land in
// the ops:security feed so compliance sees them without watching a mailbox.
// ---------------------------------------------------------------------------

export const TICKET_CATEGORIES = [
  "stablecoins", // deposits, bridging delays, gas sponsorship
  "cards", // freezes, limits, 3DS failures, chargebacks
  "kyc", // tier onboarding, document resubmission, country restrictions
  "travel", // cancellations, refunds on stablecoin rails
  "developers", // API auth, webhooks, x402 gateway integration
  "other",
] as const;

export type TicketCategory = (typeof TICKET_CATEGORIES)[number];
export type TicketStatus = "open" | "resolved";

export interface SupportTicket {
  id: string;
  userId: string;
  email: string;
  category: TicketCategory;
  subject: string;
  body: string;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
}

const userKey = (userId: string) => `support:tickets:${userId}`;
const RECENT_FEED = "support:tickets:recent"; // bounded ops-side feed
const MAX_PER_USER = 50;

export async function listTickets(userId: string): Promise<SupportTicket[]> {
  return (await kvGet<SupportTicket[]>(userKey(userId))) ?? [];
}

export async function createTicket(input: {
  userId: string;
  email: string;
  category: TicketCategory;
  subject: string;
  body: string;
}): Promise<SupportTicket> {
  const now = new Date().toISOString();
  const ticket: SupportTicket = {
    id: `tkt_${randomUUID().slice(0, 12)}`,
    userId: input.userId,
    email: input.email,
    category: input.category,
    subject: input.subject,
    body: input.body,
    status: "open",
    createdAt: now,
    updatedAt: now,
  };

  const existing = await listTickets(input.userId);
  await kvSet(userKey(input.userId), [ticket, ...existing].slice(0, MAX_PER_USER));
  await kvListPush(RECENT_FEED, JSON.stringify(ticket), 1000).catch(() => {});

  // Compliance queue: KYC tickets are visible in the ops security feed, not
  // only a mailbox — support actions on regulated state need an ops-side trail.
  // (The feed is rail-keyed; account-level events ride "transfers".)
  if (ticket.category === "kyc") {
    await recordSecurityEvent({
      kind: "kyc_support_ticket",
      rail: "transfers",
      severity: "info",
      detail: `Support ticket ${ticket.id}: ${ticket.subject.slice(0, 120)}`,
      actor: input.userId,
    }).catch(() => {});
  }

  // Notify the support inbox. Ticket creation must not fail on mail problems —
  // the ticket is already durably stored.
  const bodyText = `From: ${input.email} (user ${input.userId})\nCategory: ${ticket.category}\n\n${ticket.body}`;
  await sendEmail({
    to: process.env.SUPPORT_INBOX || "support@furlpay.com",
    category: "support",
    replyTo: input.email,
    subject: `[${ticket.category}] ${ticket.subject} (${ticket.id})`,
    text: bodyText,
    html: `<pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(bodyText)}</pre>`,
  }).catch(() => {});

  return ticket;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
