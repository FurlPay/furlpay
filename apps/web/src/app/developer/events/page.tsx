"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import MarketingBar from "@/components/marketing/MarketingBar";

const EVENTS = [
  { id: "evt_9f21", type: "x402.settled", time: "12:45:02", detail: "0.01 USDC · base · payer 0x11…", ok: true },
  { id: "evt_9f20", type: "agent.spend", time: "12:44:51", detail: "Claude-Shopping · Amazon · $8.99", ok: true },
  { id: "evt_9f1f", type: "payment.completed", time: "12:32:10", detail: "cs_1a2b · $49.99 USDC", ok: true },
  { id: "evt_9f1e", type: "card.issued", time: "12:20:44", detail: "virtual · Visa · •••• 4417", ok: true },
  { id: "evt_9f1d", type: "x402.verified", time: "12:15:03", detail: "GPT-Research · Apify · $0.02", ok: true },
  { id: "evt_9f1c", type: "agent.authorized", time: "12:02:19", detail: "Cursor-DevOps · ak_live_b0d4…", ok: true },
  { id: "evt_9f1b", type: "kyc.approved", time: "11:59:00", detail: "Tier 2 · Persona", ok: true },
  { id: "evt_9f1a", type: "payment.failed", time: "11:58:12", detail: "insufficient_balance", ok: false },
  { id: "evt_9f19", type: "wallet.funded", time: "11:40:33", detail: "SEPA · €1,000 → EURC", ok: true },
];

export default function EventsPage() {
  const [q, setQ] = useState("");
  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return EVENTS;
    return EVENTS.filter((e) => e.type.includes(t) || e.detail.toLowerCase().includes(t) || e.id.includes(t));
  }, [q]);

  return (
    <div className="min-h-screen bg-oled">
      <MarketingBar />
      <main className="mx-auto max-w-4xl px-6 pb-24 pt-12">
        <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.18em] text-neon">Developer · Event log</p>
        <h1 className="text-[32px] font-extrabold tracking-tighter sm:text-[40px]">Events</h1>

        <div className="mt-6 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
          <Search className="h-4 w-4 text-textSecondary" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search events — try 'x402', 'agent', 'card'…"
            className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-textMuted"
          />
        </div>

        <div className="mt-4 divide-y divide-white/[0.06] overflow-hidden rounded-2xl border border-white/10">
          {results.length === 0 ? (
            <p className="px-5 py-10 text-center text-[13px] text-textSecondary">No events match “{q}”.</p>
          ) : (
            results.map((e) => (
              <div key={e.id} className="flex items-center gap-3 px-5 py-3.5 text-[13px]">
                <span className={`h-2 w-2 shrink-0 rounded-full ${e.ok ? "bg-gain" : "bg-loss"}`} />
                <code className="w-44 shrink-0 truncate font-mono text-white/90">{e.type}</code>
                <span className="min-w-0 flex-1 truncate text-textSecondary">{e.detail}</span>
                <span className="hidden shrink-0 font-mono text-[11px] text-textMuted sm:block">{e.id}</span>
                <span className="w-16 shrink-0 text-right text-[11px] text-textMuted">{e.time}</span>
              </div>
            ))
          )}
        </div>
        <p className="mt-3 text-[12px] text-textMuted">Demo log. Production streams every API call + webhook delivery, searchable and filterable.</p>
      </main>
    </div>
  );
}
