import Link from "next/link";
import type { Metadata } from "next";
import { Package } from "lucide-react";
import LandingChrome from "@/components/landing/LandingChrome";
import {
  DiscordIcon,
  GitHubIcon,
  XIcon,
  LinkedInIcon,
  YouTubeIcon,
} from "@/components/marketing/SocialIcons";
import type { ComponentType } from "react";

export const metadata: Metadata = {
  title: "Community",
  description:
    "Join the Furlpay community — contribute on GitHub, chat on Discord, follow on X, and explore 11+ open-source repos powering the financial operating system.",
  alternates: { canonical: "/community" },
};

const SOCIAL: {
  name: string;
  description: string;
  href: string;
  cta: string;
  Icon: ComponentType<{ className?: string }>;
}[] = [
  {
    name: "Discord",
    description: "Chat with the core team and other builders in real-time.",
    href: "https://discord.gg/furlpay",
    cta: "Join Discord",
    Icon: DiscordIcon,
  },
  {
    name: "GitHub",
    description: "Browse 11+ public repos — SDKs, CLI, MCP server, and more.",
    href: "https://github.com/FurlPay",
    cta: "View repos",
    Icon: GitHubIcon,
  },
  {
    name: "X / Twitter",
    description: "Product updates, shipped features, and dev tips.",
    href: "https://x.com/furlpayglobal",
    cta: "Follow @furlpayglobal",
    Icon: XIcon,
  },
  {
    name: "LinkedIn",
    description: "Company news, hiring, and the build-in-public journey.",
    href: "https://linkedin.com/company/furlpay",
    cta: "Follow Furlpay",
    Icon: LinkedInIcon,
  },
  {
    name: "YouTube",
    description: "Product demos, walkthroughs, and the build-in-public journey.",
    href: "https://www.youtube.com/@furlpay",
    cta: "Subscribe",
    Icon: YouTubeIcon,
  },
];

const REPOS = [
  { name: "SDK", description: "TypeScript SDK — wallets, cards, payments, investing.", repo: "furlpay-sdk" },
  { name: "CLI", description: "Command-line interface for power users and CI/CD.", repo: "furlpay-cli" },
  { name: "MCP Server", description: "Model Context Protocol server for AI agent integrations.", repo: "furlpay-mcp" },
  { name: "Elements", description: "Drop-in React components — card widget, checkout, KYC flow.", repo: "furlpay-elements" },
  { name: "Account Kit", description: "Smart account abstraction with passkey + MPC signers.", repo: "furlpay-account-kit" },
  { name: "Extension", description: "Browser extension — access Furlpay from any tab.", repo: "furlpay-extension" },
  { name: "OpenAPI", description: "Full OpenAPI 3.1 spec — import into Postman, Insomnia, or codegen.", repo: "furlpay-openapi" },
  { name: "Solana Actions", description: "Template for Solana Actions & Blinks — deploy in minutes.", repo: "furlpay-solana-actions" },
  { name: "x402 Facilitator", description: "Reference x402 facilitator for agentic HTTP payments.", repo: "furlpay-x402" },
  { name: "x402 Guard", description: "Facilitator-layer hardening — closes all five x402 free-riding attack classes.", repo: "x402-guard" },
  { name: "OpenBB Plugin", description: "Execution layer for OpenBB Workspace — trade, DCA, and settle in stablecoins.", repo: "furlpay-openbb-plugin" },
];

export default function CommunityPage() {
  return (
    <div className="min-h-screen bg-oled">
      <LandingChrome />
      <main className="mx-auto max-w-4xl px-6 pb-24 pt-14">
        <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-neon">
          Community
        </p>
        <h1 className="max-w-3xl text-[40px] font-extrabold leading-tight tracking-tighter sm:text-[52px]">
          Build the future of money — together.
        </h1>
        <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-textSecondary">
          Furlpay is open-source and community-driven. Whether you&apos;re shipping code, reporting
          bugs, writing docs, or just vibing in Discord — you&apos;re welcome here.
        </p>

        {/* Social links */}
        <div className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SOCIAL.map((s) => (
            <a
              key={s.name}
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
              className="glass-card group flex flex-col justify-between p-6 transition-colors hover:border-neon/30"
            >
              <div>
                <s.Icon className="h-7 w-7 text-textSecondary transition-colors group-hover:text-neon" />
                <p className="mt-3 text-[16px] font-bold">{s.name}</p>
                <p className="mt-1.5 text-[14px] leading-relaxed text-textSecondary">
                  {s.description}
                </p>
              </div>
              <p className="mt-4 text-[13px] font-semibold text-neon group-hover:underline">
                {s.cta} →
              </p>
            </a>
          ))}
        </div>

        {/* Repos */}
        <h2 className="mt-20 text-[24px] font-bold tracking-tighter">Open-source repos</h2>
        <p className="mt-2 text-[14px] text-textSecondary">
          All MIT-licensed. Fork, extend, contribute back.
        </p>

        <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {REPOS.map((r) => (
            <a
              key={r.repo}
              href={`https://github.com/FurlPay/${r.repo}`}
              target="_blank"
              rel="noopener noreferrer"
              className="group rounded-xl border border-white/10 bg-white/[0.02] p-5 transition-all hover:border-neon/25 hover:bg-white/[0.04]"
            >
              <div className="flex items-center gap-2">
                <Package className="h-3.5 w-3.5 text-textMuted" aria-hidden />
                <p className="text-[14px] font-semibold group-hover:text-neon">{r.name}</p>
              </div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-textSecondary">
                {r.description}
              </p>
            </a>
          ))}
        </div>

        {/* Contributor guide */}
        <div className="mt-16 glow-border p-6">
          <p className="text-[14px] font-bold text-neon">Contributing</p>
          <p className="mt-1.5 text-[14px] leading-relaxed text-textMuted">
            We welcome contributions of all sizes. Read the{" "}
            <a
              href="https://github.com/FurlPay/.github/blob/main/CONTRIBUTING.md"
              className="text-neon hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              contributor guide
            </a>{" "}
            to get started — set up your dev environment, pick a good-first-issue, and open a PR.
            Every contributor gets credited in the changelog.
          </p>
        </div>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link href="/docs" className="btn-outline px-6 py-3 text-[15px]">
            Read the docs
          </Link>
          <Link href="/changelog" className="btn-outline px-6 py-3 text-[15px]">
            See what shipped
          </Link>
        </div>
      </main>
    </div>
  );
}
