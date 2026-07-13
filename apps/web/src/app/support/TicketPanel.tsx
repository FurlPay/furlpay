"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

// Ticket form + "my tickets" for signed-in users. A visitor without a session
// sees a login prompt instead — the anonymous path is the chat bubble
// (/api/support/message), which needs no account.

const CATEGORIES = [
  { value: "stablecoins", label: "Stablecoins & deposits" },
  { value: "cards", label: "Virtual cards" },
  { value: "kyc", label: "KYC verification" },
  { value: "travel", label: "Travel bookings" },
  { value: "developers", label: "Developers & x402" },
  { value: "other", label: "Something else" },
] as const;

interface Ticket {
  id: string;
  category: string;
  subject: string;
  status: "open" | "resolved";
  createdAt: string;
}

export default function TicketPanel() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [category, setCategory] = useState<string>("stablecoins");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/support/tickets");
      if (res.status === 401) {
        setSignedIn(false);
        return;
      }
      const data = await res.json();
      setSignedIn(true);
      setTickets(Array.isArray(data.tickets) ? data.tickets : []);
    } catch {
      setSignedIn(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("sending");
    setError(null);
    try {
      const res = await fetch("/api/support/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, subject, body }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }
      setSubject("");
      setBody("");
      setState("sent");
      await load();
    } catch (err) {
      setError((err as Error).message);
      setState("error");
    }
  };

  return (
    <section className="mt-16" id="ticket">
      <h2 className="text-[22px] font-bold">Open a ticket</h2>
      <p className="mt-1 text-[14px] text-textSecondary">
        Tracked to resolution — replies go to your account email.
      </p>

      {signedIn === false ? (
        <div className="glass-card mt-6 p-6 text-[14px] text-textSecondary">
          <Link href="/login?next=/support" className="font-semibold text-neon">
            Sign in
          </Link>{" "}
          to open and track tickets, or use the chat bubble in the corner — no account needed.
        </div>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <form onSubmit={submit} className="glass-card flex flex-col gap-4 p-6">
            <label className="text-[13px] font-semibold">
              Category
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 p-2.5 text-[14px]"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[13px] font-semibold">
              Subject
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                required
                minLength={4}
                maxLength={120}
                placeholder="Deposit not credited after 30 minutes"
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 p-2.5 text-[14px]"
              />
            </label>
            <label className="text-[13px] font-semibold">
              What happened?
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                required
                minLength={10}
                maxLength={5000}
                rows={5}
                placeholder="Include transaction hashes, card last-4, or request IDs where relevant — never your full card number or private keys."
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 p-2.5 text-[14px]"
              />
            </label>
            <button
              type="submit"
              disabled={state === "sending"}
              className="rounded-lg bg-neon px-4 py-2.5 text-[14px] font-bold text-black disabled:opacity-40"
            >
              {state === "sending" ? "Sending…" : "Submit ticket"}
            </button>
            {state === "sent" && (
              <p className="text-[13px] text-neon">Ticket created — we&apos;ll reply by email.</p>
            )}
            {error && <p className="text-[13px] text-red-400">{error}</p>}
          </form>

          <div className="glass-card p-6">
            <h3 className="text-[15px] font-bold">Your tickets</h3>
            {tickets.length === 0 ? (
              <p className="mt-3 text-[14px] text-textSecondary">No tickets yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-white/5">
                {tickets.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-semibold">{t.subject}</p>
                      <p className="text-[12px] text-textSecondary">
                        {t.id} · {t.category} · {new Date(t.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                        t.status === "open" ? "bg-amber-400/15 text-amber-300" : "bg-neon/15 text-neon"
                      }`}
                    >
                      {t.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
