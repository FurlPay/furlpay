"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ChevronLeft,
  ExternalLink,
  House,
  LifeBuoy,
  MessagesSquare,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import type { KbIndexEntry } from "@/app/api/support/kb/route";
import {
  clearChat,
  readChat,
  toAskHistory,
  toTranscript,
  writeChat,
  type ChatMessage,
} from "@/lib/support/widgetSession";

// ---------------------------------------------------------------------------
// FurlPay support Messenger — Home / Messages / Help.
//
// ── THE ASSISTANT IS REAL ──────────────────────────────────────────────────
// This widget used to answer from `demoReply()`: a keyword match returning
// canned strings, including a confident "Your identity verification is Tier 2 —
// verified" to any visitor who typed "kyc". It stated a stranger's account
// status as fact, on a marketing page, having looked nothing up.
//
// Every reply now comes from POST /api/support/ask — retrieval over the 14
// published help-centre articles, grounded generation, real citations, and an
// explicit escalation flag when the corpus does not cover the question. The
// answer renders with its sources as links, so a visitor can check it.
//
// ── AND IT ANSWERS ONLY WHAT IT CAN KNOW ───────────────────────────────────
// The quick actions no longer offer "Check my KYC status" or "Freeze a card".
// Nothing here is authenticated — there is no user, no session, no account to
// read — so those were offers this surface cannot honour. They are now the
// questions the help centre can actually answer. Account-specific work lives
// behind the sign-in, and the handoff says so.
//
// ── THE HANDOFF IS ONE ACTION, NOT EVERY MESSAGE ───────────────────────────
// The old widget POSTed to /api/support/message on EVERY send, fire-and-forget.
// That endpoint emails the support inbox and is limited to 5 per 10 minutes, so
// a six-message conversation sent six emails and then silently 429'd behind a
// `.catch(() => undefined)`. Handoff is now a deliberate act that sends the
// transcript once.
// ---------------------------------------------------------------------------

type Tab = "home" | "messages" | "help";

const TEAM = [
  { name: "Nimer", from: "#00E599", to: "#00B87A" },
  { name: "Wesam", from: "#FF3B30", to: "#E02020" },
  { name: "Ava", from: "#6366F1", to: "#8B5CF6" },
];

const GREETING_TEXT =
  "Hi — I'm the FurlPay assistant. I can answer from our help centre on deposits, cards, KYC, travel and the developer APIs, and cite where the answer came from. What do you need?";

/**
 * Openers the help centre can actually answer.
 *
 * Each maps onto a real article in lib/support/kb.ts. A quick action that
 * retrieves nothing is worse than no quick action: it teaches the visitor in
 * one tap that the assistant does not work.
 */
const QUICK_ACTIONS = [
  "How do deposits and withdrawals work?",
  "Why was my card declined?",
  "What are the KYC tiers?",
];

function greeting(): ChatMessage {
  return { from: "bot", text: GREETING_TEXT, at: Date.now() };
}

function Avatar({
  name, from, to, className = "",
}: { name: string; from: string; to: string; className?: string }) {
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
  const [shown, setShown] = useState(false);
  const [tab, setTab] = useState<Tab>("home");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [query, setQuery] = useState("");
  const [articles, setArticles] = useState<KbIndexEntry[] | null>(null);
  const [kbError, setKbError] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inflight = useRef<AbortController | null>(null);

  // Restored AFTER mount. Reading storage during render would make the server
  // and client disagree about the transcript and throw the tree away.
  useEffect(() => {
    const stored = readChat();
    setMessages(stored.length ? stored : [greeting()]);
  }, []);

  useEffect(() => {
    if (messages.length) writeChat(messages);
  }, [messages]);

  useEffect(() => {
    if (open) {
      const id = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(id);
    }
    setShown(false);
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking, tab]);

  // The help shelf, fetched once when the Help tab is first opened. Not at
  // mount: this widget is on every marketing page and most visitors never open
  // it, so a request on load would be one per page view for nothing.
  useEffect(() => {
    if (tab !== "help" || articles !== null) return;
    const ac = new AbortController();
    void (async () => {
      try {
        const res = await fetch("/api/support/kb", { signal: ac.signal });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { articles: KbIndexEntry[] };
        setArticles(data.articles);
      } catch {
        if (!ac.signal.aborted) setKbError(true);
      }
    })();
    return () => ac.abort();
  }, [tab, articles]);

  // Search runs server-side so it uses the SAME retrieval the assistant does —
  // a visitor searching "cancel transfer" and the model answering that question
  // consult one ranking, not two that can disagree.
  useEffect(() => {
    if (tab !== "help") return;
    const q = query.trim();
    const ac = new AbortController();
    const t = setTimeout(
      () => {
        void (async () => {
          try {
            const res = await fetch(`/api/support/kb?q=${encodeURIComponent(q)}`, {
              signal: ac.signal,
            });
            if (!res.ok) throw new Error(String(res.status));
            const data = (await res.json()) as { articles: KbIndexEntry[]; query: string };
            // Guard against an out-of-order response overwriting a newer query.
            if (data.query === q) setArticles(data.articles);
          } catch {
            /* keep whatever shelf is already showing */
          }
        })();
      },
      q ? 220 : 0
    );
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [query, tab]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || thinking) return;
      setInput("");

      const userTurn: ChatMessage = { from: "user", text: trimmed, at: Date.now() };
      const withUser = [...messages, userTurn];
      setMessages(withUser);
      setThinking(true);

      inflight.current?.abort();
      const ac = new AbortController();
      inflight.current = ac;

      try {
        const res = await fetch("/api/support/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: trimmed,
            history: toAskHistory(messages, GREETING_TEXT),
          }),
          signal: ac.signal,
        });

        if (res.status === 429) {
          setMessages((m) => [
            ...m,
            {
              from: "bot",
              // Named for what it is. "Something went wrong" would send someone
              // to retry immediately, which is the one thing that cannot work.
              text: "I'm getting a lot of questions right now — give me a minute and try again, or hand this to a human below.",
              escalate: true,
              at: Date.now(),
            },
          ]);
          return;
        }
        if (!res.ok) throw new Error(String(res.status));

        const data = (await res.json()) as {
          answer: string;
          sources: { title: string; href: string }[];
          escalate: boolean;
        };
        setMessages((m) => [
          ...m,
          {
            from: "bot",
            text: data.answer,
            sources: data.sources?.length ? data.sources : undefined,
            escalate: data.escalate,
            at: Date.now(),
          },
        ]);
      } catch (e) {
        if (ac.signal.aborted || (e instanceof Error && e.name === "AbortError")) return;
        setMessages((m) => [
          ...m,
          {
            from: "bot",
            text: "I couldn't reach the help centre just then. You can send this to a human instead — they'll see the whole conversation.",
            escalate: true,
            at: Date.now(),
          },
        ]);
      } finally {
        if (!ac.signal.aborted) setThinking(false);
      }
    },
    [messages, thinking]
  );

  useEffect(() => () => inflight.current?.abort(), []);

  function openChat(seed?: string) {
    setTab("messages");
    if (seed) void send(seed);
  }

  // The most recent bot turn decides whether the handoff is offered, so it
  // appears exactly when the assistant has just said it cannot help.
  const last = messages[messages.length - 1];
  const offerHandoff = Boolean(last?.from === "bot" && last.escalate);

  return (
    <>
      {open && (
        <div
          role="dialog"
          aria-label="FurlPay support"
          className={`fixed bottom-24 right-6 z-[1000] flex h-[600px] max-h-[calc(100vh-7rem)] w-[min(384px,calc(100vw-3rem))] flex-col overflow-hidden rounded-[26px] border border-white/10 bg-[#0b0b0d] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.85)] backdrop-blur-2xl transition-all duration-300 ease-out ${
            shown ? "translate-y-0 scale-100 opacity-100" : "translate-y-4 scale-95 opacity-0"
          }`}
        >
          {/* ── HOME ─────────────────────────────────────────────── */}
          {tab === "home" && (
            <div className="flex-1 overflow-y-auto">
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
                <button
                  onClick={() => openChat()}
                  className="tap flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left transition-colors hover:border-neon/40"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-neon/30 bg-neonSoft text-neon">
                    <Sparkles className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold">Ask the assistant</p>
                    {/* What it does, not a delivery promise. There is no agent
                        presence system behind this widget, so "we typically
                        reply in a few minutes" was a claim nothing measured. */}
                    <p className="text-[12px] text-textSecondary">
                      Answers from our help centre, with sources
                    </p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-textSecondary" />
                </button>

                <button
                  onClick={() => setTab("help")}
                  className="tap flex w-full items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left text-[13px] text-textSecondary transition-colors hover:border-white/20"
                >
                  <Search className="h-4 w-4" />
                  Browse the help centre
                </button>

                <div className="rounded-2xl border border-white/10 bg-white/[0.02]">
                  {QUICK_ACTIONS.map((q, i) => (
                    <button
                      key={q}
                      onClick={() => openChat(q)}
                      className={`flex w-full items-center gap-3 px-4 py-3 text-left text-[13px] transition-colors hover:bg-white/[0.03] ${
                        i > 0 ? "border-t border-white/[0.06]" : ""
                      }`}
                    >
                      <span className="flex-1">{q}</span>
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
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-neon/30 bg-neonSoft text-neon">
                  <Sparkles className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold leading-tight">FurlPay assistant</p>
                  {/* Says what it IS. The old header showed a green dot and the
                      word "Online" unconditionally — there is no presence
                      signal behind this widget, so that dot was decoration
                      claiming to be a status. */}
                  <p className="text-[11px] text-textSecondary">
                    Grounded in our help centre · human handoff any time
                  </p>
                </div>
                {messages.length > 1 && (
                  <button
                    onClick={() => setMessages([greeting()])}
                    className="rounded-lg px-2 py-1 text-[11px] font-semibold text-textSecondary transition-colors hover:bg-white/5 hover:text-white"
                  >
                    Clear
                  </button>
                )}
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="rounded-lg p-1.5 text-textSecondary transition-colors hover:bg-white/5 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div
                ref={scrollRef}
                className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
                aria-live="polite"
                aria-busy={thinking}
              >
                {messages.map((m, i) => (
                  <div
                    key={`${m.at}-${i}`}
                    className={m.from === "user" ? "flex justify-end" : "flex items-end gap-2"}
                  >
                    {m.from === "bot" && (
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-neon/30 bg-neonSoft text-neon">
                        <Sparkles className="h-3 w-3" />
                      </span>
                    )}
                    <div
                      className={
                        m.from === "user"
                          ? "max-w-[80%] rounded-2xl rounded-br-md bg-neon px-3.5 py-2 text-[13px] font-medium text-black"
                          : "max-w-[85%] rounded-2xl rounded-bl-md border border-white/10 bg-white/[0.04] px-3.5 py-2 text-[13px] leading-relaxed"
                      }
                    >
                      <p className="whitespace-pre-wrap">{m.text}</p>

                      {/* Citations. The point of a grounded answer is that it
                          can be checked, which needs the article to be one
                          click away rather than named in passing. */}
                      {m.sources && m.sources.length > 0 && (
                        <div className="mt-2 space-y-1 border-t border-white/10 pt-2">
                          {m.sources.map((s) => (
                            <a
                              key={s.href}
                              href={s.href}
                              className="flex items-center gap-1.5 text-[11.5px] font-medium text-neon transition-opacity hover:opacity-75"
                            >
                              <ExternalLink className="h-3 w-3 shrink-0" />
                              <span className="truncate">{s.title}</span>
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {thinking && (
                  <div className="flex items-end gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-neon/30 bg-neonSoft text-neon">
                      <Sparkles className="h-3 w-3" />
                    </span>
                    {/* A real pending state now: it starts when the request
                        goes out and ends when it lands, rather than running a
                        900ms timer to imitate thought. */}
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

                {messages.length === 1 && !thinking && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {QUICK_ACTIONS.map((a) => (
                      <button
                        key={a}
                        onClick={() => void send(a)}
                        className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[12px] text-textSecondary transition-colors hover:border-neon/40 hover:text-neon"
                      >
                        {a}
                      </button>
                    ))}
                  </div>
                )}

                {offerHandoff && !thinking && (
                  <HumanHandoff messages={messages} onSent={() => setMessages((m) => [...m])} />
                )}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void send(input);
                }}
                className="flex items-center gap-2 border-t border-white/10 px-3 py-3"
              >
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask about deposits, cards, KYC…"
                  aria-label="Message"
                  className="min-w-0 flex-1 rounded-pill bg-white/[0.05] px-4 py-2.5 text-[13px] outline-none ring-1 ring-transparent transition focus:ring-neon/40 placeholder:text-textMuted"
                />
                <button
                  type="submit"
                  disabled={!input.trim() || thinking}
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
                <p className="flex-1 text-[15px] font-bold">Help centre</p>
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
                    placeholder="Search the help centre"
                    aria-label="Search help"
                    className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-textMuted"
                  />
                </div>
              </div>
              <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
                {kbError ? (
                  <p className="px-1 py-6 text-center text-[13px] text-textSecondary">
                    The help centre index couldn&apos;t be loaded. You can still ask in Messages.
                  </p>
                ) : articles === null ? (
                  <p className="px-1 py-6 text-center text-[13px] text-textMuted">Loading…</p>
                ) : articles.length === 0 ? (
                  <p className="px-1 py-6 text-center text-[13px] text-textSecondary">
                    No articles match “{query}”.{" "}
                    <button
                      onClick={() => openChat(query)}
                      className="font-semibold text-neon underline-offset-2 hover:underline"
                    >
                      Ask the assistant instead
                    </button>
                  </p>
                ) : (
                  <div className="rounded-2xl border border-white/10 bg-white/[0.02]">
                    {/* Real articles at real URLs. These used to be six invented
                        titles that matched nothing and linked nowhere — tapping
                        one seeded a chat rather than opening the page. */}
                    {articles.map((a, i) => (
                      <a
                        key={a.id}
                        href={a.href}
                        className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-white/[0.03] ${
                          i > 0 ? "border-t border-white/[0.06]" : ""
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium">{a.title}</p>
                          <p className="text-[11px] capitalize text-textMuted">
                            {a.category.replace(/_/g, " ")}
                          </p>
                        </div>
                        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-textSecondary" />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

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
            <ShieldCheck className="h-3 w-3" /> Card numbers and recovery phrases are masked before
            sending
          </p>
        </div>
      )}

      {/* Launcher. No badge: there is no inbox behind this widget for an
          unauthenticated visitor, so the "1" it used to show was a permanent
          notification for a message that did not exist. */}
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
      </button>
    </>
  );
}

/**
 * Hand the conversation to a person.
 *
 * Shown only after the assistant says it cannot help, and it sends ONCE — the
 * mailbox endpoint allows 5 posts per 10 minutes and emails support on each,
 * which is a budget for deliberate handoffs, not for every typed line.
 *
 * The email address is optional because demanding one to ask a question is how
 * a support widget becomes a lead-capture form. Without it the team still gets
 * the transcript; they just cannot reply, and the copy says exactly that.
 */
function HumanHandoff({
  messages,
  onSent,
}: {
  messages: ChatMessage[];
  onSent: () => void;
}) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error" | "throttled">("idle");

  if (state === "sent") {
    return (
      <div className="rounded-2xl border border-neon/30 bg-neonSoft px-4 py-3 text-[12.5px] text-neon">
        Sent to our support team.{" "}
        {email
          ? "They'll reply to that address."
          : "Add an email next time if you'd like a reply."}
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (state === "sending") return;
    setState("sending");

    // The last thing the visitor actually asked — the mailbox wants a subject
    // line, and the transcript carries the rest.
    const lastUser = [...messages].reverse().find((m) => m.from === "user");

    try {
      const res = await fetch("/api/support/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: lastUser?.text ?? "Visitor asked for a human from the chat widget.",
          ...(email.trim() ? { email: email.trim() } : {}),
          page: window.location.pathname,
          transcript: toTranscript(messages),
        }),
      });
      if (res.status === 429) return setState("throttled");
      if (!res.ok) throw new Error(String(res.status));
      setState("sent");
      onSent();
    } catch {
      setState("error");
    }
  };

  return (
    <form
      onSubmit={submit}
      className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3"
    >
      <p className="text-[12.5px] font-semibold">Send this to a human</p>
      <p className="text-[11.5px] leading-relaxed text-textSecondary">
        Our team gets the whole conversation. Anything about your own account needs you signed in —
        they&apos;ll point you there.
      </p>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email (optional, so we can reply)"
        aria-label="Your email address"
        className="w-full rounded-pill bg-white/[0.05] px-3.5 py-2 text-[12.5px] outline-none ring-1 ring-transparent transition focus:ring-neon/40 placeholder:text-textMuted"
      />
      {state === "error" && (
        <p className="text-[11.5px] text-loss">That didn&apos;t send. Try once more.</p>
      )}
      {state === "throttled" && (
        <p className="text-[11.5px] text-loss">
          A few messages have gone through already — give it a few minutes.
        </p>
      )}
      <button
        type="submit"
        disabled={state === "sending"}
        className="tap w-full rounded-pill bg-neon py-2 text-[12.5px] font-bold text-black disabled:opacity-50"
      >
        {state === "sending" ? "Sending…" : "Send to support"}
      </button>
    </form>
  );
}
