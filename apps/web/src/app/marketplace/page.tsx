import type { Metadata } from "next";
import LandingChrome from "@/components/landing/LandingChrome";

export const metadata: Metadata = {
  title: "App Marketplace",
  description: "Agentic-first app marketplace for Furlpay — MCP tools, x402 integrations, analytics, compliance, and more. Open standards, MIT-licensed.",
  alternates: { canonical: "/marketplace" },
};

const APPS = [
  { name: "Furlpay MCP Server", cat: "AI Agent Tools", by: "Official", desc: "Connect Claude / GPT / Cursor to your Furlpay wallet.", href: "https://github.com/FurlPay/furlpay-mcp-server" },
  { name: "x402 Facilitator", cat: "Developer Tools", by: "Official", desc: "Accept x402 payments in your API with one middleware.", href: "https://github.com/FurlPay/furlpay-x402" },
  { name: "Solana Actions Kit", cat: "Developer Tools", by: "Official", desc: "Create shareable Solana Actions / Blinks from Furlpay.", href: "https://github.com/FurlPay/furlpay-solana-actions-template" },
  { name: "Elements Checkout", cat: "Commerce", by: "Official", desc: "Drop-in React checkout — no raw card data in your DOM.", href: "https://github.com/FurlPay/furlpay-elements" },
  { name: "Account Kit", cat: "Developer Tools", by: "Official", desc: "Safe / ERC-4337 smart accounts, paymaster, escrow.", href: "https://github.com/FurlPay/furlpay-account-kit" },
  { name: "PostHog Analytics", cat: "Analytics", by: "Community", desc: "Stream Furlpay events into PostHog.", href: "https://github.com/FurlPay" },
  { name: "Sentry Monitoring", cat: "Developer Tools", by: "Community", desc: "Error tracking for your Furlpay integration.", href: "https://github.com/FurlPay" },
  { name: "TradingView Charts", cat: "Trading", by: "Community", desc: "Advanced charts for the portfolio view.", href: "https://github.com/FurlPay" },
  { name: "Persona KYC", cat: "Compliance", by: "Integration", desc: "Identity verification status + reports.", href: "https://furlpay.com/docs/integrations/persona-kyc" },
  { name: "Tax Report Generator", cat: "Compliance", by: "Community", desc: "Export transaction history for tax filing.", href: "https://github.com/FurlPay" },
];

const CATEGORIES = ["All", "AI Agent Tools", "Developer Tools", "Commerce", "Analytics", "Trading", "Compliance"];

export default function MarketplacePage() {
  return (
    <div className="min-h-screen bg-oled">
      <LandingChrome />
      <main className="section pb-24 pt-14">
        <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-neon">Marketplace</p>
        <h1 className="max-w-3xl text-[40px] font-extrabold leading-tight tracking-tighter sm:text-[50px]">
          The agentic-first app marketplace.
        </h1>
        <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-textSecondary">
          MCP tools and x402 integrations as category #1 — not an afterthought. Built on open standards
          (MCP, x402, REST), MIT-licensed, free to list. Quality over quantity.
        </p>

        {/* Category chips (visual; full filtering ships with the submission SDK) */}
        <div className="mt-8 flex flex-wrap gap-2">
          {CATEGORIES.map((c, i) => (
            <span
              key={c}
              className={`rounded-full px-3 py-1.5 text-[12px] font-semibold ${
                i === 0 ? "bg-white/[0.08] text-white" : "border border-white/10 text-textSecondary"
              }`}
            >
              {c}
            </span>
          ))}
        </div>

        <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {APPS.map((a) => (
            <a key={a.name} href={a.href} className="glass-card group flex flex-col p-5 transition-colors hover:border-neon/30">
              <div className="flex items-center justify-between">
                <span className="rounded-full bg-neonSoft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-neon">{a.cat}</span>
                <span className="text-[10px] uppercase tracking-wide text-textMuted">{a.by}</span>
              </div>
              <p className="mt-3 text-[16px] font-bold">{a.name}</p>
              <p className="mt-1 flex-1 text-[13px] leading-relaxed text-textSecondary">{a.desc}</p>
              <span className="mt-3 text-[13px] font-semibold text-neon group-hover:underline">Open →</span>
            </a>
          ))}
        </div>

        <div className="mt-12 glow-border p-6 text-center">
          <p className="text-[15px] font-bold text-neon">Build an app for the ecosystem</p>
          <p className="mx-auto mt-1.5 max-w-lg text-[14px] leading-relaxed text-textMuted">
            Publish on GitHub, list here for free. The app submission SDK and manifest spec are coming —
            <a href="/talk-to-us" className="text-neon hover:underline"> tell us what you&apos;re building</a>.
          </p>
        </div>
      </main>
    </div>
  );
}
