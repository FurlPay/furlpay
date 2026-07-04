"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import MarketingBar from "@/components/marketing/MarketingBar";

const EVENTS = [
  "payment.completed", "payment.failed", "card.issued", "card.frozen",
  "agent.authorized", "agent.spend", "agent.revoked",
  "x402.verified", "x402.settled", "kyc.approved", "wallet.funded",
];

const DELIVERIES = [
  { time: "12:45", event: "payment.completed", code: 200, ms: 42 },
  { time: "12:32", event: "agent.spend", code: 200, ms: 38 },
  { time: "12:15", event: "x402.settled", code: 200, ms: 55 },
  { time: "11:58", event: "payment.failed", code: 500, ms: 0 },
];

const WHSEC = "whsec_FurlPay_9f21c3a7cb0d4e5f6a7b8c9d";

export default function WebhooksPage() {
  const [selected, setSelected] = useState<string[]>(["payment.completed", "agent.spend", "x402.settled"]);
  const [copied, setCopied] = useState(false);

  function toggle(e: string) {
    setSelected((s) => (s.includes(e) ? s.filter((x) => x !== e) : [...s, e]));
  }

  return (
    <div className="min-h-screen bg-oled">
      <MarketingBar />
      <main className="mx-auto max-w-4xl px-6 pb-24 pt-12">
        <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.18em] text-neon">Developer · Webhooks</p>
        <h1 className="text-[32px] font-extrabold tracking-tighter sm:text-[40px]">Webhooks</h1>

        {/* Endpoint */}
        <h2 className="mb-3 mt-8 text-[18px] font-bold tracking-tight">Endpoints</h2>
        <div className="surface-card p-4">
          <div className="flex items-center justify-between gap-2">
            <code className="min-w-0 truncate font-mono text-[13px] text-white/90">https://myapp.com/webhooks/furlpay</code>
            <span className="flex shrink-0 items-center gap-1.5 text-[12px] font-semibold text-gain">
              <span className="h-2 w-2 rounded-full bg-gain" /> Healthy · 99.8%
            </span>
          </div>
          <p className="mt-1.5 text-[12px] text-textMuted">payment.completed, agent.spend, x402.settled · last delivery 30s ago</p>
        </div>

        {/* Signing secret */}
        <h2 className="mb-3 mt-8 text-[18px] font-bold tracking-tight">Signing secret</h2>
        <div className="surface-card flex items-center gap-2 p-4">
          <code className="min-w-0 flex-1 truncate font-mono text-[13px] text-white/90">{WHSEC}</code>
          <button
            onClick={() => navigator.clipboard?.writeText(WHSEC).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); })}
            className="tap flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-textSecondary hover:text-white"
            aria-label="Copy secret"
          >
            {copied ? <Check className="h-4 w-4 text-neon" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
        <p className="mt-2 text-[12px] text-textMuted">Verify with <code className="text-neon">Furlpay.webhooks.constructEvent(body, sig, secret)</code> before trusting an event.</p>

        {/* Event types */}
        <h2 className="mb-3 mt-8 text-[18px] font-bold tracking-tight">Event types</h2>
        <div className="flex flex-wrap gap-2">
          {EVENTS.map((e) => {
            const on = selected.includes(e);
            const agentic = e.startsWith("agent.") || e.startsWith("x402.");
            return (
              <button
                key={e}
                onClick={() => toggle(e)}
                className={`rounded-full border px-3 py-1.5 font-mono text-[12px] transition-colors ${
                  on ? (agentic ? "border-neon/40 bg-neonSoft text-neon" : "border-white/20 bg-white/[0.08] text-white") : "border-white/10 text-textSecondary"
                }`}
              >
                {on && <Check className="mr-1 inline h-3 w-3" aria-hidden />}{e}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[12px] text-textMuted">
          <span className="text-neon">agent.*</span> and <span className="text-neon">x402.*</span> events are Furlpay-unique — no other payments API emits them.
        </p>

        {/* Recent deliveries */}
        <h2 className="mb-3 mt-8 text-[18px] font-bold tracking-tight">Recent deliveries</h2>
        <div className="divide-y divide-white/[0.06] overflow-hidden rounded-2xl border border-white/10">
          {DELIVERIES.map((d, i) => (
            <div key={i} className="flex items-center gap-3 px-5 py-3 text-[13px]">
              <span className="w-12 text-textMuted">{d.time}</span>
              <code className="min-w-0 flex-1 truncate font-mono text-white/90">{d.event}</code>
              <span className={d.code < 400 ? "text-gain" : "text-loss"}>{d.code}{d.code < 400 ? " OK" : " ERR"}</span>
              {d.code < 400 ? <span className="w-12 text-right text-textMuted">{d.ms}ms</span> : <button className="rounded-full border border-white/15 px-3 py-0.5 text-[12px]">Retry</button>}
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
