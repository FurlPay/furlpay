"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ChevronLeft,
  House,
  LifeBuoy,
  MessagesSquare,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Furlpay support Messenger — a modern Intercom-style widget with Home /
// Messages / Help spaces, a team presence header, searchable help articles,
// and a live-feeling agentic chat (typing indicator, quick replies).
//
// The in-chat assistant replies are canned (demo), but every visitor message
// is forwarded to the support mailbox via POST /api/support/message so a real
// human follows up. The full agentic support router (KYC lookups via Persona
// hooks, card locks gated on passkey re-auth) remains future work.
// ---------------------------------------------------------------------------

type Tab = "home" | "messages" | "help";

interface Msg {
  from: "bot" | "user";
  text: string;
}

const TEAM = [
  { name: "Nimer", from: "#00E599", to: "#00B87A" },
  { name: "Wesam", from: "#FF3B30", to: "#E02020" },
  { name: "Ava", from: "#6366F1", to: "#8B5CF6" },
];

const ARTICLES = [
  { q: "Which countries and regions are supported?", tag: "Coverage" },
  { q: "Fees & limits — the complete breakdown", tag: "Billing" },
  { q: "How passkey (Face ID / fingerprint) login works", tag: "Security" },
  { q: "Prohibited merchants & AML screening policy", tag: "Compliance" },
  { q: "Freeze, cancel, or replace a card", tag: "Cards" },
  { q: "Stablecoin settlement & off-ramp timing", tag: "Payments" },
];

const GREETING: Msg = {
  from: "bot",
  text: "Hi, I'm the Furlpay assistant. I can check KYC status, look up a transaction, or freeze a card. How can I help?",
};

const QUICK_ACTIONS = ["Check my KYC status", "Look up a transaction", "Freeze a card"];

function demoReply(input: string): string {
  const q = input.toLowerCase();
  if (q.includes("kyc"))
    return "Your identity verification is Tier 2 — verified. You can raise limits by completing Tier 3 in Profile → Verification.";
  if (q.includes("transaction") || q.includes("look up") || q.includes("lookup"))
    return "Share the transaction ID (e.g. tx_1a2b3c) and I'll pull its status. For your security, full payloads stay masked.";
  if (q.includes("freeze") || q.includes("lock") || q.includes("card"))
    return "I can freeze a card instantly. For safety this needs a passkey confirmation — I'll trigger the biometric prompt once you pick the card.";
  if (q.includes("fee") || q.includes("cost") || q.includes("price"))
    return "Furlpay Connect settles at a flat 0.5%. Card spend and stablecoin transfers are gas-sponsored. Full breakdown is in the Help tab.";
  return "Thanks! A specialist will follow up shortly. Meanwhile the Docs and Security pages cover most questions.";
}

function Avatar({ name, from, to, className = "" }: { name: string; from: string; to: string; className?: string }) {
  return (
    <span
      className={`flex items-center justify-center rounded-full text-[11px] font-bold text-black ring-2 ring-[#0b0b0d] ${className}`}
      style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
      title={name}
    >
      {name.charAt(0)}
    </span>
  );
}

export default function SupportChatBubble() {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false); // drives the enter/exit transition
  const [tab, setTab] = useState<Tab>("home");
  const [messages, setMessages] = useState<Msg[]>([GREETING]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [query, setQuery] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Mount → next frame → animate in (and reverse on close).
  useEffect(() => {
    if (open) {
      const id = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(id);
    }
    setShown(false);
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, typing, tab]);

  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setInput("");
    setMessages((m) => {
      const next: Msg[] = [...m, { from: "user", text: trimmed }];
      // Forward to the support mailbox with recent context; fire-and-forget —
      // the widget must feel instant regardless of the email path.
      void fetch("/api/support/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          page: window.location.pathname,
          transcript: next.slice(-8),
        }),
      }).catch(() => undefined);
      return next;
    });
    setTyping(true);
    setTimeout(() => {
      setTyping(false);
      setMessages((m) => [...m, { from: "bot", text: demoReply(trimmed) }]);
    }, 900);
  }

  function openChat(seed?: string) {
    setTab("messages");
    if (seed) send(seed);
  }

  const results = query
    ? ARTICLES.filter((a) => a.q.toLowerCase().includes(query.toLowerCase()))
    : ARTICLES;

  return (
    <>
      {open && (
        <div
          role="dialog"
          aria-label="Furlpay support"
          className={`fixed bottom-24 right-6 z-[1000] flex h-[600px] max-h-[calc(100vh-7rem)] w-[min(384px,calc(100vw-3rem))] flex-col overflow-hidden rounded-[26px] border border-white/10 bg-[#0b0b0d] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.85)] backdrop-blur-2xl transition-all duration-300 ease-out ${
            shown ? "translate-y-0 scale-100 opacity-100" : "translate-y-4 scale-95 opacity-0"
          }`}
        >
          {/* ── HOME ─────────────────────────────────────────────── */}
          {tab === "home" && (
            <div ref={tab === "home" ? scrollRef : undefined} className="flex-1 overflow-y-auto">
              <div className="relative overflow-hidden px-5 pb-8 pt-6">
                <div className="hero-glow pointer-events-none absolute inset-0 opacity-80" />
                <div className="relative">
                  <div className="flex items-center justify-between">
                    <div className="flex -space-x-2">
                      {TEAM.map((t) => (
                        <Avatar key={t.name} {...t} className="h-9 w-9" />
                      ))}
                    </div>
                    <button
                      onClick={() => setOpen(false)}
                      aria-label="Close"
                      className="rounded-full p-1.5 text-textSecondary transition-colors hover:bg-white/5 hover:text-white"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                  <h2 className="mt-5 text-[26px] font-extrabold leading-tight tracking-tight text-white/60">
                    Hi there.
                  </h2>
                  <h2 className="text-[26px] font-extrabold leading-tight tracking-tight">
                    How can we help?
                  </h2>
                </div>
              </div>

              <div className="space-y-3 px-4 pb-4">
                {/* Send-us-a-message card */}
                <button
                  onClick={() => openChat()}
                  className="tap flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left transition-colors hover:border-neon/40"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-neon/30 bg-neonSoft text-neon">
                    <Sparkles className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold">Send us a message</p>
                    <p className="flex items-center gap-1.5 text-[12px] text-textSecondary">
                      <span className="h-1.5 w-1.5 rounded-full bg-neon" /> We typically reply in a few minutes
                    </p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-textSecondary" />
                </button>

                {/* Search */}
                <button
                  onClick={() => setTab("help")}
                  className="tap flex w-full items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left text-[13px] text-textSecondary transition-colors hover:border-white/20"
                >
                  <Search className="h-4 w-4" />
                  Search for help
                </button>

                {/* Popular articles */}
                <div className="rounded-2xl border border-white/10 bg-white/[0.02]">
                  {ARTICLES.slice(0, 4).map((a, i) => (
                    <button
                      key={a.q}
                      onClick={() => setTab("help")}
                      className={`flex w-full items-center gap-3 px-4 py-3 text-left text-[13px] transition-colors hover:bg-white/[0.03] ${
                        i > 0 ? "border-t border-white/[0.06]" : ""
                      }`}
                    >
                      <span className="flex-1 truncate">{a.q}</span>
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-textSecondary" />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── MESSAGES ─────────────────────────────────────────── */}
          {tab === "messages" && (
            <>
              <div className="flex items-center gap-3 border-b border-white/10 bg-white/[0.03] px-4 py-3">
                <button
                  onClick={() => setTab("home")}
                  aria-label="Back"
                  className="rounded-lg p-1 text-textSecondary transition-colors hover:bg-white/5 hover:text-white"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <div className="flex -space-x-2">
                  {TEAM.slice(0, 2).map((t) => (
                    <Avatar key={t.name} {...t} className="h-8 w-8" />
                  ))}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold leading-tight">Furlpay Support</p>
                  <p className="flex items-center gap-1.5 text-[11px] text-textSecondary">
                    <span className="h-1.5 w-1.5 rounded-full bg-neon" /> Online
                  </p>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="rounded-lg p-1.5 text-textSecondary transition-colors hover:bg-white/5 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
                {messages.map((m, i) => (
                  <div key={i} className={m.from === "user" ? "flex justify-end" : "flex items-end gap-2"}>
                    {m.from === "bot" && <Avatar {...TEAM[0]} className="h-6 w-6" />}
                    <div
                      className={
                        m.from === "user"
                          ? "max-w-[80%] rounded-2xl rounded-br-md bg-neon px-3.5 py-2 text-[13px] font-medium text-black"
                          : "max-w-[85%] rounded-2xl rounded-bl-md border border-white/10 bg-white/[0.04] px-3.5 py-2 text-[13px] leading-relaxed"
                      }
                    >
                      {m.text}
                    </div>
                  </div>
                ))}

                {typing && (
                  <div className="flex items-end gap-2">
                    <Avatar {...TEAM[0]} className="h-6 w-6" />
                    <div className="flex items-center gap-1 rounded-2xl rounded-bl-md border border-white/10 bg-white/[0.04] px-4 py-3">
                      {[0, 150, 300].map((d) => (
                        <span
                          key={d}
                          className="h-1.5 w-1.5 animate-bounce rounded-full bg-textSecondary"
                          style={{ animationDelay: `${d}ms` }}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {messages.length === 1 && !typing && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {QUICK_ACTIONS.map((a) => (
                      <button
                        key={a}
                        onClick={() => send(a)}
                        className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[12px] text-textSecondary transition-colors hover:border-neon/40 hover:text-neon"
                      >
                        {a}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  send(input);
                }}
                className="flex items-center gap-2 border-t border-white/10 px-3 py-3"
              >
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Write a message…"
                  aria-label="Message"
                  className="min-w-0 flex-1 rounded-pill bg-white/[0.05] px-4 py-2.5 text-[13px] outline-none ring-1 ring-transparent transition focus:ring-neon/40 placeholder:text-textMuted"
                />
                <button
                  type="submit"
                  disabled={!input.trim()}
                  aria-label="Send"
                  className="tap flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neon text-black disabled:opacity-40"
                >
                  <Send className="h-4 w-4" />
                </button>
              </form>
            </>
          )}

          {/* ── HELP ─────────────────────────────────────────────── */}
          {tab === "help" && (
            <>
              <div className="flex items-center gap-3 border-b border-white/10 bg-white/[0.03] px-4 py-3">
                <p className="flex-1 text-[15px] font-bold">Help center</p>
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="rounded-lg p-1.5 text-textSecondary transition-colors hover:bg-white/5 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="px-4 pt-4">
                <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5">
                  <Search className="h-4 w-4 text-textSecondary" />
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search for help"
                    aria-label="Search help"
                    className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-textMuted"
                  />
                </div>
              </div>
              <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
                {results.length === 0 ? (
                  <p className="px-1 py-6 text-center text-[13px] text-textSecondary">
                    No articles match “{query}”. Try the Messages tab to ask us directly.
                  </p>
                ) : (
                  <div className="rounded-2xl border border-white/10 bg-white/[0.02]">
                    {results.map((a, i) => (
                      <button
                        key={a.q}
                        onClick={() => openChat(a.q)}
                        className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-white/[0.03] ${
                          i > 0 ? "border-t border-white/[0.06]" : ""
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium">{a.q}</p>
                          <p className="text-[11px] text-textMuted">{a.tag}</p>
                        </div>
                        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-textSecondary" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── TAB BAR ──────────────────────────────────────────── */}
          <nav className="flex items-stretch border-t border-white/10 bg-black/40">
            {(
              [
                { id: "home", label: "Home", Icon: House },
                { id: "messages", label: "Messages", Icon: MessagesSquare },
                { id: "help", label: "Help", Icon: LifeBuoy },
              ] as const
            ).map(({ id, label, Icon }) => {
              const active = tab === id;
              return (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-semibold transition-colors ${
                    active ? "text-neon" : "text-textSecondary hover:text-white"
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  {label}
                </button>
              );
            })}
          </nav>

          <p className="flex items-center justify-center gap-1 border-t border-white/5 bg-black/40 py-1.5 text-[10px] text-textMuted">
            <ShieldCheck className="h-3 w-3" /> Messages reach our support team · PII masked
          </p>
        </div>
      )}

      {/* Launcher */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close support" : "Open support"}
        aria-expanded={open}
        className="tap group fixed bottom-6 right-6 z-[1000] flex h-14 w-14 items-center justify-center rounded-full bg-neon text-black shadow-glow transition-transform hover:scale-105"
      >
        <span className="relative flex h-6 w-6 items-center justify-center">
          <MessagesSquare
            className={`absolute h-6 w-6 transition-all duration-300 ${open ? "rotate-90 scale-0 opacity-0" : "rotate-0 scale-100 opacity-100"}`}
          />
          <X
            className={`absolute h-6 w-6 transition-all duration-300 ${open ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-0 opacity-0"}`}
          />
        </span>
        {!open && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-70" />
            <span className="relative inline-flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[9px] font-bold text-white ring-2 ring-[#0b0b0d]">
              1
            </span>
          </span>
        )}
      </button>
    </>
  );
}
