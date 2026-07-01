import Link from "next/link";
import { CreditCard, TrendingUp, Landmark, Code2, ShieldCheck, Fingerprint, Cpu, Zap } from "lucide-react";
import PhoneMockup from "@/components/marketing/PhoneMockup";
import StoreBadges from "@/components/marketing/StoreBadges";
import CodePreview from "@/components/marketing/CodePreview";
import PricingCards from "@/components/marketing/PricingCards";
import PartnerMarquee from "@/components/marketing/PartnerMarquee";
import { XIcon, DiscordIcon, GitHubIcon, TelegramIcon, InstagramIcon } from "@/components/marketing/SocialIcons";

// Furlpay marketing landing page (furlpay.app/). Premium OLED theme with green
// glow accents. Mostly a Server Component; interactive bits (phone carousel,
// code preview) are client islands.
export default function LandingPage() {
  return (
    <div className="relative overflow-hidden">
      <Nav />
      <Hero />
      <Features />
      <DeveloperPreview />
      <Security />
      <Pricing />
      <Footer />
    </div>
  );
}

function Nav() {
  return (
    <header className="sticky top-0 z-50 border-b border-white/5 bg-black/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2">
          <Logo />
          <span className="text-xl font-extrabold tracking-tighter">Furlpay</span>
        </Link>
        <nav className="hidden items-center gap-8 text-sm text-textSecondary md:flex">
          <a href="#features" className="transition-colors hover:text-white">Features</a>
          <Link href="/docs" className="transition-colors hover:text-white">Developer Docs</Link>
          <Link href="/blog" className="transition-colors hover:text-white">Blog</Link>
          <a href="#pricing" className="transition-colors hover:text-white">Pricing</a>
          <a href="#security" className="transition-colors hover:text-white">Security</a>
        </nav>
        <Link href="/dashboard" className="btn-green px-5 py-2 text-sm">Open App</Link>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative">
      <div className="hero-glow pointer-events-none absolute inset-0" />
      <div className="mx-auto max-w-6xl px-6 pb-10 pt-16 text-center">
        <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-1.5 text-[12px] text-textSecondary">
          <span className="h-1.5 w-1.5 rounded-full bg-neon" /> Live on Base, Solana, Arbitrum &amp; more
        </div>
        <h1 className="mx-auto max-w-3xl text-[44px] font-extrabold leading-[1.03] tracking-tighter sm:text-[64px]">
          The On-Chain Financial <span className="text-neon">Operating System.</span>
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-[16px] leading-relaxed text-textSecondary sm:text-[18px]">
          Fusing stablecoin payments, global local accounts, and fractional stock investing into one
          beautiful web &amp; desktop client. Phishing-resistant. Compliance-aware. Zero gas.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href="/signup" className="btn-green w-full px-7 py-3.5 text-[16px] sm:w-auto">
            Get Started (Web App)
          </Link>
          <Link href="/docs" className="btn-outline w-full px-7 py-3.5 text-[16px] sm:w-auto">
            Explore Developer Docs
          </Link>
        </div>

        {/* Partner trust marquee, directly below the hero CTAs */}
        <div className="mt-14">
          <PartnerMarquee />
        </div>

        {/* Phone mockup center stage */}
        <div className="mt-16 flex flex-col items-center gap-10">
          <PhoneMockup />
          <StoreBadges />
        </div>
      </div>
    </section>
  );
}

const FEATURES = [
  { Icon: CreditCard, title: "Stablecoin Cards", body: "2-of-2 MPC virtual cards with instant fiat settlement." },
  { Icon: TrendingUp, title: "Stocks & ETFs", body: "Fractional investing from $1 via Alpaca." },
  { Icon: Landmark, title: "Local Bank Accounts", body: "IBANs, routing, and account numbers via Wise." },
  { Icon: Code2, title: "Developer SDKs", body: "CLI tools, webhook listeners, and React Elements." },
];

function Features() {
  return (
    <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-20">
      <SectionLabel>The core modules</SectionLabel>
      <h2 className="mb-10 max-w-2xl text-[32px] font-extrabold tracking-tighter sm:text-[40px]">
        Everything money can do — in one client.
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map(({ Icon, title, body }) => (
          <div key={title} className="glass-card group p-6 transition-colors hover:border-neon/30">
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-neon/20 bg-neonSoft text-neon shadow-glow-sm">
              <Icon className="h-5 w-5" />
            </div>
            <p className="text-[17px] font-bold">{title}</p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-textSecondary">{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function DeveloperPreview() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <SectionLabel>Developer-first</SectionLabel>
      <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <h2 className="max-w-xl text-[32px] font-extrabold tracking-tighter sm:text-[40px]">
          Issue a card in a few lines.
        </h2>
        <Link href="/docs" className="text-sm font-semibold text-neon hover:underline">
          Read the docs →
        </Link>
      </div>
      <CodePreview />
    </section>
  );
}

const SECURITY = [
  { Icon: Cpu, title: "2-of-2 MPC + HSM", body: "Turnkey HSM policy co-signs every spend. No single key ever exists." },
  { Icon: Fingerprint, title: "WebAuthn passkeys", body: "Phishing-resistant fingerprint / Face ID login. No passwords, ever." },
  { Icon: ShieldCheck, title: "Real-time fraud", body: "Sardine biometric + device risk scoring gates every transfer." },
  { Icon: Zap, title: "Exploit-hardened", body: "Policy engine designed to prevent Gnosis Pay-class card exploits." },
];

function Security() {
  return (
    <section id="security" className="scroll-mt-20 border-y border-white/5 bg-white/[0.015]">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <SectionLabel>Security architecture</SectionLabel>
        <h2 className="mb-10 max-w-2xl text-[32px] font-extrabold tracking-tighter sm:text-[40px]">
          Custody-grade security, consumer-grade UX.
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SECURITY.map(({ Icon, title, body }) => (
            <div key={title} className="glow-border p-6">
              <Icon className="mb-4 h-6 w-6 text-neon" />
              <p className="font-bold">{title}</p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-textSecondary">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Pricing() {
  return (
    <section id="pricing" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-20">
      <SectionLabel>Pricing</SectionLabel>
      <h2 className="mb-10 max-w-2xl text-[32px] font-extrabold tracking-tighter sm:text-[40px]">
        Simple, transparent tiers.
      </h2>
      <PricingCards />
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-white/5">
      <div className="mx-auto max-w-6xl px-6 py-14">
        <div className="flex flex-col items-start justify-between gap-8 md:flex-row md:items-center">
          <div>
            <div className="flex items-center gap-2">
              <Logo />
              <span className="text-lg font-extrabold tracking-tighter">Furlpay</span>
            </div>
            <p className="mt-2 max-w-xs text-[13px] text-textSecondary">
              The on-chain financial operating system.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {[
              { Icon: XIcon, href: "https://x.com/furlpay", label: "X" },
              { Icon: DiscordIcon, href: "https://discord.gg/furlpay", label: "Discord" },
              { Icon: GitHubIcon, href: "https://github.com/furlpay", label: "GitHub" },
              { Icon: InstagramIcon, href: "https://instagram.com/furlpay", label: "Instagram" },
              { Icon: TelegramIcon, href: "https://t.me/furlpay", label: "Telegram" },
            ].map(({ Icon, href, label }) => (
              <a
                key={label}
                href={href}
                aria-label={label}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-textSecondary transition-colors hover:border-neon/40 hover:text-neon"
              >
                <Icon className="h-5 w-5" />
              </a>
            ))}
          </div>
        </div>

        <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-white/5 pt-6 text-[12px] text-textMuted">
          <Link href="/blog" className="hover:text-white">Blog</Link>
          <Link href="/legal/terms" className="hover:text-white">Terms</Link>
          <Link href="/legal/privacy" className="hover:text-white">Privacy</Link>
          <Link href="/legal/disclosures#securities" className="hover:text-white">SEC/FINRA disclosures</Link>
          <Link href="/legal/disclosures#mica" className="hover:text-white">MiCA registrations</Link>
          <Link href="/legal/disclosures#corporate-notice" className="text-textMuted/70 hover:text-white">
            BTG Begbies Traynor — historic liquidator reference note (for clarity).
          </Link>
        </div>
        <p className="mt-4 max-w-4xl text-[11px] leading-relaxed text-textMuted">
          © 2026 Furlpay. All rights reserved. All securities products are offered through Alpaca Securities
          LLC. All banking services are provided by FDIC-insured sponsor banks. Stablecoin conversions are
          processed by Bridge.xyz.
        </p>
      </div>
    </footer>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-neon">{children}</p>
  );
}

function Logo() {
  return (
    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-neon shadow-glow-sm">
      <svg viewBox="0 0 24 24" className="h-4 w-4 text-black" fill="none" stroke="currentColor" strokeWidth="3">
        <path d="M5 5h14M5 12h10M5 19h6" strokeLinecap="round" />
      </svg>
    </span>
  );
}
