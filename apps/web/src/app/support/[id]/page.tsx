"use client";

import { useCallback, useEffect, useRef, useState, use } from "react";
import Link from "next/link";
import { ChevronLeft, ShieldCheck, Send } from "lucide-react";

// Customer ticket thread — the in-app conversation view. Support-agent replies
// (POST .../agent) push-notify the customer and deep-link here (/support/<id>),
// so this page is what makes those notifications resolve instead of 404-ing. It
// reads GET /api/support/tickets/[id] and posts replies to .../messages.

interface Message {
  id: string;
  author: "user" | "agent" | "system";
  body: string;
  createdAt: string;
}
interface Ticket {
  id: string;
  category: string;
  subject: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  open: { label: "Open", cls: "bg-amber-400/15 text-amber-300" },
  waiting_support: { label: "Waiting on support", cls: "bg-amber-400/15 text-amber-300" },
  waiting_customer: { label: "Awaiting your reply", cls: "bg-sky-400/15 text-sky-300" },
  in_progress: { label: "In progress", cls: "bg-sky-400/15 text-sky-300" },
  resolved: { label: "Resolved", cls: "bg-neon/15 text-neon" },
  closed: { label: "Closed", cls: "bg-white/10 text-textSecondary" },
};

export default function TicketThreadPage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  const { id } = params;
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "unauth" | "notfound" | "error">("loading");
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/support/tickets/${id}`);
      if (res.status === 401) return setState("unauth");
      if (res.status === 404) return setState("notfound");
      if (!res.ok) return setState("error");
      const data = await res.json();
      setTicket(data.ticket);
      setMessages(Array.isArray(data.messages) ? data.messages : []);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const closed = ticket?.status === "closed";

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = reply.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/support/tickets/${id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ body }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.message) {
        setMessages((m) => [...m, data.message]);
        if (data.ticket) setTicket(data.ticket);
        setReply("");
      }
    } finally {
      setSending(false);
    }
  }

  async function closeTicket() {
    const res = await fetch(`/api/support/tickets/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "closed" }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.ticket) setTicket(data.ticket);
    }
  }

  return (
    <div className="min-h-screen bg-oled">
      <div className="mx-auto max-w-2xl px-5 pb-28 pt-8">
        <Link href="/support" className="mb-4 inline-flex items-center gap-1 text-sm text-textSecondary hover:text-white">
          <ChevronLeft className="h-4 w-4" /> Support
        </Link>

        {state === "loading" && <p className="text-sm text-textSecondary">Loading…</p>}

        {state === "unauth" && (
          <div className="glass-card p-6 text-sm text-textSecondary">
            <Link href={`/login?next=/support/${id}`} className="font-semibold text-neon">Sign in</Link> to view this ticket.
          </div>
        )}

        {state === "notfound" && (
          <div className="glass-card p-6 text-sm text-textSecondary">
            Ticket not found. <Link href="/support" className="font-semibold text-neon">Back to support</Link>.
          </div>
        )}

        {state === "error" && (
          <div className="glass-card p-6 text-sm text-loss">Couldn&apos;t load this ticket. Please try again.</div>
        )}

        {state === "ready" && ticket && (
          <>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-xl font-bold text-white">{ticket.subject}</h1>
                <p className="mt-1 text-xs text-textSecondary">
                  {ticket.id} · {ticket.category} · opened {new Date(ticket.createdAt).toLocaleDateString()}
                </p>
              </div>
              <span className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-bold ${STATUS_LABEL[ticket.status]?.cls ?? "bg-white/10 text-textSecondary"}`}>
                {STATUS_LABEL[ticket.status]?.label ?? ticket.status}
              </span>
            </div>

            <div ref={scrollRef} className="mt-5 max-h-[55vh] space-y-3 overflow-y-auto rounded-card border border-white/10 bg-charcoal p-4">
              {messages.map((m) => {
                if (m.author === "system") {
                  return (
                    <p key={m.id} className="mx-auto max-w-[90%] rounded-lg bg-white/[0.03] px-3 py-2 text-center text-[11px] text-textSecondary">
                      {m.body}
                    </p>
                  );
                }
                const mine = m.author === "user";
                return (
                  <div key={m.id} className={mine ? "flex justify-end" : "flex justify-start"}>
                    <div className={`max-w-[82%] rounded-2xl px-3.5 py-2 text-sm ${mine ? "rounded-br-md bg-neon text-black" : "rounded-bl-md border border-white/10 bg-white/[0.04] text-white"}`}>
                      {!mine && <p className="mb-0.5 text-[11px] font-semibold text-neon">FurlPay Support</p>}
                      <p className="whitespace-pre-wrap leading-relaxed">{m.body}</p>
                      <p className={`mt-1 text-[10px] ${mine ? "text-black/60" : "text-textSecondary"}`}>
                        {new Date(m.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            {closed ? (
              <p className="mt-4 rounded-lg bg-white/[0.04] px-3 py-2 text-center text-xs text-textSecondary">
                This ticket is closed. Replying will reopen it.
              </p>
            ) : null}

            <form onSubmit={send} className="mt-4">
              <textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                rows={3}
                maxLength={5000}
                placeholder="Write a reply… never include full card numbers, recovery phrases or private keys."
                className="w-full rounded-xl border border-white/10 bg-black/40 p-3 text-sm text-white outline-none focus:border-neon/40"
              />
              <div className="mt-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={closeTicket}
                  disabled={closed}
                  className="text-xs font-semibold text-textSecondary hover:text-white disabled:opacity-40"
                >
                  Close ticket
                </button>
                <button
                  type="submit"
                  disabled={sending || !reply.trim()}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-neon px-4 py-2 text-sm font-bold text-black transition enabled:hover:bg-neonDeep disabled:opacity-40"
                >
                  <Send className="h-4 w-4" /> {sending ? "Sending…" : "Send"}
                </button>
              </div>
            </form>

            <p className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-textSecondary">
              <ShieldCheck className="h-3 w-3 text-neon" /> Replies are stored in FurlPay · card numbers & keys are masked automatically
            </p>
          </>
        )}
      </div>
    </div>
  );
}
