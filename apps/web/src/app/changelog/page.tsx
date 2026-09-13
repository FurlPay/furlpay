import Link from "next/link";
import type { Metadata } from "next";
import LandingChrome from "@/components/landing/LandingChrome";

export const metadata: Metadata = {
  title: "Changelog",
  description:
    "What's new in Furlpay — a timeline of shipped features, integrations, and improvements to the open-source financial operating system.",
  alternates: { canonical: "/changelog" },
};

const ENTRIES = [
  {
    date: "July 2, 2026",
    title: "MiCA-compliant routing & EURC auto-swap",
    description:
      "Smart compliance routing now detects EU-domiciled users and automatically swaps incoming USDC to EURC to satisfy MiCA requirements. Zero manual steps.",
    tags: ["Compliance", "Stablecoins"],
  },
  {
    date: "July 1, 2026",
    title: "x402 agentic payments endpoint & MCP server",
    description:
      "AI agents can now pay for HTTP resources using the x402 protocol. The MCP server ships as an npm package, letting any LLM tool-use framework orchestrate Furlpay actions.",
    tags: ["AI", "Developer"],
  },
  {
    date: "June 30, 2026",
    title: "Solana Actions/Blinks template & 9 public repos",
    description:
      "A ready-to-deploy Solana Actions template joins the ecosystem. With 9 public repos on GitHub, Furlpay is the most open fintech stack on Solana.",
    tags: ["Open Source", "Solana"],
  },
  {
    date: "June 29, 2026",
    title: "Portfolio-backed credit line & AI chat assistant",
    description:
      "Borrow against your stocks and crypto without selling. The AI chat assistant can answer questions, initiate transfers, and explain your portfolio — all from a single prompt.",
    tags: ["Credit", "AI"],
  },
  {
    date: "June 28, 2026",
    title: "Fractional investing via Alpaca & advanced charts",
    description:
      "Buy fractional shares of 5,000+ US stocks and ETFs starting from $1. Advanced candlestick charts, indicators, and portfolio analytics are now live.",
    tags: ["Investing", "UI"],
  },
  {
    date: "June 27, 2026",
    title: "Multi-currency banking via Wise & bill payments",
    description:
      "Local account details in 40+ currencies powered by Wise. Pay utility bills, subscriptions, and invoices directly from your balance.",
    tags: ["Banking", "Payments"],
  },
  {
    date: "June 26, 2026",
    title: "Virtual Visa card & cashback rewards",
    description:
      "Spend your USDC balance anywhere Visa is accepted with an instant virtual card. Earn up to 3% cashback settled directly to your wallet.",
    tags: ["Cards", "Rewards"],
  },
  {
    date: "June 25, 2026",
    title: "WebAuthn passkey auth & policy-gated signing",
    description:
      "Phishing-resistant login with device-bound passkeys, and a signing policy enforced independently by the client, the server and the enclave.",
    tags: ["Security", "Auth"],
  },
  {
    date: "June 24, 2026",
    title: "Dashboard & Cmd+K command palette",
    description:
      "The unified dashboard surfaces balances, recent transactions, portfolio performance, and card status. Cmd+K lets power users navigate anywhere instantly.",
    tags: ["UI", "DX"],
  },
  {
    date: "June 23, 2026",
    title: "Next.js monorepo initialized & design system",
    description:
      "Day zero. Turborepo monorepo with Next.js 15, the glass-card design system, OLED-dark theme, and neon accent tokens — the foundation of everything that follows.",
    tags: ["Foundation", "Design"],
  },
];

export default function ChangelogPage() {
  return (
    <div className="min-h-screen bg-oled">
      <LandingChrome />
      <main className="mx-auto max-w-4xl px-6 pb-24 pt-14">
        <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-neon">
          Changelog
        </p>
        <h1 className="max-w-3xl text-[40px] font-extrabold leading-tight tracking-tighter sm:text-[52px]">
          What we shipped.
        </h1>
        <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-textSecondary">
          A living timeline of every major feature, integration, and milestone in the Furlpay
          platform — from day zero to today.
        </p>

        {/* Timeline */}
        <div className="relative mt-16">
          {/* Vertical line */}
          <div className="absolute left-[7px] top-2 hidden h-full w-px bg-gradient-to-b from-neon/60 via-neon/20 to-transparent sm:block" />

          <div className="space-y-10">
            {ENTRIES.map((entry, i) => (
              <div key={i} className="relative sm:pl-10">
                {/* Dot */}
                <div className="absolute left-0 top-2 hidden h-[15px] w-[15px] items-center justify-center sm:flex">
                  <span className="h-[11px] w-[11px] rounded-full border-2 border-neon bg-oled shadow-[0_0_8px_theme(colors.neon)]" />
                </div>

                <div className="glass-card overflow-hidden p-6 transition-colors hover:border-neon/30">
                  <div className="flex flex-wrap items-center gap-3">
                    <time className="text-[13px] font-semibold text-neon">{entry.date}</time>
                    <div className="flex gap-2">
                      {entry.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full bg-white/[0.06] px-2.5 py-0.5 text-[11px] font-medium text-textSecondary"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                  <p className="mt-2.5 text-[18px] font-bold leading-snug">{entry.title}</p>
                  <p className="mt-2 text-[14px] leading-relaxed text-textSecondary">
                    {entry.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="mt-16 text-center">
          <p className="text-[14px] text-textMuted">
            Want to see what&apos;s next?{" "}
            <Link href="/community" className="text-neon hover:underline">
              Join our community
            </Link>{" "}
            or{" "}
            <a
              href="https://github.com/FurlPay"
              className="text-neon hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              follow us on GitHub
            </a>
            .
          </p>
        </div>
      </main>
    </div>
  );
}
