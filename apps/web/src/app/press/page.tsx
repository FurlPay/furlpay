import type { Metadata } from "next";
import LandingChrome from "@/components/landing/LandingChrome";

export const metadata: Metadata = {
  title: "Press & Media Kit",
  description: "Furlpay press resources — boilerplate, brand assets, and fast facts for journalists.",
  alternates: { canonical: "/press" },
};

const FACTS = [
  ["What", "The open-source, AI-native financial operating system — stablecoin cards, global accounts, fractional investing, and agentic payments in one client."],
  ["Wedge", "The first Solana-native x402 facilitator + MCP server — payments infrastructure for AI agents."],
  ["Open source", "10 MIT-licensed repos at github.com/FurlPay (SDKs in 4 languages, CLI, Elements, Account Kit, MCP server, x402)."],
  ["Custody", "Self-custodial on mobile (key held on device). Web signing is custodial via a policy-gated Turnkey enclave. Passkey auth throughout."],
  ["Compliance", "MiCA / GENIUS routing, tiered KYC, and the FATF Travel Rule wired into the product."],
  ["Stage", "Pre-seed, solo founder, shipping in public. Live at furlpay.com."],
];

export default function PressPage() {
  return (
    <div className="min-h-screen bg-oled">
      <LandingChrome />
      <main className="mx-auto max-w-3xl px-6 pb-24 pt-14">
        <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-neon">Press</p>
        <h1 className="text-[36px] font-extrabold tracking-tighter sm:text-[46px]">Media kit</h1>
        <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-textSecondary">
          Everything you need to write about Furlpay. For interviews or anything else, email{" "}
          <a href="mailto:hello@furlpay.com" className="text-neon hover:underline">hello@furlpay.com</a>.
        </p>

        <h2 className="mt-12 text-[22px] font-bold tracking-tighter">Boilerplate</h2>
        <p className="mt-3 rounded-2xl border border-white/10 bg-white/[0.02] p-5 text-[14px] leading-relaxed text-textMuted">
          Furlpay is the open-source, AI-native financial operating system, fusing stablecoin payments,
          global local accounts, and fractional stock investing into one web, desktop, and browser-extension
          client — with the first Solana-native x402 facilitator and an MCP server underneath, so AI agents
          can transact safely. Phishing-resistant, self-custodial on mobile, and compliance-aware.
        </p>

        <h2 className="mt-12 text-[22px] font-bold tracking-tighter">Fast facts</h2>
        <div className="mt-4 divide-y divide-white/[0.06] overflow-hidden rounded-2xl border border-white/10">
          {FACTS.map(([k, v]) => (
            <div key={k} className="grid grid-cols-1 gap-1 px-5 py-4 sm:grid-cols-[120px_1fr]">
              <span className="text-[12px] font-semibold uppercase tracking-wide text-textSecondary">{k}</span>
              <span className="text-[14px] leading-relaxed text-textMuted">{v}</span>
            </div>
          ))}
        </div>

        <h2 className="mt-12 text-[22px] font-bold tracking-tighter">Brand assets</h2>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <a href="/icon.png" download className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4 transition-colors hover:border-neon/30">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.png" alt="Furlpay mark" width={40} height={40} className="h-10 w-10 rounded-lg" />
            <span className="text-[13px] font-semibold">App icon <span className="text-textMuted">· PNG</span></span>
          </a>
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-[13px]">
            <p className="font-semibold">Accent</p>
            <p className="text-textMuted">Neon <span className="font-mono">#00E599</span> · OLED <span className="font-mono">#000</span></p>
          </div>
        </div>
      </main>
    </div>
  );
}
