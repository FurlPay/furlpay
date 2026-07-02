"use client";

import { useState } from "react";
import Link from "next/link";
import { Copy, Check, Eye, EyeOff, MoreHorizontal, KeyRound } from "lucide-react";
import MarketingBar from "@/components/marketing/MarketingBar";

// Mirrors the Stripe dashboard API keys page (Standard + Restricted sections,
// table columns: Name · Token · Access policy · Last used · Created), plus
// Furlpay's ak_ agent-key primitive.

const RESTRICTED = [
  { name: "Shopping agent", token: "rk_test_agent_claude_9f21c3", policy: "Wallets: read · Payments: write", used: "2 min ago", created: "Jul 1, 2026" },
  { name: "Webhook worker", token: "rk_test_webhook_prod_3a7cb0", policy: "Events: read", used: "5 min ago", created: "Jun 30, 2026" },
];
const AGENT = [
  { name: "Claude-Shopping", token: "ak_test_claude_shop_9f21", policy: "x402 · ≤ $25/tx · $50/day", used: "2 min ago", created: "Jul 2, 2026" },
  { name: "GPT-Research", token: "ak_test_gpt_research_3a7c", policy: "x402 · ≤ $1/tx · $5/day", used: "15 min ago", created: "Jul 2, 2026" },
];

function CopyBtn({ text }: { text: string }) {
  const [c, setC] = useState(false);
  return (
    <button
      onClick={() => navigator.clipboard?.writeText(text).then(() => { setC(true); setTimeout(() => setC(false), 1200); })}
      className="tap flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-textSecondary hover:text-white"
      aria-label="Copy"
    >
      {c ? <Check className="h-3.5 w-3.5 text-neon" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

export default function KeysPage() {
  const [env, setEnv] = useState<"test" | "live">("test");
  const [reveal, setReveal] = useState(false);
  const pk = `pk_${env}_51PsdVkSIsSTsfivl554y2ZEKE4bXaB50gSqnYg17Uc898julzfT`;
  const skFull = `sk_${env}_51PsdVkSIsSTsfivl43Txo60kVcIkg4cTsO0uu9XWKoIzLDJd4tc`;
  const skMasked = `sk_${env}_••••••••••••••••••••••••••••••••••••`;

  return (
    <div className="min-h-screen bg-oled">
      <MarketingBar />
      <main className="mx-auto max-w-5xl px-6 pb-24 pt-12">
        {/* Sandbox banner */}
        <div className="mb-6 flex flex-wrap items-center gap-2 rounded-2xl border border-yellow-400/20 bg-yellow-400/[0.06] px-4 py-3 text-[13px]">
          <span className="rounded-full bg-yellow-400/20 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-yellow-300">Sandbox</span>
          <span className="text-textSecondary">You&apos;re testing in a sandbox — your place to experiment with Furlpay. No real funds move.</span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-[30px] font-extrabold tracking-tighter sm:text-[38px]">API keys</h1>
            <Link href="/docs/quickstart" className="text-[13px] text-neon hover:underline">Learn about API authentication →</Link>
          </div>
          <div className="flex rounded-pill border border-white/10 bg-white/[0.03] p-1 text-[13px] font-semibold">
            {(["test", "live"] as const).map((e) => (
              <button key={e} onClick={() => setEnv(e)} className={`rounded-pill px-4 py-1.5 capitalize ${env === e ? "bg-white/[0.08] text-white" : "text-textSecondary"}`}>
                {e} mode
              </button>
            ))}
          </div>
        </div>

        {/* Restricted keys */}
        <Section
          title="Restricted keys"
          desc="Create a key with specific access limits and permissions for greater security."
          cta="Create restricted key"
        >
          <KeyTable rows={RESTRICTED} />
        </Section>

        {/* Agent keys (Furlpay primitive) */}
        <Section
          title="Agent keys"
          desc="Furlpay-only: keys scoped to x402 payments with per-key spend limits baked in. Manage in the Agent Console."
          cta="Register agent"
          ctaHref="/developer/agents"
          accent
        >
          <KeyTable rows={AGENT} accent />
        </Section>

        {/* Standard keys */}
        <Section title="Standard keys" desc="Full API access — enables extensive interaction with your account.">
          <div className="overflow-hidden rounded-2xl border border-white/10">
            <table className="w-full text-left text-[13px]">
              <thead className="border-b border-white/[0.06] bg-white/[0.02] text-[11px] uppercase tracking-wide text-textMuted">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Name</th>
                  <th className="px-4 py-2.5 font-semibold">Token</th>
                  <th className="hidden px-4 py-2.5 font-semibold sm:table-cell">Last used</th>
                  <th className="hidden px-4 py-2.5 font-semibold sm:table-cell">Created</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-white/[0.04]">
                  <td className="px-4 py-3">Publishable key</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <code className="max-w-[220px] truncate font-mono text-white/90">{pk}</code>
                      <CopyBtn text={pk} />
                    </div>
                  </td>
                  <td className="hidden px-4 py-3 text-textMuted sm:table-cell">—</td>
                  <td className="hidden px-4 py-3 text-textMuted sm:table-cell">Jul 1, 2026</td>
                  <td className="px-4 py-3 text-right"><MoreHorizontal className="ml-auto h-4 w-4 text-textMuted" /></td>
                </tr>
                <tr>
                  <td className="px-4 py-3">Secret key</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <code className="max-w-[220px] truncate font-mono text-white/90">{reveal ? skFull : skMasked}</code>
                      <button onClick={() => setReveal((r) => !r)} className="tap flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-textSecondary hover:text-white" aria-label="Reveal">
                        {reveal ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                      <CopyBtn text={skFull} />
                    </div>
                  </td>
                  <td className="hidden px-4 py-3 text-textMuted sm:table-cell">—</td>
                  <td className="hidden px-4 py-3 text-textMuted sm:table-cell">Jul 1, 2026</td>
                  <td className="px-4 py-3 text-right"><MoreHorizontal className="ml-auto h-4 w-4 text-textMuted" /></td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[12px] text-textMuted">Keep your secret key on the server. Never expose it in client code or commit it to git.</p>
        </Section>

        {/* Prefixes */}
        <h2 className="mb-3 mt-10 flex items-center gap-2 text-[16px] font-bold tracking-tight">
          <KeyRound className="h-5 w-5 text-neon" /> Key prefixes
        </h2>
        <div className="divide-y divide-white/[0.06] overflow-hidden rounded-2xl border border-white/10 text-[13px]">
          {[
            ["pk_live_ / pk_test_", "Publishable — safe in client code"],
            ["sk_live_ / sk_test_", "Secret — server-side only"],
            ["rk_live_ / rk_test_", "Restricted — scoped permissions"],
            ["ak_live_ / ak_test_", "Agent — x402-scoped with spend limits (Furlpay-only)"],
          ].map(([p, d]) => (
            <div key={p} className="grid grid-cols-1 gap-1 px-5 py-3 sm:grid-cols-[230px_1fr]">
              <code className="font-mono text-neon">{p}</code>
              <span className="text-textMuted">{d}</span>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

function Section({ title, desc, cta, ctaHref, accent, children }: {
  title: string; desc: string; cta?: string; ctaHref?: string; accent?: boolean; children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-bold tracking-tight">{title}</h2>
          <p className="mt-0.5 max-w-2xl text-[13px] text-textSecondary">{desc}</p>
        </div>
        {cta && (
          ctaHref ? (
            <Link href={ctaHref} className={`shrink-0 rounded-pill px-4 py-2 text-[13px] font-semibold ${accent ? "btn-green" : "border border-white/15 text-white"}`}>{cta}</Link>
          ) : (
            <button className="shrink-0 rounded-pill border border-white/15 px-4 py-2 text-[13px] font-semibold text-white">+ {cta}</button>
          )
        )}
      </div>
      {children}
    </section>
  );
}

function KeyTable({ rows, accent }: { rows: { name: string; token: string; policy: string; used: string; created: string }[]; accent?: boolean }) {
  if (rows.length === 0) {
    return <div className="rounded-2xl border border-white/10 px-5 py-8 text-center text-[13px] text-textSecondary">No keys yet</div>;
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10">
      <table className="w-full text-left text-[13px]">
        <thead className="border-b border-white/[0.06] bg-white/[0.02] text-[11px] uppercase tracking-wide text-textMuted">
          <tr>
            <th className="px-4 py-2.5 font-semibold">Name</th>
            <th className="px-4 py-2.5 font-semibold">Token</th>
            <th className="hidden px-4 py-2.5 font-semibold md:table-cell">Access policy</th>
            <th className="hidden px-4 py-2.5 font-semibold sm:table-cell">Last used</th>
            <th className="hidden px-4 py-2.5 font-semibold sm:table-cell">Created</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.token} className="border-b border-white/[0.04] last:border-none">
              <td className="px-4 py-3 font-medium">{r.name}</td>
              <td className="px-4 py-3"><code className={`font-mono ${accent ? "text-neon" : "text-white/90"}`}>{r.token}…</code></td>
              <td className="hidden px-4 py-3 text-textSecondary md:table-cell">{r.policy}</td>
              <td className="hidden px-4 py-3 text-textMuted sm:table-cell">{r.used}</td>
              <td className="hidden px-4 py-3 text-textMuted sm:table-cell">{r.created}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
