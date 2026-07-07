"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Send, Sparkles, ShieldCheck, ArrowLeft } from "lucide-react";
import { postJSON, sendJSON } from "@/lib/api";

interface Confirmation {
  action: string;
  method: "POST";
  endpoint: string;
  body: Record<string, unknown>;
  summary: string;
  amountUsd?: number;
}
interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
}
interface CopilotResult {
  intent: string;
  reply: string;
  toolCalls: ToolCall[];
  suggestions: string[];
  requiresConfirmation?: Confirmation;
}
interface Msg {
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCall[];
  confirmation?: Confirmation;
  suggestions?: string[];
}

const GREETING: Msg = {
  role: "assistant",
  content:
    "Hi — I'm your FurlPay co-pilot. I can check balances, analyze spending, book travel, invest, earn yield, swap and pay. What can I do for you?",
  suggestions: [
    "How much did I spend on travel this month?",
    "Earn yield on my idle USDC",
    "Set up a $50/week DCA into AAPL",
    "Book a hotel in Tokyo",
  ],
};

export default function ChatPage() {
  const [messages, setMessages] = useState<Msg[]>([GREETING]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmState, setConfirmState] = useState<Record<string, "done" | "loading">>({});
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  const send = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q || busy) return;
      const history: Msg[] = [...messages, { role: "user", content: q }];
      setMessages(history);
      setInput("");
      setBusy(true);
      try {
        const res = await sendJSON<CopilotResult>("/api/chat", {
          messages: history.map((m) => ({ role: m.role, content: m.content })),
        });
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: res.reply,
            toolCalls: res.toolCalls,
            confirmation: res.requiresConfirmation,
            suggestions: res.suggestions,
          },
        ]);
      } catch {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "Something went wrong reaching the co-pilot. Please try again." },
        ]);
      } finally {
        setBusy(false);
      }
    },
    [busy, messages],
  );

  const confirm = useCallback(async (c: Confirmation) => {
    setConfirmState((s) => ({ ...s, [c.action]: "loading" }));
    try {
      const { ok } = await postJSON(c.endpoint, c.body);
      if (!ok) throw new Error("rejected");
      setConfirmState((s) => ({ ...s, [c.action]: "done" }));
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `✓ Done — ${c.summary.toLowerCase()}.` },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `I couldn't complete "${c.summary}". Please try from the app.` },
      ]);
      setConfirmState((s) => {
        const next = { ...s };
        delete next[c.action];
        return next;
      });
    }
  }, []);

  return (
    <div className="flex h-[100dvh] flex-col">
      <header className="flex items-center gap-3 border-b border-white/10 px-5 py-3">
        <Link href="/dashboard" aria-label="Back" className="text-white/60 hover:text-white">
          <ArrowLeft size={20} />
        </Link>
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accentDeep">
          <Sparkles size={18} />
        </div>
        <div>
          <h1 className="text-sm font-semibold">FurlPay Co-Pilot</h1>
          <p className="text-[11px] text-white/50">Pays · books travel · invests · earns</p>
        </div>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div className="max-w-[85%] space-y-2">
              <div
                className={
                  m.role === "user"
                    ? "rounded-2xl rounded-br-sm bg-accent px-4 py-2.5 text-sm text-white"
                    : "rounded-2xl rounded-bl-sm bg-white/[0.06] px-4 py-2.5 text-sm text-white/90"
                }
              >
                {m.content}
              </div>

              {m.toolCalls && m.toolCalls.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pl-1">
                  {m.toolCalls.map((tc, j) => (
                    <span
                      key={j}
                      className="rounded-full bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] text-white/40"
                    >
                      {tc.tool}()
                    </span>
                  ))}
                </div>
              )}

              {m.confirmation && (
                <div className="rounded-xl border border-accent/40 bg-accent/[0.06] p-3">
                  <div className="flex items-center gap-2 text-[11px] font-medium text-accent">
                    <ShieldCheck size={13} /> Confirm required
                  </div>
                  <p className="mt-1 text-sm text-white/90">{m.confirmation.summary}</p>
                  <button
                    onClick={() => m.confirmation && confirm(m.confirmation)}
                    disabled={confirmState[m.confirmation.action] === "loading" || confirmState[m.confirmation.action] === "done"}
                    className="mt-2 w-full rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {confirmState[m.confirmation.action] === "done"
                      ? "Confirmed ✓"
                      : confirmState[m.confirmation.action] === "loading"
                        ? "Working…"
                        : "Confirm"}
                  </button>
                </div>
              )}

              {m.suggestions && m.suggestions.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pl-1">
                  {m.suggestions.map((s, j) => (
                    <button
                      key={j}
                      onClick={() => send(s)}
                      className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] text-white/70 hover:bg-white/[0.08]"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm bg-white/[0.06] px-4 py-3 text-sm text-white/50">
              <span className="inline-flex gap-1">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/50 [animation-delay:-0.3s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/50 [animation-delay:-0.15s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/50" />
              </span>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex items-center gap-2 border-t border-white/10 px-4 py-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask anything about your money…"
          className="flex-1 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm outline-none placeholder:text-white/30 focus:border-accent/50"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          aria-label="Send"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-white disabled:opacity-40"
        >
          <Send size={17} />
        </button>
      </form>
    </div>
  );
}
