import Link from "next/link";
import type { Metadata } from "next";
import LandingChrome from "@/components/landing/LandingChrome";

export const metadata: Metadata = {
  title: "About",
  description:
    "Furlpay is an open-source, on-chain financial platform: stablecoin payment APIs, an x402 payment-challenge endpoint and MCP tooling for agents, with passkey-first security.",
  alternates: { canonical: "/about" },
};

// The stack, split by whether the integration is CONNECTED in production or
// SELECTED for a capability still being built. It used to be one undifferentiated
// logo wall, which reads as "these eight companies are wired in" — and five of
// them have no credential in the production environment. A reader comparing
// vendors deserves to know which half they are looking at.
const STACK_LIVE = [
  { name: "Solana & Arbitrum", role: "Settlement rails" },
  { name: "Circle USDC / EURC", role: "Stablecoins" },
  { name: "x402 · MCP", role: "Agent payment protocol + transport" },
  { name: "WebAuthn passkeys", role: "Phishing-resistant auth" },
];

const STACK_PLANNED = [
  { name: "Safe · ERC-4337", role: "Smart accounts" },
  { name: "Turnkey", role: "MPC key custody" },
  { name: "Alpaca", role: "Stock and ETF orders" },
  { name: "Wise", role: "Local banking / FX" },
];

const PRINCIPLES = [
  { title: "Open by default", body: "SDKs, CLI, MCP server, and the x402 facilitator are MIT-licensed on GitHub. Trust is earned by letting people read the code." },
  { title: "AI-native, not bolted-on", body: "Agentic payments (x402) and an MCP server are core architecture — built for a world where software, not just people, moves money." },
  { title: "Honest about custody", body: "Your key is on your device in the mobile app. Web signing runs through a policy-gated enclave and is custodial — we publish that rather than call everything self-custody." },
  // "Wired into the product" claimed a finished Travel Rule integration. The
  // route and the provider client exist and are typechecked; no message has
  // been exchanged with a counterparty VASP, because that needs a provisioned
  // VASP account. Designed-in is the true and still-meaningful claim.
  { title: "Compliance designed in", body: "MiCA/GENIUS routing, tiered KYC and FATF Travel Rule messaging are built into the architecture rather than bolted on. Travel Rule messaging awaits a provisioned VASP account before it exchanges a live message." },
];

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-oled">
      <LandingChrome />
      <main className="mx-auto max-w-4xl px-6 pb-24 pt-14">
        <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-neon">About</p>
        <h1 className="max-w-3xl text-[40px] font-extrabold leading-tight tracking-tighter sm:text-[52px]">
          One account where your money — and your AI agents — can actually work.
        </h1>
        {/* Rewritten 22 Sep 2026. The previous sentence described four
            products in the present tense — bank accounts, stock investing, a
            downloadable client and agent settlement — every one of them still
            in development. What actually serves today is the web platform, the
            developer surface and the x402 challenge, so that is what the
            opening paragraph now claims, with the rest named as direction. */}
        <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-textSecondary">
          Furlpay is an on-chain financial platform for stablecoin payments. Today that means a web
          client, a developer platform with typed SDKs, an MCP server for AI agents, and an x402
          payment-challenge endpoint — all secured by passkeys and open to read on GitHub. Cards,
          local accounts, investing and end-to-end agent settlement are in development; we say which
          is which on{" "}
          <Link href="/#what-is-running" className="text-neon hover:underline">
            the homepage capability list
          </Link>
          .
        </p>

        <h2 className="mt-16 text-[24px] font-bold tracking-tighter">What we believe</h2>
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {PRINCIPLES.map((p) => (
            <div key={p.title} className="glass-card p-6">
              <p className="text-[16px] font-bold">{p.title}</p>
              <p className="mt-1.5 text-[14px] leading-relaxed text-textSecondary">{p.body}</p>
            </div>
          ))}
        </div>

        <h2 className="mt-16 text-[24px] font-bold tracking-tighter">Built on</h2>
        <p className="mt-2 text-[13px] text-textSecondary">Connected in production today.</p>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {STACK_LIVE.map((s) => (
            <div key={s.name} className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.04] p-4">
              <p className="text-[14px] font-semibold">{s.name}</p>
              <p className="text-[12px] text-textSecondary">{s.role}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 text-[13px] text-textSecondary">
          Selected for capabilities still in development — integration work is written, production
          credentials are not yet in place.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {STACK_PLANNED.map((s) => (
            <div key={s.name} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <p className="text-[14px] font-semibold text-textSecondary">{s.name}</p>
              <p className="text-[12px] text-textMuted">{s.role}</p>
            </div>
          ))}
        </div>

        <div className="mt-16 glow-border p-6">
          <p className="text-[14px] font-bold text-neon">Open source</p>
          <p className="mt-1.5 text-[14px] leading-relaxed text-textMuted">
            Ten public repositories at{" "}
            <a href="https://github.com/FurlPay" className="text-neon hover:underline">github.com/FurlPay</a>{" "}
            — the SDK, CLI, Elements, Account Kit, MCP server, browser extension, OpenAPI spec, Solana
            Actions template, and the x402 facilitator. Contributions welcome.
          </p>
        </div>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link href="/signup" className="btn-green px-6 py-3 text-[15px]">Get started</Link>
          <Link href="/docs" className="btn-outline px-6 py-3 text-[15px]">Read the docs</Link>
        </div>

        <p className="mt-12 text-[13px] text-textSecondary">
          Questions or partnerships? <a href="mailto:hello@furlpay.com" className="text-neon hover:underline">hello@furlpay.com</a>
        </p>
      </main>
    </div>
  );
}
