import { describe, expect, it } from "vitest";
import {
  addMessage,
  createTicket,
  findTicketOwner,
  getTicketForUser,
  listMessages,
  listTickets,
  setTicketStatus,
} from "@/lib/support";

// Runs against the kv memory fallback (no Redis in test env). RESEND_API_KEY
// is unset, so the notification email no-ops — ticket creation must succeed
// anyway (mail is fire-and-forget by design).

const A = "user_aaaa";
const B = "user_bbbb";

async function mkTicket(userId: string, subject = "Deposit missing") {
  const { redactions: _r, ...ticket } = await createTicket({
    userId,
    email: `${userId}@example.com`,
    category: "stablecoins",
    subject,
    body: "I sent 250 USDC and the app still says pending.",
    refs: { transactionId: "tx_123", correlationId: "cid-abc" },
  });
  return ticket;
}

describe("support tickets — ownership (anti-IDOR)", () => {
  it("the owner can read their ticket; another user cannot (BOLA blocked)", async () => {
    const t = await mkTicket(A);
    expect((await getTicketForUser(A, t.id))?.id).toBe(t.id);
    expect(await getTicketForUser(B, t.id)).toBeNull();
  });

  it("a ticket id from another user cannot be used to change status", async () => {
    const t = await mkTicket(A);
    // The route resolves ownership via getTicketForUser before mutating; a
    // non-owner never reaches setTicketStatus. Prove the guard's verdict:
    expect(await getTicketForUser(B, t.id)).toBeNull();
    // And even a direct mis-scoped call cannot touch A's ticket, because the
    // update runs inside the owner's list:
    expect(await setTicketStatus(B, t.id, "closed")).toBeNull();
    expect((await getTicketForUser(A, t.id))?.status).toBe("open");
  });

  it("owner index resolves the ticket's owner for the agent route", async () => {
    const t = await mkTicket(A);
    expect(await findTicketOwner(t.id)).toBe(A);
    expect(await findTicketOwner("tkt_nonexistent")).toBeNull();
  });
});

describe("support conversation — lifecycle", () => {
  it("creation seeds the thread with the description and a system notice", async () => {
    const t = await mkTicket(A);
    const msgs = await listMessages(t.id);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].author).toBe("user");
    expect(msgs[1].author).toBe("system");
    expect(msgs[1].body).toMatch(/never ask for your seed phrase/i);
  });

  it("a customer reply puts the ticket in waiting_support; an agent reply in waiting_customer", async () => {
    const t = await mkTicket(A);
    const afterUser = await addMessage({ ownerUserId: A, ticketId: t.id, author: "user", body: "Any update?" });
    expect(afterUser.ticket?.status).toBe("waiting_support");
    const afterAgent = await addMessage({
      ownerUserId: A,
      ticketId: t.id,
      author: "agent",
      body: "Investigating — can you share the approximate time?",
    });
    expect(afterAgent.ticket?.status).toBe("waiting_customer");
    expect((await listMessages(t.id)).map((m) => m.author)).toEqual(["user", "system", "user", "agent"]);
  });

  it("a customer reply re-opens a resolved ticket", async () => {
    const t = await mkTicket(A);
    await setTicketStatus(A, t.id, "resolved");
    const r = await addMessage({ ownerUserId: A, ticketId: t.id, author: "user", body: "Still broken." });
    expect(r.ticket?.status).toBe("waiting_support");
  });

  it("status transitions are server truth and persist", async () => {
    const t = await mkTicket(A);
    await setTicketStatus(A, t.id, "in_progress");
    expect((await getTicketForUser(A, t.id))?.status).toBe("in_progress");
    await setTicketStatus(A, t.id, "closed");
    expect((await getTicketForUser(A, t.id))?.status).toBe("closed");
  });
});

describe("support — sensitive-data redaction", () => {
  it("redacts a card PAN pasted into a message", async () => {
    const t = await mkTicket(A);
    const r = await addMessage({
      ownerUserId: A,
      ticketId: t.id,
      author: "user",
      body: "My card 4111 1111 1111 1111 was declined",
    });
    expect(r.redactions).toBeGreaterThan(0);
    expect(r.message.body).not.toContain("4111 1111 1111 1111");
  });

  it("refs are carried on the ticket for incident reconstruction", async () => {
    const t = await mkTicket(A);
    const loaded = await getTicketForUser(A, t.id);
    expect(loaded?.refs).toEqual({ transactionId: "tx_123", correlationId: "cid-abc" });
  });
});
