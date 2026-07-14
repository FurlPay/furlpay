import { randomUUID } from "crypto";
import { kvGet, kvSet, kvListPush } from "@/lib/kv";
import { recordSecurityEvent } from "@/lib/ops/events";
import { redactSecrets } from "@/lib/redact";
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

// Full lifecycle. Pre-existing tickets carry "open"/"resolved", which remain
// valid members — no migration needed.
export const TICKET_STATUSES = [
  "open",
  "waiting_support", // customer replied, ball in support's court
  "waiting_customer", // support replied / asked for more information
  "in_progress",
  "resolved",
  "closed",
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** Safe references tying a ticket to system objects for incident
 *  reconstruction (ticket → payment → txHash → chain). Never secrets. */
export interface TicketRefs {
  correlationId?: string;
  transactionId?: string;
  txHash?: string;
  bookingId?: string;
  cardEventId?: string;
}

export interface SupportTicket {
  id: string;
  userId: string;
  email: string;
  category: TicketCategory;
  subject: string;
  body: string;
  status: TicketStatus;
  refs?: TicketRefs;
  createdAt: string;
  updatedAt: string;
}

export type MessageAuthor = "user" | "agent" | "system";

export interface SupportMessage {
  id: string;
  ticketId: string;
  author: MessageAuthor;
  body: string;
  createdAt: string;
}

const userKey = (userId: string) => `support:tickets:${userId}`;
const ownerKey = (ticketId: string) => `support:owner:${ticketId}`;
const msgsKey = (ticketId: string) => `support:msgs:${ticketId}`;
const RECENT_FEED = "support:tickets:recent"; // bounded ops-side feed
const MAX_PER_USER = 50;
const MAX_MESSAGES = 200;

export async function listTickets(userId: string): Promise<SupportTicket[]> {
  return (await kvGet<SupportTicket[]>(userKey(userId))) ?? [];
}

/**
 * Ownership-checked ticket lookup — THE anti-IDOR primitive for the /[id]
 * routes. Resolves only when `userId` owns `ticketId`; anyone else gets null
 * (routes return 404, not 403, so ticket ids don't become an oracle).
 * Falls back to scanning the caller's own list for pre-index tickets, and
 * backfills the owner index when found.
 */
export async function getTicketForUser(userId: string, ticketId: string): Promise<SupportTicket | null> {
  const owner = await kvGet<string>(ownerKey(ticketId));
  if (owner !== null && owner !== userId) return null;
  const ticket = (await listTickets(userId)).find((t) => t.id === ticketId) ?? null;
  if (ticket && owner === null) await kvSet(ownerKey(ticketId), userId).catch(() => {});
  return ticket;
}

/** Owner of a ticket (agent-side lookup). Null for unknown/pre-index tickets. */
export async function findTicketOwner(ticketId: string): Promise<string | null> {
  return kvGet<string>(ownerKey(ticketId));
}

export async function listMessages(ticketId: string): Promise<SupportMessage[]> {
  return (await kvGet<SupportMessage[]>(msgsKey(ticketId))) ?? [];
}

async function updateTicket(
  userId: string,
  ticketId: string,
  patch: Partial<Pick<SupportTicket, "status" | "updatedAt">>
): Promise<SupportTicket | null> {
  const tickets = await listTickets(userId);
  const idx = tickets.findIndex((t) => t.id === ticketId);
  if (idx === -1) return null;
  const updated = { ...tickets[idx], ...patch, updatedAt: new Date().toISOString() };
  tickets[idx] = updated;
  await kvSet(userKey(userId), tickets);
  return updated;
}

/**
 * Append a message to a ticket's conversation and advance the lifecycle:
 * a customer message puts the ball in support's court (and re-opens a
 * resolved/closed ticket); an agent message means waiting on the customer.
 * System messages never change status. Message bodies pass the same secret
 * redaction as ticket bodies. Ownership must be checked by the CALLER
 * (getTicketForUser / findTicketOwner) before calling this.
 */
export async function addMessage(input: {
  ownerUserId: string;
  ticketId: string;
  author: MessageAuthor;
  body: string;
}): Promise<{ message: SupportMessage; ticket: SupportTicket | null; redactions: number }> {
  const clean = redactSecrets(input.body);
  const message: SupportMessage = {
    id: `msg_${randomUUID().slice(0, 12)}`,
    ticketId: input.ticketId,
    author: input.author,
    body: clean.text,
    createdAt: new Date().toISOString(),
  };
  const existing = await listMessages(input.ticketId);
  await kvSet(msgsKey(input.ticketId), [...existing, message].slice(-MAX_MESSAGES));

  let ticket: SupportTicket | null = null;
  if (input.author === "user") {
    ticket = await updateTicket(input.ownerUserId, input.ticketId, { status: "waiting_support" });
  } else if (input.author === "agent") {
    ticket = await updateTicket(input.ownerUserId, input.ticketId, { status: "waiting_customer" });
  } else {
    ticket = await updateTicket(input.ownerUserId, input.ticketId, {});
  }
  return { message, ticket, redactions: clean.redactions };
}

/** Explicit status change (agent console, or the owner closing their ticket).
 *  The server is authoritative for resolution state — the client never
 *  declares a financial issue resolved on its own. */
export async function setTicketStatus(
  ownerUserId: string,
  ticketId: string,
  status: TicketStatus
): Promise<SupportTicket | null> {
  return updateTicket(ownerUserId, ticketId, { status });
}

export async function createTicket(input: {
  userId: string;
  email: string;
  category: TicketCategory;
  subject: string;
  body: string;
  refs?: TicketRefs;
}): Promise<SupportTicket & { redactions: number }> {
  // Early redaction: PANs, seed phrases and API tokens never reach storage or
  // email — users paste them no matter what the form says.
  const subject = redactSecrets(input.subject);
  const body = redactSecrets(input.body);
  const redactions = subject.redactions + body.redactions;

  const now = new Date().toISOString();
  const ticket: SupportTicket = {
    id: `tkt_${randomUUID().slice(0, 12)}`,
    userId: input.userId,
    email: input.email,
    category: input.category,
    subject: subject.text,
    body: body.text,
    status: "open",
    ...(input.refs && Object.keys(input.refs).length ? { refs: input.refs } : {}),
    createdAt: now,
    updatedAt: now,
  };

  const existing = await listTickets(input.userId);
  await kvSet(userKey(input.userId), [ticket, ...existing].slice(0, MAX_PER_USER));
  await kvSet(ownerKey(ticket.id), input.userId);

  // Seed the conversation: the description is the first message, plus a
  // system acknowledgement so the thread explains itself.
  const seed: SupportMessage[] = [
    { id: `msg_${randomUUID().slice(0, 12)}`, ticketId: ticket.id, author: "user", body: body.text, createdAt: now },
    {
      id: `msg_${randomUUID().slice(0, 12)}`,
      ticketId: ticket.id,
      author: "system",
      body: "Ticket received. A human follows up here and by email — FurlPay Support will never ask for your seed phrase or private key.",
      createdAt: now,
    },
  ];
  await kvSet(msgsKey(ticket.id), seed);

  // Ops feed carries METADATA ONLY (no body, no email) — the overview doesn't
  // need PII, and a bounded Redis list is not the place to retain it.
  const feedEntry = {
    id: ticket.id,
    userId: ticket.userId,
    category: ticket.category,
    subject: ticket.subject,
    status: ticket.status,
    createdAt: ticket.createdAt,
  };
  await kvListPush(RECENT_FEED, JSON.stringify(feedEntry), 1000).catch(() => {});

  // Every ticket lands in the ops security feed at info — support actions on
  // regulated accounts need an ops-side trail, not only a mailbox. The
  // category rides in the detail so compliance can filter for kyc.
  // (The feed is rail-keyed; account-level events ride "transfers".)
  await recordSecurityEvent({
    kind: "support_ticket_created",
    rail: "transfers",
    severity: "info",
    detail: `[${ticket.category}] ${ticket.id}: ${ticket.subject.slice(0, 120)}`,
    actor: input.userId,
  }).catch(() => {});

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

  return { ...ticket, redactions };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
