"use client";

import { useCallback, useEffect, useState, use } from "react";
import Link from "next/link";
import { SupportHero, SupportNavbar, TicketBreadcrumb } from "@/components/support/SupportChrome";
import {
  ReplyComposer,
  TicketActions,
  TicketAlert,
  TicketHeader,
  TicketMessage,
  type ThreadMessage,
} from "@/components/support/TicketThread";
import {
  AIAssistant,
  ContactOptions,
  RelatedArticles,
  TicketDetails,
} from "@/components/support/SupportSidebars";

// Customer ticket thread — the in-app conversation view. Support-agent replies
// (POST .../agent) push-notify the customer and deep-link here (/support/<id>),
// so this page is what makes those notifications resolve instead of 404-ing.
//
// The API contract is unchanged from the previous version of this page:
//   GET  /api/support/tickets/[id]           -> { ticket, messages }
//   POST /api/support/tickets/[id]/messages  -> { message, ticket? }
//   PATCH /api/support/tickets/[id]          -> { ticket }
// Only the presentation changed.

interface Ticket {
  id: string;
  category: string;
  subject: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  email?: string;
}

const ARTICLES = [
  { title: "How to deposit USDC to FurlPay", href: "/docs/help/deposit-usdc" },
  { title: "Transaction pending or stuck?", href: "/docs/help/transaction-pending" },
  { title: "Supported networks and tokens", href: "/docs/help/supported-networks" },
  { title: "Deposit & withdrawal FAQs", href: "/docs/help/deposit-faqs" },
  { title: "Travel bookings with crypto", href: "/docs/help/travel-crypto" },
];

function fmt(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export default function TicketThreadPage(props: { params: Promise<{ id: string }> }) {
  const { id } = use(props.params);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [closing, setClosing] = useState(false);
  const [needsAuth, setNeedsAuth] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/support/tickets/${id}`);
      if (!res.ok) {
        // A 401 is NOT a system failure, and this page is the target of
        // support-reply push notifications — so the common way to arrive here
        // signed out is a deep link opened after the session expired. Showing
        // "Could not load this ticket" there is a dead end: it reads as data
        // loss and offers no action. Say what actually happened.
        if (res.status === 401) {
          setNeedsAuth(true);
          return;
        }
        setError(res.status === 404 ? "That ticket could not be found." : "Could not load this ticket.");
        return;
      }
      const data = await res.json();
      setTicket(data.ticket);
      setMessages(Array.isArray(data.messages) ? data.messages : []);
      setError(null);
    } catch {
      setError("Could not load this ticket.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function send(body: string) {
    setSending(true);
    try {
      const res = await fetch(`/api/support/tickets/${id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        setAlert(null);
        setError("Your reply could not be sent. Nothing was lost — try again.");
        return;
      }
      const data = await res.json();
      if (data.message) setMessages((m) => [...m, data.message]);
      if (data.ticket) setTicket(data.ticket);
      setError(null);
      setAlert("Your reply has been added to the ticket.");
    } finally {
      setSending(false);
    }
  }

  async function closeTicket() {
    setClosing(true);
    try {
      const res = await fetch(`/api/support/tickets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "closed" }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.ticket) setTicket(data.ticket);
        setAlert("This ticket has been closed.");
      }
    } finally {
      setClosing(false);
    }
  }

  const customerName = ticket?.email?.split("@")[0] ?? "You";

  return (
    <div className="min-h-screen bg-[#080B0A] text-white">
      <SupportNavbar activeLabel="Tickets" />
      <SupportHero />
      <TicketBreadcrumb items={[{ label: "Home", href: "/support" }, { label: "Tickets" }]} />

      <main className="mx-auto max-w-[1536px] px-6 pb-16 pt-3">
        {/* Three columns on desktop; on tablet and below they stack in the order
            the brief specifies — thread, details, assistant, contact — which is
            what the source order already is, so no CSS reordering is needed. */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_260px_310px]">
          <div className="min-w-0">
            {alert && <TicketAlert message={alert} onDismiss={() => setAlert(null)} />}
            {error && (
              <p role="alert" className="mb-5 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-[13.5px] text-white">
                {error}
              </p>
            )}

            <div className="rounded-2xl border border-white/[0.07] bg-[#101512]">
              {loading ? (
                <p className="px-6 py-10 text-[13.5px] text-textSecondary">Loading ticket…</p>
              ) : needsAuth ? (
                <div className="px-6 py-12 text-center">
                  <p className="text-[15px] font-semibold text-white">Sign in to view this ticket</p>
                  <p className="mx-auto mt-1.5 max-w-[420px] text-[13.5px] text-textSecondary">
                    Tickets are private to the account that raised them. Your session may have expired.
                  </p>
                  <Link
                    href={`/login?next=/support/${encodeURIComponent(id)}`}
                    className="mt-4 inline-block rounded-lg bg-neon px-5 py-2 text-[13.5px] font-semibold text-black transition-colors hover:bg-neonDeep"
                  >
                    Sign in
                  </Link>
                </div>
              ) : ticket ? (
                <>
                  <TicketHeader
                    subject={ticket.subject}
                    ticketId={ticket.id}
                    status={ticket.status}
                    createdAt={fmt(ticket.createdAt)}
                  />
                  {messages.length === 0 ? (
                    <p className="px-6 py-8 text-[13.5px] text-textSecondary">No messages yet.</p>
                  ) : (
                    messages.map((m, i) => (
                      <TicketMessage
                        key={m.id}
                        message={m}
                        customerName={customerName}
                        // Actions sit on the first message, matching the design.
                        actions={
                          i === 0 ? (
                            <TicketActions
                              onReply={() =>
                                document
                                  .querySelector<HTMLInputElement>('input[aria-label="Add a reply"]')
                                  ?.focus()
                              }
                              onClose={closeTicket}
                              closing={closing}
                            />
                          ) : undefined
                        }
                      />
                    ))
                  )}
                  <ReplyComposer onSend={send} sending={sending} />
                </>
              ) : (
                <p className="px-6 py-10 text-[13.5px] text-textSecondary">
                  {error ?? "That ticket could not be found."}
                </p>
              )}
            </div>
          </div>

          <aside className="min-w-0">
            {ticket && (
              <TicketDetails
                ticketId={ticket.id}
                category={ticket.category}
                status={ticket.status}
                createdAt={fmt(ticket.createdAt)}
                lastActivity={fmt(ticket.updatedAt)}
              />
            )}
            <RelatedArticles items={ARTICLES} />
          </aside>

          <aside className="min-w-0">
            <AIAssistant
              // Subject and status only — never the body, which can carry a
              // hash, an amount or an email the assistant does not need.
              ticketContext={ticket ? `Ticket ${ticket.id}: ${ticket.subject} (status: ${ticket.status})` : undefined}
            />
            <ContactOptions />
          </aside>
        </div>
      </main>
    </div>
  );
}
