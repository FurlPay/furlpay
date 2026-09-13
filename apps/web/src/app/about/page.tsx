import Link from "next/link";
import type { Metadata } from "next";
import LandingChrome from "@/components/landing/LandingChrome";

export const metadata: Metadata = {
  title: "About",
  description:
    "Furlpay is the open-source, AI-native financial operating system — stablecoin cards, global accounts, fractional investing, and agentic payments in one client.",
  alternates: { canonical: "/about" },
};

const STACK = [
  { name: "Solana & Base", role: "Settlement rails" },
  { name: "Circle USDC / EURC", role: "Stablecoins" },
  { name: "Safe · ERC-4337", role: "Smart accounts" },
  { name: "Turnkey", role: "MPC key custody" },
  { name: "Alpaca", role: "Fractional investing" },
  { name: "Wise", role: "Local banking / FX" },
  { name: "x402 · MCP", role: "Agentic payments" },
  { name: "WebAuthn passkeys", role: "Phishing-resistant auth" },
];

const PRINCIPLES = [
  { title: "Open by default", body: "SDKs, CLI, MCP server, and the x402 facilitator are MIT-licensed on GitHub. Trust is earned by letting people read the code." },
  { title: "AI-native, not bolted-on", body: "Agentic payments (x402) and an MCP server are core architecture — built for a world where software, not just people, moves money." },
  { title: "Honest about custody", body: "Your key is on your device in the mobile app. Web signing runs through a policy-gated enclave and is custodial — we publish that rather than call everything self-custody." },
  { title: "Compliance as a feature", body: "MiCA/GENIUS routing, tiered KYC, and the FATF Travel Rule are wired into the product, not treated as an afterthought." },
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
        <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-textSecondary">
          Furlpay fuses stablecoin payments, global local accounts, and fractional stock investing into
          one beautiful web, desktop, and browser-extension client — with an open developer platform and
          the first Solana-native x402 facilitator underneath. Cards, banking, and investing for people;
          rails and protocols for the agents building on top.
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
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {STACK.map((s) => (
            <div key={s.name} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <p className="text-[14px] font-semibold">{s.name}</p>
              <p className="text-[12px] text-textSecondary">{s.role}</p>
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
