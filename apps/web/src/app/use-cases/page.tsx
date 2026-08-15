import Link from "next/link";
import type { Metadata } from "next";
import type { ComponentType } from "react";
import { Code2, Bot, Building2 } from "lucide-react";
import LandingChrome from "@/components/landing/LandingChrome";

export const metadata: Metadata = {
  title: "Use Cases",
  description:
    "How developers, AI agents, and businesses use Furlpay — SDKs, MCP server, x402, checkout widgets, employee cards, and treasury management.",
  alternates: { canonical: "/use-cases" },
};

type Feature = { name: string; detail: string };

type UseCase = {
  badge: string;
  title: string;
  description: string;
  features: Feature[];
  cta: { label: string; href: string };
  accent: string;
  Icon: ComponentType<{ className?: string }>;
};

const USE_CASES: UseCase[] = [
  {
    badge: "Developers",
    title: "Ship payments in an afternoon.",
    description:
      "A TypeScript SDK, CLI, REST API, webhooks, and drop-in React components — everything you need to embed stablecoin payments, card issuance, and identity verification into your app.",
    features: [
      { name: "TypeScript SDK", detail: "Type-safe client for wallets, cards, payments, and investing." },
      { name: "CLI", detail: "Manage resources, run scripts, and automate workflows from the terminal." },
      { name: "REST API & OpenAPI", detail: "Full OpenAPI 3.1 spec — generate clients in any language." },
      { name: "Webhooks", detail: "Real-time events for payments, card authorizations, KYC, and transfers." },
    ],
    cta: { label: "Read the docs", href: "/docs" },
    accent: "from-emerald-500/20 via-emerald-500/5 to-transparent",
    Icon: Code2,
  },
  {
    badge: "AI Agents",
    title: "Let your agents spend.",
    description:
      "The first Solana-native x402 facilitator and a production-ready MCP server — so LLMs and autonomous agents can discover resources, negotiate prices, and pay for HTTP calls without human intervention.",
    features: [
      { name: "MCP Server", detail: "Model Context Protocol server — any LLM framework can call Furlpay tools." },
      { name: "x402 Protocol", detail: "HTTP 402-based agentic payment negotiation. Standard, open, interoperable." },
      { name: "Spend Policies", detail: "Set per-agent budgets, velocity limits, and allowlisted merchants." },
      { name: "Audit Trail", detail: "Every agent transaction is logged with origin, model, and policy context." },
    ],
    cta: { label: "Explore x402", href: "/docs/developer/x402" },
    accent: "from-blue-500/20 via-blue-500/5 to-transparent",
    Icon: Bot,
  },
  {
    badge: "Businesses",
    title: "One platform, every money flow.",
    description:
      "Embed a checkout widget, issue employee stablecoin cards with spend controls, and manage treasury — all through a single dashboard with full audit history and compliance built in.",
    features: [
      { name: "Checkout Widget", detail: "Drop-in payment form — USDC, cards, and local payment methods." },
      { name: "Employee Cards", detail: "Issue virtual Visa cards with per-card spend limits and merchant locks." },
      { name: "Treasury", detail: "Hold idle funds in yield-bearing stablecoin vaults — withdraw anytime." },
      { name: "Compliance", detail: "Tiered KYC, FATF Travel Rule, MiCA routing — handled automatically." },
    ],
    cta: { label: "Contact sales", href: "mailto:sales@furlpay.com" },
    accent: "from-purple-500/20 via-purple-500/5 to-transparent",
    Icon: Building2,
  },
];

export default function UseCasesPage() {
  return (
    <div className="min-h-screen bg-oled">
      <LandingChrome />
      <main className="mx-auto max-w-4xl px-6 pb-24 pt-14">
        <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-neon">
          Use Cases
        </p>
        <h1 className="max-w-3xl text-[40px] font-extrabold leading-tight tracking-tighter sm:text-[52px]">
          Built for every way money moves.
        </h1>
        <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-textSecondary">
          Whether you&apos;re a developer integrating payments, an AI agent paying for API calls, or
          a business managing treasury — Furlpay has a purpose-built surface for you.
        </p>

        {/* Use case sections */}
        <div className="mt-16 space-y-12">
          {USE_CASES.map((uc) => (
            <section
              key={uc.badge}
              className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]"
            >
              {/* Gradient accent on hover */}
              <div
                className={`absolute inset-0 bg-gradient-to-br ${uc.accent} opacity-0 transition-opacity duration-500 group-hover:opacity-100`}
              />

              <div className="relative p-8 sm:p-10">
                {/* Header */}
                <div className="flex items-start gap-4">
                  <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/[0.06] text-white">
                    <uc.Icon className="h-6 w-6" />
                  </span>
                  <div>
                    <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-neon">
                      For {uc.badge}
                    </span>
                    <h2 className="mt-1 text-[24px] font-bold leading-snug tracking-tighter">
                      {uc.title}
                    </h2>
                  </div>
                </div>

                <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-textSecondary">
                  {uc.description}
                </p>

                {/* Feature grid */}
                <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {uc.features.map((f) => (
                    <div key={f.name} className="rounded-xl border border-white/[0.06] bg-black/30 p-4">
                      <p className="text-[14px] font-semibold">{f.name}</p>
                      <p className="mt-1 text-[13px] leading-relaxed text-textSecondary">
                        {f.detail}
                      </p>
                    </div>
                  ))}
                </div>

                {/* CTA */}
                <div className="mt-8">
                  {uc.cta.href.startsWith("mailto:") ? (
                    <a href={uc.cta.href} className="btn-outline inline-block px-6 py-3 text-[15px]">
                      {uc.cta.label} →
                    </a>
                  ) : (
                    <Link href={uc.cta.href} className="btn-outline inline-block px-6 py-3 text-[15px]">
                      {uc.cta.label} →
                    </Link>
                  )}
                </div>
              </div>
            </section>
          ))}
        </div>

        {/* Bottom CTA */}
        <div className="mt-20 text-center">
          <h2 className="text-[24px] font-bold tracking-tighter">
            Ready to build?
          </h2>
          <p className="mt-2 text-[14px] text-textSecondary">
            Create a free account and start moving money in minutes.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href="/signup" className="btn-green px-6 py-3 text-[15px]">
              Get started
            </Link>
            <Link href="/pricing" className="btn-outline px-6 py-3 text-[15px]">
              View pricing
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
