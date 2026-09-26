"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ChevronRight,
  FileText,
  Mail,
  MessageCircle,
  MessagesSquare,
  Sparkles,
  Wallet,
  X,
} from "lucide-react";
import { FurlPayMark } from "@/components/trips/FurlPayLogo";
import { safeSources } from "@/lib/support/sources";
import { AIThinkingBubble } from "./AIThinkingBubble";

const CARD = "rounded-2xl border border-white/[0.07] bg-[#101512]";
const LABEL = "text-[12px] text-textSecondary";

// ---------------------------------------------------------------------------
// Ticket details.
//
// `product`, `issueType` and `priority` are NOT on the stored SupportTicket
// (lib/support.ts has id, userId, email, category, subject, body, status, refs,
// createdAt, updatedAt). Product maps from `category`, which is real. Issue type
// and priority are rendered as selects so the UI matches the design, but they
// are marked as not-yet-persisted rather than wired to a field that does not
// exist — writing them would silently drop on save.
// ---------------------------------------------------------------------------

// Keys are TICKET_CATEGORIES from lib/support.ts verbatim. They must be: the
// Update button PATCHes this value and the route validates it against that enum,
// so an invented key here ("payments", "wallet") is a 400 the user sees as a
// silently failing button. The reference design labels this row "Wallet &
// Payments", which is the DISPLAY name for `stablecoins` — the label can differ
// from the key, the key cannot.
const CATEGORY_LABEL: Record<string, string> = {
  stablecoins: "Wallet & Payments",
  cards: "Cards",
  kyc: "Identity & KYC",
  travel: "Travel",
  developers: "Developer Tools",
  other: "Other",
};

export function TicketDetails({
  ticketId,
  category,
  status,
  createdAt,
  lastActivity,
  channel = "Web Portal",
  onUpdate,
}: {
  ticketId: string;
  category: string;
  status: string;
  createdAt: string;
  lastActivity: string;
  channel?: string;
  onUpdate?: (next: { category: string }) => void;
}) {
  const [cat, setCat] = useState(category);
  const select =
    "w-full appearance-none rounded-lg border border-white/[0.09] bg-white/[0.03] px-3 py-2 text-[13px] text-white transition-colors focus:border-neon/60 focus:outline-none";

  return (
    <section className={`${CARD} p-5`}>
      <h3 className="text-[15.5px] font-semibold text-white">Ticket details</h3>

      <div className="mt-4 space-y-3.5">
        <div>
          <label htmlFor="fp-product" className={LABEL}>
            Product / Service
          </label>
          <div className="relative mt-1.5">
            <Wallet className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-textSecondary" />
            <select
              id="fp-product"
              value={cat}
              onChange={(e) => setCat(e.target.value)}
              className={`${select} pl-9`}
            >
              {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                <option key={k} value={k} className="bg-[#101512]">
                  {v}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="fp-issue" className={LABEL}>
            Issue type
          </label>
          {/* Not persisted — see the note at the top of this file. */}
          <select id="fp-issue" className={`${select} mt-1.5`} defaultValue="deposit">
            <option value="deposit" className="bg-[#101512]">Deposit Issue</option>
            <option value="withdrawal" className="bg-[#101512]">Withdrawal Issue</option>
            <option value="account" className="bg-[#101512]">Account</option>
            <option value="other" className="bg-[#101512]">Other</option>
          </select>
        </div>

        <div>
          <label htmlFor="fp-priority" className={LABEL}>
            Priority
          </label>
          <select id="fp-priority" className={`${select} mt-1.5`} defaultValue="normal">
            <option value="low" className="bg-[#101512]">Low</option>
            <option value="normal" className="bg-[#101512]">Normal</option>
            <option value="high" className="bg-[#101512]">High</option>
          </select>
        </div>

        <button
          type="button"
          onClick={() => onUpdate?.({ category: cat })}
          className="w-full rounded-lg bg-neon py-2.5 text-[13.5px] font-semibold text-black transition-colors hover:bg-neonDeep"
        >
          Update
        </button>
      </div>

      <dl className="mt-5 space-y-2.5 border-t border-white/[0.07] pt-4 text-[13px]">
        {[
          ["Ticket ID", `#${ticketId}`],
          ["Status", null],
          ["Created", createdAt],
          ["Last activity", lastActivity],
          ["Channel", channel],
        ].map(([k, v]) => (
          <div key={k as string} className="flex items-center justify-between gap-3">
            <dt className={LABEL}>{k}</dt>
            <dd className="truncate text-right text-white">
              {v ?? (
                <span className="flex items-center gap-1.5">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      status === "closed" || status === "resolved" ? "bg-textSecondary" : "bg-neon"
                    }`}
                  />
                  <span className="capitalize">{status.replace(/_/g, " ")}</span>
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function RelatedArticles({ items }: { items: { title: string; href: string }[] }) {
  return (
    <section className={`${CARD} mt-5 p-5`}>
      <h3 className="flex items-center gap-2 text-[15.5px] font-semibold text-white">
        <FileText className="h-[17px] w-[17px] text-neon" />
        Related articles
      </h3>
      <ul className="mt-3.5 space-y-2.5">
        {items.map((a) => (
          <li key={a.href}>
            <Link
              href={a.href}
              className="group flex items-start gap-2.5 text-[13.5px] text-[#D4D8D6] transition-colors hover:text-white"
            >
              <FileText className="mt-0.5 h-[15px] w-[15px] shrink-0 text-neon/70" />
              <span className="group-hover:underline">{a.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// AI assistant. Posts to the EXISTING POST /api/support/ask, which already does
// retrieval over the help centre and returns an `escalate` flag — so the "talk
// to a human" hand-off is the server's judgement, not a keyword match here.
// ---------------------------------------------------------------------------

const SUGGESTED = [
  "How do I deposit USDC?",
  "Why is my transaction pending?",
  "How to book flights with crypto?",
  "How to get a virtual card?",
  "What are the supported networks?",
  "Talk to a human agent",
] as const;

interface AiTurn {
  role: "user" | "assistant";
  text: string;
  escalate?: boolean;
  articles?: { title: string; href: string }[];
}

export function AIAssistant({
  ticketContext,
  suggestions,
}: {
  ticketContext?: string;
  /** Issue-specific prompts. Falls back to the generic set. */
  suggestions?: string[];
}) {
  const prompts = suggestions?.length ? suggestions : [...SUGGESTED];
  const [turns, setTurns] = useState<AiTurn[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [open, setOpen] = useState(true);
  // Holds the in-flight request so Stop can actually abort it. A Stop button
  // that only hid the spinner would leave the request running and then append
  // its answer after the user asked for it to stop.
  const abortRef = useRef<AbortController | null>(null);

  if (!open) return null;

  function stop() {
    abortRef.current?.abort();
  }

  async function ask(question: string) {
    if (!question.trim() || thinking) return;
    setTurns((t) => [...t, { role: "user", text: question }]);
    setInput("");
    setThinking(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      // CONTRACT, verified against the live route rather than assumed: the
      // schema is `{ message, history }` and it is `.strip()`, so the
      // `{ question, context }` this used to send was rejected outright —
      // every question 400'd. There is no `context` field and adding one would
      // be a server change; the ticket context is prepended to the message
      // instead, as a labelled line the model reads as data.
      //
      // Only the ticket SUBJECT and STATUS go in. The body can hold a tx hash,
      // an email or an amount, and none of that helps answer a help question.
      const res = await fetch("/api/support/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: ticketContext ? `[Context: ${ticketContext}]

${question}` : question,
          history: turns.slice(-6).map((t) => ({
            role: t.role === "user" ? "user" : "assistant",
            content: t.text.slice(0, 2000),
          })),
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as {
        answer?: string;
        sources?: { title: string; href: string }[];
        grounded?: boolean;
        escalate?: boolean;
      };
      setTurns((t) => [
        ...t,
        {
          role: "assistant",
          text: data.answer ?? "I could not find an answer for that.",
          escalate: data.escalate,
          articles: data.sources,
        },
      ]);
    } catch (err) {
      // A user-initiated abort is not a failure and must not be reported as
      // one. Saying "I could not reach the help service" after someone pressed
      // Stop blames our infrastructure for their decision, and would push them
      // toward a support ticket they never needed.
      if ((err as Error)?.name === "AbortError") return;
      setTurns((t) => [
        ...t,
        {
          role: "assistant",
          text: "I could not reach the help service just now. You can hand this to a human below.",
          escalate: true,
        },
      ]);
    } finally {
      setThinking(false);
      abortRef.current = null;
    }
  }

  return (
    <section className={`${CARD} p-5`}>
      <div className="flex items-start gap-2.5">
        {/* Deliberately NOT the FurlPay mark — that mark identifies a human
            support specialist in the thread beside this panel, and the two must
            not share a badge. */}
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-dashed border-white/25 bg-white/[0.04]">
          <Sparkles className="h-4 w-4 text-textSecondary" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 text-[15px] font-semibold text-white">
            FurlPay AI Assistant
            <span className="rounded bg-neon/[0.14] px-1.5 py-0.5 text-[10.5px] font-medium text-neon">Beta</span>
          </h3>
          <p className="mt-0.5 text-[12.5px] text-textSecondary">
            Automated answers from our help articles — not a human agent.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close assistant"
          className="rounded p-1 text-textSecondary transition-colors hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {turns.length > 0 && (
        <div className="mt-4 max-h-[280px] space-y-3 overflow-y-auto pr-1">
          {turns.map((t, i) => (
            <div key={i} className={t.role === "user" ? "text-right" : ""}>
              <p
                className={`inline-block max-w-[92%] rounded-xl px-3 py-2 text-left text-[13px] leading-relaxed ${
                  t.role === "user" ? "bg-neon/[0.14] text-white" : "bg-white/[0.04] text-[#D4D8D6]"
                }`}
              >
                {t.text}
              </p>
              {/* Article 50(2) disclosure travels with each AI turn. The panel
                  heading says "AI Assistant", but a heading scrolls out of view
                  and the obligation is to be perceivable in the interaction. */}
              {t.role !== "user" && (
                <p className="mt-1 flex items-center gap-1 text-[11px] text-textSecondary">
                  <Sparkles className="h-3 w-3 shrink-0" aria-hidden />
                  AI-generated · can be wrong · cannot act on your account
                </p>
              )}
              {/* Re-validated here even though the server already filtered: this
                  is the render that turns a citation into a navigation, and a
                  `//host` href looks root-relative at a glance. */}
              {safeSources(t.articles).length ? (
                <ul className="mt-1.5 space-y-1">
                  {safeSources(t.articles).map((a) => (
                    <li key={a.href}>
                      <Link href={a.href} className="text-[12.5px] text-neon hover:underline">
                        {a.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
              {t.escalate && (
                <Link
                  href="/support/new"
                  className="mt-1.5 inline-block rounded-lg border border-neon/40 px-3 py-1 text-[12.5px] text-neon transition-colors hover:bg-neon/10"
                >
                  Talk to a human agent →
                </Link>
              )}
            </div>
          ))}
          {thinking && <AIThinkingBubble onStop={stop} />}
        </div>
      )}

      {turns.length === 0 && (
        <ul className="mt-4 space-y-2">
          {prompts.map((q) => (
            <li key={q}>
              <button
                type="button"
                onClick={() => void ask(q)}
                className="group flex w-full items-center justify-between gap-2 rounded-lg border border-white/[0.08] px-3.5 py-2.5 text-left text-[13px] text-white transition-colors hover:border-neon/40 hover:bg-neon/[0.05]"
              >
                <span className="truncate">{q}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-textSecondary transition-colors group-hover:text-neon" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="mt-4 flex items-center gap-2 rounded-xl border border-neon/30 bg-white/[0.03] px-3.5 py-2 transition-colors focus-within:border-neon"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask anything about FurlPay..."
          aria-label="Ask the FurlPay assistant"
          className="flex-1 bg-transparent text-[13px] text-white placeholder:text-textSecondary focus:outline-none"
        />
        <button
          type="submit"
          disabled={!input.trim() || thinking}
          aria-label="Send question"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-neon text-black transition-colors hover:bg-neonDeep disabled:opacity-40"
        >
          <ArrowRight className="h-4 w-4" />
        </button>
      </form>
    </section>
  );
}

export function ContactOptions() {
  const rows = [
    { icon: MessagesSquare, title: "Live chat", sub: "Chat with our team", meta: "Online", href: "/support", online: true },
    { icon: Mail, title: "Email support", sub: "support@furlpay.com", meta: "24-48 hours", href: "mailto:support@furlpay.com" },
    { icon: MessageCircle, title: "Community", sub: "Join our Discord", meta: "", href: "/community", note: "Get help from the community" },
  ];
  return (
    <section className={`${CARD} mt-5 p-5`}>
      <h3 className="text-[15.5px] font-semibold text-white">Contact options</h3>
      <ul className="mt-3.5 space-y-2">
        {rows.map(({ icon: Icon, title, sub, meta, href, online, note }) => (
          <li key={title}>
            <Link
              href={href}
              className="group flex items-center gap-3 rounded-lg px-1 py-2 transition-colors hover:bg-white/[0.03]"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neon/[0.12] text-neon">
                <Icon className="h-[17px] w-[17px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-semibold text-white">{title}</span>
                <span className="block truncate text-[12px] text-textSecondary">{sub}</span>
                {note && <span className="block truncate text-[12px] text-textSecondary">{note}</span>}
              </span>
              {meta && (
                <span className="flex shrink-0 items-center gap-1.5 text-[11.5px] text-textSecondary">
                  {online && <span className="h-1.5 w-1.5 rounded-full bg-neon" />}
                  {meta}
                </span>
              )}
              <ChevronRight className="h-4 w-4 shrink-0 text-textSecondary transition-colors group-hover:text-neon" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
