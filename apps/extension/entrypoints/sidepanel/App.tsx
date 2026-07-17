import { useRef, useState } from "react";
import { parseQuery } from "@/lib/travelParse";
import type { BgRequest, BgResponse } from "@/lib/types";

// FurlPay Travel Agent side panel. Free-text request → structured search
// against /api/travel/search (Duffel-backed on furlpay.com) → bookable cards.
// Booking hands off to furlpay.com where the x402/USDC settlement and passkey
// signature happen.

interface Stay {
  id: string;
  name: string;
  city: string;
  stars?: number;
  nightlyUsd?: number;
  pricePerNightUsd?: number;
  totalUsd?: number;
  [key: string]: unknown;
}

interface ChatMessage {
  role: "user" | "agent";
  text: string;
  stays?: Stay[];
}

function send<T>(message: BgRequest): Promise<BgResponse<T>> {
  return browser.runtime.sendMessage(message) as Promise<BgResponse<T>>;
}

// parseQuery lives in @/lib/travelParse (extracted for unit tests).

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "agent",
      text: 'Where to? Try "Find me a hotel in Tokyo under $150/night for July 20-23" — prices settle in USDC.',
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function ask() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text }]);
    setBusy(true);

    const q = parseQuery(text);
    if (!q.city) {
      setMessages((m) => [
        ...m,
        { role: "agent", text: 'Tell me the destination city, e.g. "hotels in Lisbon under $120/night".' },
      ]);
      setBusy(false);
      return;
    }

    const r = await send<{ results?: Stay[]; stays?: Stay[] }>({
      type: "TRAVEL_SEARCH",
      payload: {
        type: "stays",
        city: q.city,
        maxNightlyUsd: q.maxNightlyUsd,
        checkIn: q.checkIn,
        checkOut: q.checkOut,
        guests: 1,
      },
    });

    if (!r.ok) {
      setMessages((m) => [
        ...m,
        { role: "agent", text: `Search failed: ${r.error}. Sign in on furlpay.com and try again.` },
      ]);
    } else {
      const stays = (r.data.results ?? r.data.stays ?? []).slice(0, 5);
      setMessages((m) => [
        ...m,
        stays.length
          ? {
              role: "agent",
              text: `Top stays in ${q.city}${q.maxNightlyUsd ? ` under $${q.maxNightlyUsd}/night` : ""}:`,
              stays,
            }
          : { role: "agent", text: `No stays matched in ${q.city}. Try raising the budget or different dates.` },
      ]);
    }
    setBusy(false);
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 1e9, behavior: "smooth" }));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", position: "relative", overflow: "hidden" }}>
      <div className="glow-orb glow-orb--green" />
      <header style={{ padding: "16px 16px 10px", borderBottom: "1px solid var(--fp-border-glass)", position: "relative", zIndex: 1 }}>
        <div style={{ fontWeight: 700 }}>Travel Agent</div>
        <div style={{ fontSize: "0.72rem", color: "var(--fp-text-muted)" }}>Search, compare, book — settled in USDC</div>
      </header>

      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: 16, position: "relative", zIndex: 1 }}>
        {messages.map((msg, i) => (
          <div key={i} className="fade-up" style={{ marginBottom: 12 }}>
            <div
              style={{
                maxWidth: "88%",
                marginLeft: msg.role === "user" ? "auto" : 0,
                background: msg.role === "user" ? "rgba(16,185,129,0.12)" : "var(--fp-bg-glass)",
                border: "1px solid var(--fp-border-glass)",
                borderRadius: 12,
                padding: "10px 12px",
                fontSize: "0.85rem",
              }}
            >
              {msg.text}
            </div>
            {msg.stays?.map((stay) => {
              const nightly = stay.nightlyUsd ?? stay.pricePerNightUsd;
              return (
                <div key={stay.id} className="glass-panel" style={{ marginTop: 8, padding: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: "0.88rem" }}>{stay.name}</div>
                      <div style={{ fontSize: "0.72rem", color: "var(--fp-text-muted)" }}>
                        {stay.city}
                        {stay.stars ? ` · ${stay.stars}-star` : ""}
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flex: "none" }}>
                      {nightly !== undefined && (
                        <div style={{ fontFamily: "var(--fp-font-mono)", fontWeight: 700 }}>${Number(nightly).toFixed(0)}</div>
                      )}
                      <div style={{ fontSize: "0.65rem", color: "var(--fp-text-muted)" }}>per night · USDC</div>
                    </div>
                  </div>
                  <button
                    className="btn-primary"
                    style={{ width: "100%", marginTop: 10, padding: "9px 0" }}
                    onClick={async () => {
                      const { getBaseUrl } = await import("@/lib/api");
                      const base = await getBaseUrl();
                      browser.tabs.create({ url: `${base}/travel?city=${encodeURIComponent(stay.city)}&stay=${encodeURIComponent(stay.id)}` });
                    }}
                  >
                    Book on FurlPay
                  </button>
                </div>
              );
            })}
          </div>
        ))}
        {busy && <div style={{ color: "var(--fp-text-muted)", fontSize: "0.8rem" }}>Searching…</div>}
      </div>

      <div style={{ padding: 12, borderTop: "1px solid var(--fp-border-glass)", display: "flex", gap: 8, position: "relative", zIndex: 1 }}>
        <input
          className="input"
          placeholder="Hotel in Tokyo under $150/night, July 20-23"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ask()}
        />
        <button className="btn-primary" onClick={ask} disabled={busy} style={{ flex: "none" }}>
          Go
        </button>
      </div>
    </div>
  );
}
