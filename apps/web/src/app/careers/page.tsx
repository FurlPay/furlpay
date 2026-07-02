import Link from "next/link";
import type { Metadata } from "next";
import { Code2, Users, ShieldCheck, ScrollText, GitBranch } from "lucide-react";
import MarketingBar from "@/components/marketing/MarketingBar";
import CareersForm from "@/components/marketing/CareersForm";

export const metadata: Metadata = {
  title: "Careers",
  description:
    "Furlpay is a solo-founder, pre-seed project shipping at startup speed. No open roles yet — join the talent pipeline or contribute to our open-source repos.",
  alternates: { canonical: "/careers" },
};

const VALUES = [
  { title: "Open by default", body: "SDKs, CLI, MCP server and the x402 facilitator are MIT on GitHub. Trust is earned by letting people read the code." },
  { title: "AI-native, not bolted-on", body: "Agentic payments and an MCP server are core architecture — built for when software, not just people, moves money." },
  { title: "Ship, then talk", body: "We build in public and prove things with working code, not decks. Proof-of-work beats potential." },
  { title: "Compliance as a feature", body: "MiCA/GENIUS routing, tiered KYC and the Travel Rule are wired into the product, not treated as an afterthought." },
];

const BUILD = [
  "The first Solana-native x402 facilitator — verify + settle for agent payments at scale.",
  "Agent spend policies: per-agent budgets, approval thresholds, merchant allowlists.",
  "2-of-2 MPC custody with passkey-bound device shares and an HSM policy gate.",
  "A double-entry ledger, cross-chain routing (CCTP/Li.Fi), and gas-sponsored transfers.",
  "Open-source SDKs in 4 languages + a CLI + React checkout Elements.",
];

const FUTURE_ROLES = [
  { role: "Senior Full-Stack Engineer", team: "Engineering", loc: "Remote (Global)" },
  { role: "Solana / Rust Engineer", team: "Engineering", loc: "Remote (Global)" },
  { role: "Developer Relations", team: "Growth", loc: "Remote (US/EU/India)" },
  { role: "Security Engineer", team: "Security", loc: "Remote (Global)" },
  { role: "Compliance Generalist", team: "Legal", loc: "Remote (US/EU/India)" },
  { role: "Technical Writer", team: "Product", loc: "Remote · Contract" },
  { role: "Community Manager", team: "Growth", loc: "Remote (Global)" },
  { role: "Product Designer", team: "Product", loc: "Remote (Global)" },
];

const OSS = [
  { repo: "furlpay-x402", area: "Solana · x402 protocol · facilitator", level: "Advanced" },
  { repo: "furlpay-mcp-server", area: "MCP tools · AI agent integration", level: "Advanced" },
  { repo: "furlpay-node", area: "TypeScript SDK · API clients · tests", level: "Intermediate" },
  { repo: "furlpay-solana-actions-template", area: "Solana Actions / Blinks", level: "Intermediate" },
  { repo: "furlpay-cli", area: "CLI tooling · developer experience", level: "Intermediate" },
  { repo: "furlpay-extension", area: "Chrome MV3 · content scripts", level: "Intermediate" },
];

const PROCESS = [
  { n: "1", title: "Application", body: "Resume/GitHub + a couple of short written answers. Async." },
  { n: "2", title: "Intro call", body: "30 min with the founder — mutual fit, values, motivation." },
  { n: "3", title: "Technical", body: "A real-world take-home or pairing session. Paid if it runs over 4 hours." },
  { n: "4", title: "Final", body: "Team, comp, offer — a decision within 5 business days." },
];

export default function CareersPage() {
  return (
    <div className="min-h-screen bg-oled">
      <MarketingBar />
      <main className="mx-auto max-w-5xl px-6 pb-24 pt-14">
        {/* Hero */}
        <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-neon">Careers</p>
        <h1 className="max-w-3xl text-[40px] font-extrabold leading-tight tracking-tighter sm:text-[52px]">
          Build the payment rails for people — and their AI agents.
        </h1>
        <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-textSecondary">
          Furlpay is the open-source, AI-native financial operating system. We&apos;re early, we ship
          fast, and we do it in public.
        </p>

        {/* Honest no-roles banner */}
        <div className="mt-8 glow-border p-6">
          <p className="text-[15px] font-bold text-neon">We&apos;re not hiring yet — we&apos;re building.</p>
          <p className="mt-1.5 max-w-2xl text-[14px] leading-relaxed text-textMuted">
            Furlpay is a solo-founder, pre-seed project shipping at startup speed. We&apos;ll open roles
            after our first funding round. Want to be first in line? Join the talent pipeline below, or
            start contributing to our open-source repos today.
          </p>
        </div>

        {/* Why now */}
        <h2 className="mt-16 text-[24px] font-bold tracking-tighter">Why now</h2>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-textSecondary">
          Three shifts just landed at once: <b className="text-white">x402</b> made agent payments a
          production standard (Linux Foundation, 20+ members), <b className="text-white">MiCA</b> went
          fully live in the EU, and every consumer lane now has a $1B+ incumbent — while the agentic-payments
          lane has ~$50M total and no clear winner. That&apos;s the gap we&apos;re building into.
        </p>

        {/* Values */}
        <h2 className="mt-16 text-[24px] font-bold tracking-tighter">What we believe</h2>
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {VALUES.map((v) => (
            <div key={v.title} className="glass-card p-6">
              <p className="text-[16px] font-bold">{v.title}</p>
              <p className="mt-1.5 text-[14px] leading-relaxed text-textSecondary">{v.body}</p>
            </div>
          ))}
        </div>

        {/* What you'll build */}
        <h2 className="mt-16 text-[24px] font-bold tracking-tighter">What you&apos;ll build</h2>
        <ul className="mt-6 space-y-3">
          {BUILD.map((b) => (
            <li key={b} className="flex gap-3 text-[15px] leading-relaxed text-textMuted">
              <Code2 className="mt-0.5 h-5 w-5 shrink-0 text-neon" /> {b}
            </li>
          ))}
        </ul>

        {/* Future roles */}
        <h2 className="mt-16 text-[24px] font-bold tracking-tighter">Roles we&apos;ll open</h2>
        <p className="mt-2 text-[14px] text-textSecondary">Coming soon after our pre-seed. Register interest and we&apos;ll reach out first.</p>
        <div className="mt-6 overflow-hidden rounded-2xl border border-white/10">
          <table className="w-full text-left text-[14px]">
            <thead className="bg-white/[0.03] text-textSecondary">
              <tr>
                <th className="px-5 py-3 font-semibold">Role</th>
                <th className="px-5 py-3 font-semibold">Team</th>
                <th className="px-5 py-3 font-semibold">Location</th>
              </tr>
            </thead>
            <tbody>
              {FUTURE_ROLES.map((r) => (
                <tr key={r.role} className="border-t border-white/5">
                  <td className="px-5 py-3 font-medium">{r.role}</td>
                  <td className="px-5 py-3 text-textSecondary">{r.team}</td>
                  <td className="px-5 py-3 text-textMuted">{r.loc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Open source → hire */}
        <h2 className="mt-16 flex items-center gap-2 text-[24px] font-bold tracking-tighter">
          <GitBranch className="h-6 w-6 text-neon" /> Contribute first, apply later
        </h2>
        <p className="mt-2 max-w-2xl text-[14px] text-textSecondary">
          The best way to stand out is a merged PR. Pick a repo at{" "}
          <a href="https://github.com/FurlPay" className="text-neon hover:underline">github.com/FurlPay</a>.
        </p>
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {OSS.map((o) => (
            <a
              key={o.repo}
              href={`https://github.com/FurlPay/${o.repo}`}
              className="glass-card p-4 transition-colors hover:border-neon/30"
            >
              <p className="font-mono text-[13px] font-bold text-neon">{o.repo}</p>
              <p className="mt-1 text-[13px] text-textSecondary">{o.area}</p>
              <span className="mt-2 inline-block rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-textMuted">
                {o.level}
              </span>
            </a>
          ))}
        </div>

        {/* Comp + process */}
        <div className="mt-16 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <h2 className="flex items-center gap-2 text-[22px] font-bold tracking-tighter">
              <ScrollText className="h-5 w-5 text-neon" /> How we pay
            </h2>
            <ul className="mt-4 space-y-2 text-[14px] leading-relaxed text-textMuted">
              <li>• Base salary at 70–85% of US remote market — <b className="text-white">location-independent</b> (same in SF or Bangalore).</li>
              <li>• Meaningful early equity (0.5–3% by role &amp; seniority), 4-year vest / 1-year cliff.</li>
              <li>• Remote-first, async-friendly, equipment + conference budget.</li>
              <li>• Token consideration for early team if/when Furlpay has one.</li>
            </ul>
          </div>
          <div>
            <h2 className="flex items-center gap-2 text-[22px] font-bold tracking-tighter">
              <Users className="h-5 w-5 text-neon" /> Hiring process
            </h2>
            <div className="mt-4 space-y-3">
              {PROCESS.map((p) => (
                <div key={p.n} className="flex gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-neon/30 bg-neonSoft text-[12px] font-bold text-neon">
                    {p.n}
                  </span>
                  <div>
                    <p className="text-[14px] font-semibold">{p.title}</p>
                    <p className="text-[13px] text-textSecondary">{p.body}</p>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[12px] text-textMuted">
              <ShieldCheck className="mr-1 inline h-3.5 w-3.5 text-neon" />
              No whiteboard puzzles. Under two weeks, application to offer.
            </p>
          </div>
        </div>

        {/* Interest form */}
        <div className="mt-16 grid grid-cols-1 gap-10 lg:grid-cols-2">
          <div>
            <h2 className="text-[28px] font-extrabold tracking-tighter">Join the talent pipeline</h2>
            <p className="mt-3 max-w-md text-[15px] leading-relaxed text-textSecondary">
              Drop your details and the role you&apos;re drawn to. When we open it, you&apos;ll be the
              first to know. Prefer to just chat?{" "}
              <Link href="/talk-to-us" className="text-neon hover:underline">Talk to us</Link>.
            </p>
          </div>
          <CareersForm />
        </div>
      </main>
    </div>
  );
}
