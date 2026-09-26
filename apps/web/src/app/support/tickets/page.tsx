"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, Search, Ticket as TicketIcon } from "lucide-react";
import { SupportNavbar, TicketBreadcrumb } from "@/components/support/SupportChrome";
import { StatusPill } from "@/components/support/TicketThread";
import {
  CATEGORY_LABEL,
  FILTERS,
  formatUpdated,
  matchesFilter,
  searchRows,
  ticketHref,
  toRows,
  type FilterKey,
  type TicketRow,
} from "./ticketList";

// ---------------------------------------------------------------------------
// The ticket list.
//
// The navbar has linked here since the portal was built and the route did not
// exist, so "Tickets" 404'd — the same class of bug as /support/new, which was
// being swallowed by the dynamic [id] segment.
//
// Contract, read off the running API rather than assumed:
//   GET /api/support/tickets -> { tickets: SupportTicket[] }
//   401 when signed out, 429 over 60/min, ownership enforced server-side by
//   listTickets(auth.account.user.id) — the client never sends a user id.
//
// The response includes userId, email and body. `toRows` drops all three before
// anything renders; see ticketList.ts.
// ---------------------------------------------------------------------------

type State =
  | { kind: "loading" }
  | { kind: "ready"; rows: TicketRow[] }
  | { kind: "unauthenticated" }
  | { kind: "error"; message: string };

export default function TicketsPage() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [filter, setFilter] = useState<FilterKey>("all");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const res = await fetch("/api/support/tickets");
      if (res.status === 401) return setState({ kind: "unauthenticated" });
      if (res.status === 429) {
        return setState({ kind: "error", message: "Too many requests just now. Give it a moment and retry." });
      }
      if (!res.ok) return setState({ kind: "error", message: "We couldn't load your tickets." });
      const data = await res.json();
      setState({ kind: "ready", rows: toRows(data.tickets) });
    } catch {
      setState({ kind: "error", message: "We couldn't reach the support service." });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Memoised so the array identity is stable — a fresh `[]` each render would
  // re-run the filter memo below on every keystroke.
  const rows = useMemo(() => (state.kind === "ready" ? state.rows : []), [state]);
  const visible = useMemo(
    () => searchRows(rows.filter((r) => matchesFilter(r.status, filter)), query),
    [rows, filter, query]
  );

  return (
    <div className="min-h-screen bg-[#080B0A] text-white">
      <SupportNavbar activeLabel="Tickets" />
      <TicketBreadcrumb items={[{ label: "Home", href: "/support" }, { label: "Tickets" }]} />

      <main className="mx-auto max-w-[1100px] px-6 pb-16 pt-2">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-[27px] font-bold tracking-tight text-white">Tickets</h1>
            <p className="mt-1 text-[13.5px] text-[#C9CDCB]">Everything you&apos;ve raised with our team.</p>
          </div>
          <Link
            href="/support/new"
            className="rounded-full bg-neon px-5 py-2 text-[13.5px] font-semibold text-black transition-colors hover:bg-neonDeep"
          >
            Submit a ticket
          </Link>
        </div>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex flex-1 items-center gap-2 rounded-lg border border-white/[0.09] bg-white/[0.03] px-3.5 py-2 transition-colors focus-within:border-neon/60">
            <Search className="h-4 w-4 shrink-0 text-textSecondary" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tickets..."
              aria-label="Search tickets"
              className="w-full bg-transparent text-[13.5px] text-white placeholder:text-textSecondary focus:outline-none"
            />
          </div>
          <div role="tablist" aria-label="Filter tickets" className="flex flex-wrap items-center gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded-full px-3.5 py-1.5 text-[13px] transition-colors ${
                  filter === f.key
                    ? "bg-neon text-black"
                    : "border border-white/[0.09] text-textSecondary hover:text-white"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 overflow-hidden rounded-2xl border border-white/[0.07] bg-[#101512]">
          {state.kind === "loading" && (
            <div className="px-6 py-14 text-center" aria-busy>
              <p className="text-[13.5px] text-textSecondary">Loading your tickets…</p>
            </div>
          )}

          {state.kind === "unauthenticated" && (
            <div className="px-6 py-14 text-center">
              <p className="text-[15px] font-semibold text-white">Sign in to see your tickets</p>
              <p className="mx-auto mt-1.5 max-w-[420px] text-[13.5px] text-textSecondary">
                Your tickets are private to your account, so we need to know who you are.
              </p>
              <Link
                href="/login?next=/support/tickets"
                className="mt-4 inline-block rounded-lg bg-neon px-5 py-2 text-[13.5px] font-semibold text-black transition-colors hover:bg-neonDeep"
              >
                Sign in
              </Link>
            </div>
          )}

          {state.kind === "error" && (
            <div className="px-6 py-14 text-center" role="alert">
              <p className="text-[15px] font-semibold text-white">{state.message}</p>
              <p className="mx-auto mt-1.5 max-w-[420px] text-[13.5px] text-textSecondary">
                Nothing was lost — your tickets are safe.
              </p>
              <button
                type="button"
                onClick={() => void load()}
                className="mt-4 rounded-lg border border-neon/40 px-5 py-2 text-[13.5px] font-semibold text-neon transition-colors hover:bg-neon/10"
              >
                Try again
              </button>
            </div>
          )}

          {state.kind === "ready" && rows.length === 0 && (
            <div className="px-6 py-14 text-center">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-neon/40 text-neon">
                <TicketIcon className="h-5 w-5" />
              </span>
              <p className="mt-3.5 text-[15px] font-semibold text-white">No tickets yet</p>
              <p className="mx-auto mt-1.5 max-w-[420px] text-[13.5px] text-textSecondary">
                When you raise something with our team it will appear here.
              </p>
              <Link
                href="/support/new"
                className="mt-4 inline-block rounded-lg bg-neon px-5 py-2 text-[13.5px] font-semibold text-black transition-colors hover:bg-neonDeep"
              >
                Submit a ticket
              </Link>
            </div>
          )}

          {/* Tickets exist, but the current filter/search hides them all — a
              distinct state from "no tickets", or the user thinks their data
              vanished. */}
          {state.kind === "ready" && rows.length > 0 && visible.length === 0 && (
            <div className="px-6 py-14 text-center">
              <p className="text-[15px] font-semibold text-white">No tickets match</p>
              <p className="mx-auto mt-1.5 max-w-[420px] text-[13.5px] text-textSecondary">
                {rows.length} ticket{rows.length === 1 ? "" : "s"} {rows.length === 1 ? "is" : "are"} hidden by the
                current filter or search.
              </p>
              <button
                type="button"
                onClick={() => {
                  setFilter("all");
                  setQuery("");
                }}
                className="mt-4 rounded-lg border border-white/[0.12] px-5 py-2 text-[13.5px] text-white transition-colors hover:bg-white/[0.04]"
              >
                Clear filters
              </button>
            </div>
          )}

          {state.kind === "ready" && visible.length > 0 && (
            <ul>
              {visible.map((t) => (
                <li key={t.id} className="border-b border-white/[0.06] last:border-b-0">
                  <Link
                    href={ticketHref(t.id)}
                    className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-white/[0.03]"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-semibold text-white">{t.subject}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] text-textSecondary">
                        <span className="font-mono">#{t.id}</span>
                        <span aria-hidden>·</span>
                        <span>{CATEGORY_LABEL[t.category] ?? t.category}</span>
                        <span aria-hidden>·</span>
                        <span>Updated {formatUpdated(t.updatedAt)}</span>
                      </p>
                    </div>
                    <StatusPill status={t.status} />
                    <ChevronRight className="h-4 w-4 shrink-0 text-textSecondary transition-colors group-hover:text-neon" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}
