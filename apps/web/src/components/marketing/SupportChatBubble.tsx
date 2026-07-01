"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, MessageCircle, Send, X, ShieldCheck } from "lucide-react";

// ---------------------------------------------------------------------------
// Floating agentic support widget (landing page, bottom-right). Glassmorphic
// neon-bordered bubble with a pulsing "online" dot that expands into a chat
// panel. This is a self-contained DEMO assistant: replies are canned and no
// real PII is sent anywhere. A production build wires the panel to the secure
// support router (KYC lookups via Persona hooks, card locks gated on a passkey
// re-auth) with PII masked before processing.
// ---------------------------------------------------------------------------

interface Msg {
  from: "bot" | "user";
  text: string;
}

const GREETING: Msg = {
  from: "bot",
  text: "Hi, I'm the Furlpay assistant. I can check KYC status, look up a transaction, or freeze a card. How can I help?",
};

const QUICK_ACTIONS = [
  "Check my KYC status",
  "Look up a transaction",
  "Freeze a card",
];

// Canned demo responses. Replaced by the live support agent in production.
function demoReply(input: string): string {
  const q = input.toLowerCase();
  if (q.includes("kyc"))
    return "Your identity verification is Tier 2 — verified. You can raise limits by completing Tier 3 in Profile → Verification.";
  if (q.includes("transaction") || q.includes("lookup") || q.includes("look up"))
    return "Share the transaction ID (e.g. tx_1a2b3c) and I'll pull its status. For your security, full payloads stay masked.";
  if (q.includes("freeze") || q.includes("lock") || q.includes("card"))
    return "I can freeze a card instantly. For safety this needs a passkey confirmation — I'll trigger the biometric prompt once you pick the card.";
  return "Thanks! A support specialist will follow up. Meanwhile, the Docs and Security pages cover most integration questions.";
}

export default function SupportChatBubble() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([GREETING]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setInput("");
    setMessages((m) => [...m, { from: "user", text: trimmed }]);
    // Simulate the assistant "thinking" before replying.
    setTimeout(() => {
      setMessages((m) => [...m, { from: "bot", text: demoReply(trimmed) }]);
    }, 500);
  }

  return (
    <>
      {/* Chat panel */}
      {open && (
        <div
          role="dialog"
          aria-label="Furlpay support assistant"
          className="glass-card fixed bottom-24 right-6 z-[1000] flex h-[460px] w-[min(360px,calc(100vw-3rem))] flex-col overflow-hidden shadow-2xl"
        >
          {/* Header */}
          <div className="flex items-center gap-3 border-b border-white/10 bg-white/[0.03] px-4 py-3">
            <span className="relative flex h-9 w-9 items-center justify-center rounded-full border border-neon/30 bg-neonSoft text-neon">
              <Bot className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-tight">Furlpay Assistant</p>
              <p className="flex items-center gap-1.5 text-[11px] text-textSecondary">
                <span className="h-1.5 w-1.5 rounded-full bg-neon" /> Online · replies instantly
              </p>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close chat"
              className="rounded-lg p-1.5 text-textSecondary transition-colors hover:bg-white/5 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.map((m, i) => (
              <div key={i} className={m.from === "user" ? "flex justify-end" : "flex justify-start"}>
                <div
                  className={
                    m.from === "user"
                      ? "max-w-[80%] rounded-2xl rounded-br-sm bg-neon px-3.5 py-2 text-[13px] font-medium text-black"
                      : "max-w-[85%] rounded-2xl rounded-bl-sm border border-white/10 bg-white/[0.04] px-3.5 py-2 text-[13px] leading-relaxed text-textPrimary"
                  }
                >
                  {m.text}
                </div>
              </div>
            ))}
            {messages.length === 1 && (
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

          {/* Input */}
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
              placeholder="Ask anything…"
              aria-label="Message"
              className="min-w-0 flex-1 rounded-pill bg-surface px-4 py-2.5 text-[13px] outline-none placeholder:text-textMuted"
            />
            <button
              type="submit"
              disabled={!input.trim()}
              aria-label="Send message"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neon text-black transition-transform hover:-translate-y-0.5 disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>

          <p className="flex items-center justify-center gap-1 border-t border-white/5 bg-black/40 py-1.5 text-[10px] text-textMuted">
            <ShieldCheck className="h-3 w-3" /> PII masked · GDPR-compliant demo assistant
          </p>
        </div>
      )}

      {/* Floating bubble */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close support chat" : "Open support chat"}
        aria-expanded={open}
        className="glass-card fixed bottom-6 right-6 z-[1000] flex h-14 w-14 items-center justify-center rounded-full border-neon/30 text-neon shadow-glow transition-transform hover:scale-110 hover:border-neon/80"
      >
        {open ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
        {!open && (
          <span className="absolute right-1 top-1 flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-neon opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full border-2 border-black bg-neon" />
          </span>
        )}
      </button>
    </>
  );
}
