import type { Metadata } from "next";
import Link from "next/link";
import LandingChrome from "@/components/landing/LandingChrome";
import Hero from "@/components/landing/Hero";
import AppShowcase from "@/components/landing/AppShowcase";
import BuildSection from "@/components/landing/BuildSection";
import InfrastructureSection from "@/components/landing/InfrastructureSection";
import AgentSection from "@/components/landing/AgentSection";
import ApiPlayground from "@/components/landing/ApiPlayground";
import ProductionSection from "@/components/landing/ProductionSection";
import SecuritySection from "@/components/landing/SecuritySection";
import ProofSection from "@/components/landing/ProofSection";
import WhySection from "@/components/landing/WhySection";
import ResourcesSection from "@/components/landing/ResourcesSection";
import FinalCta from "@/components/landing/FinalCta";
import Reveal from "@/components/landing/Reveal";
import PricingCards from "@/components/marketing/PricingCards";
import PartnerMarquee from "@/components/marketing/PartnerMarquee";
import VerifiedCapabilities from "@/components/marketing/VerifiedCapabilities";
import SupportChatBubble from "@/components/marketing/SupportChatBubble";
import NewsletterSignup from "@/components/newsletter/NewsletterSignup";
import {
  XIcon,
  DiscordIcon,
  GitHubIcon,
  TelegramIcon,
  InstagramIcon,
  LinkedInIcon,
  YouTubeIcon,
} from "@/components/marketing/SocialIcons";
// The wallet card teaser renders the real /wallet card, whose geometry, foil
// and tilt live in that page's stylesheet.
import "./wallet/wallet.css";

// The site canonical lives HERE, not on the root layout.
//
// It used to be `alternates: { canonical: "/" }` in layout.tsx, which every
// page without its own canonical inherited — so ~123 pages, every ticker page
// among them, told Google they were duplicates of the homepage. Owning it on
// the one page it is true for means a page that forgets to set a canonical now
// simply has none, and Google self-canonicalises, instead of being pointed at
// the wrong URL.
export const metadata: Metadata = {
  alternates: {
    canonical: "/",
    languages: { "en-US": "/", "en-IN": "/", "x-default": "/" },
  },
};

/*
 * FurlPay landing page.
 *
 * Structured as one argument rather than a feature catalogue:
 *
 *   what it is (hero)      → the product in your hand (apps, card)
 *   → the rails it runs on → what you can build → the four primitives
 *   → the differentiator (agents) → the API itself → production behaviour
 *   → security → proof → pricing → resources → ask.
 *
 * Almost all of it is a Server Component. The client islands are: the nav +
 * command palette, the API playground, the live rail status, the wallet card
 * (WebGL), and the newsletter form. Motion is CSS — no animation library is
 * loaded for this page.
 */
export default function LandingPage() {
  return (
    <div className="relative overflow-x-clip">
      {/* Scroll reveal is a CSS transition toggled by an observer; if JavaScript
          never runs, nothing may stay invisible. */}
      <noscript>
        <style>{`.reveal{opacity:1 !important;transform:none !important}`}</style>
      </noscript>

      <LandingChrome />

      <main id="main">
        <Hero />

        {/* Product surfaces: the mobile capture, where to get the apps, and the
            wallet card — kept above the rails strip. */}
        <AppShowcase />

        <div className="section pb-4">
          <PartnerMarquee />
        </div>

        <BuildSection />
        <InfrastructureSection />
        <AgentSection />

        {/* ── API experience ─────────────────────────────────────────── */}
        <section className="section section-y" id="api" aria-labelledby="api-title">
          <Reveal>
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
              <div>
                <p className="section-eyebrow">API</p>
                <h2 className="section-title mt-3 max-w-2xl" id="api-title">
                  Read it once, integrate it once.
                </h2>
              </div>
              <Link
                href="/docs"
                className="shrink-0 text-[14px] font-semibold text-neon transition-colors hover:text-white"
              >
                Read the docs →
              </Link>
            </div>
            <p className="section-lede mt-4">
              Five surfaces, one client. The Agents tab runs a real, unauthenticated request
              against this deployment — the rest show documented response shapes.
            </p>
          </Reveal>
          <Reveal className="mt-8" delay={60}>
            <ApiPlayground />
          </Reveal>
        </section>

        <ProductionSection />
        <SecuritySection />

        {/* Provenance for every claim above: each row names the route or module
            that implements it. */}
        <VerifiedCapabilities />

        <ProofSection />
        <WhySection />

        {/* ── Pricing ────────────────────────────────────────────────── */}
        <section className="section section-y scroll-mt-20" id="pricing" aria-labelledby="pricing-title">
          <Reveal>
            <p className="section-eyebrow">Pricing</p>
            <h2 className="section-title mt-3 max-w-2xl" id="pricing-title">
              Start free. Pay when you move money.
            </h2>
            <p className="section-lede mt-4">
              Every line in every tier names something that exists today.
            </p>
          </Reveal>
          <Reveal className="mt-10" delay={60}>
            <PricingCards />
          </Reveal>
        </section>

        <ResourcesSection />
        <FinalCta />
        <NewsletterCTA />
      </main>

      <Footer />
      <SupportChatBubble />
    </div>
  );
}

function NewsletterCTA() {
  return (
    <section className="border-t border-white/[0.06] bg-white/[0.012]">
      <div className="section section-y-sm max-w-2xl text-center">
        <h2 className="mx-auto max-w-xl text-[26px] font-extrabold tracking-tighter sm:text-[32px]">
          Updates worth reading, from a team that ships.
        </h2>
        <p className="mx-auto mt-3 max-w-lg text-[15px] leading-relaxed text-textSecondary">
          Product launches, engineering deep-dives, and a weekly digest you can actually skim.
          Unsubscribe anytime.
        </p>
        <div className="mx-auto mt-7 max-w-md">
          <NewsletterSignup variant="minimal" />
        </div>
        <p className="mt-4 text-[12px] text-textMuted">
          Want to pick specific topics?{" "}
          <Link href="/newsletter" className="text-neon hover:underline">
            Manage preferences
          </Link>
        </p>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-white/5">
      <div className="section py-14">
        <div className="flex flex-col items-start justify-between gap-8 md:flex-row md:items-center">
          <div>
            <div className="flex items-center gap-2">
              <Logo />
              <span className="text-lg font-extrabold tracking-tighter">Furlpay</span>
            </div>
            <p className="mt-2 max-w-xs text-[13px] text-textSecondary">
              The on-chain financial operating system.
            </p>
            <a
              href="mailto:hello@furlpay.com"
              className="mt-3 inline-block text-[13px] font-semibold text-neon transition-colors hover:text-white"
            >
              Say hello — hello@furlpay.com
            </a>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {[
              { Icon: XIcon, href: "https://x.com/furlpayglobal", label: "X" },
              { Icon: LinkedInIcon, href: "https://linkedin.com/company/furlpay", label: "LinkedIn" },
              { Icon: DiscordIcon, href: "/discord", label: "Discord" },
              { Icon: TelegramIcon, href: "/telegram", label: "Telegram" },
              { Icon: GitHubIcon, href: "https://github.com/Ashutosh0x/furlpay", label: "GitHub" },
              { Icon: InstagramIcon, href: "https://instagram.com/furlpay", label: "Instagram" },
              { Icon: YouTubeIcon, href: "https://www.youtube.com/@furlpay", label: "YouTube" },
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

        {/* Footer navigation */}
        <div className="mt-12 grid grid-cols-2 gap-8 border-t border-white/5 pt-10 sm:grid-cols-3 lg:grid-cols-6">
          <FooterCol
            title="Products"
            links={[
              ["Payments", "/products/payments"],
              ["Merchant", "/products/merchant"],
              ["Travel", "/products/travel"],
              ["Investing", "/products/investing"],
              ["Wallet", "/products/wallet"],
              ["x402 for agents", "/products/x402"],
              ["Pricing", "/pricing"],
            ]}
          />
          <FooterCol
            title="Solutions"
            links={[
              ["Hotels", "/solutions/hotels"],
              ["Airlines", "/solutions/airlines"],
              ["E-commerce", "/solutions/ecommerce"],
              ["Enterprise", "/solutions/enterprise"],
              ["AI agents", "/solutions/ai-agents"],
              ["UK 🇬🇧", "/uk"],
              ["Dubai / UAE 🇦🇪", "/ae"],
            ]}
          />
          <FooterCol
            title="Developers"
            links={[
              ["Docs", "/docs"],
              ["API reference", "/docs/architecture/api-routes"],
              ["Agent Console", "/developer/agents"],
              ["API keys", "/developer/keys"],
              ["Downloads", "/downloads"],
              ["Marketplace", "/marketplace"],
              ["GitHub", "https://github.com/Ashutosh0x/furlpay"],
            ]}
          />
          <FooterCol
            title="Community"
            links={[
              ["Discord", "/discord"],
              ["Telegram", "/telegram"],
              ["Creator Program", "/ambassadors"],
              ["Build Challenge", "/hackathon"],
              ["Swag Center", "/swag"],
              ["Payouts (B2B)", "/payouts"],
              ["X / Twitter", "https://x.com/furlpayglobal"],
              ["YouTube", "https://www.youtube.com/@furlpay"],
              ["Newsletter", "/newsletter"],
            ]}
          />
          <FooterCol
            title="Company"
            links={[
              ["About", "/about"],
              ["Trust & security", "/trust"],
              ["Use cases", "/use-cases"],
              ["Partners", "/partners"],
              ["Careers", "/careers"],
              ["Changelog", "/changelog"],
              ["Status", "/status"],
              ["Grants", "/grants"],
              ["Press", "/press"],
              ["Contact", "/contact"],
            ]}
          />
          <FooterCol
            title="Compare & legal"
            links={[
              ["All comparisons", "/compare"],
              ["vs Trip.com", "/compare/trip-com"],
              ["vs Booking.com", "/compare/booking-com"],
              ["vs Airbnb", "/compare/airbnb"],
              ["vs Stripe", "/compare/stripe"],
              ["vs Travala", "/compare/travala"],
              ["Blog", "/blog"],
              ["Terms", "/legal/terms"],
              ["Privacy", "/legal/privacy"],
            ]}
          />
        </div>

        <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-white/5 pt-6 text-[12px] text-textMuted">
          <Link href="/legal/aml-kyc" className="hover:text-white">AML / KYC</Link>
          <Link href="/legal/cookies" className="hover:text-white">Cookies</Link>
          <Link href="/legal/agent-terms" className="hover:text-white">Agent terms</Link>
          <Link href="/legal/disclosures#securities" className="hover:text-white">SEC/FINRA disclosures</Link>
          <Link href="/legal/disclosures#mica" className="hover:text-white">MiCA registrations</Link>
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

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.14em] text-textSecondary">{title}</p>
      <ul className="space-y-2 text-[13px] text-textMuted">
        {links.map(([label, href]) => (
          <li key={label}>
            {href.startsWith("http") ? (
              <a href={href} className="transition-colors hover:text-white">{label}</a>
            ) : (
              <Link href={href} className="transition-colors hover:text-white">{label}</Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Logo() {
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src="/icon.png"
      alt="Furlpay"
      width={28}
      height={28}
      className="h-7 w-7 rounded-lg shadow-glow-sm"
    />
  );
}
