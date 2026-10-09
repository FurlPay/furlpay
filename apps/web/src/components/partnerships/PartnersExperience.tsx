"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  ArrowRight, BadgeCheck, Blocks, Bot, Building2, Code2, CreditCard, Globe2, Handshake, KeyRound, Landmark, Layers,
  Network, Plane, Send, ShieldCheck, ShoppingBag, Sparkles, Wallet, Webhook, Workflow, type LucideIcon,
} from "lucide-react";
import { PARTNERSHIP_INTERESTS, type PartnershipInterest } from "@/lib/partnerships/model";
import { trackEvent } from "@/lib/analytics/vercelEvents";
import PartnershipModal, { type ModalSource } from "./PartnershipModal";
import GlobeFallback from "@/components/globe/GlobeFallback";

// Loaded after hydration: the page's text is server-rendered and indexable, and
// a device without WebGL never downloads more than the SVG fallback.
const PaymentsGlobe = dynamic(() => import("@/components/globe/PaymentsGlobe"), { ssr: false, loading: () => <GlobeFallback /> });

const INTEREST_ICON: Record<PartnershipInterest, LucideIcon> = {
  "stablecoin-infrastructure": Layers, "banking-infrastructure": Landmark, "card-issuing": CreditCard, "wallet-custody": KeyRound,
  "travel-commerce": Plane, "ai-agent-payments": Bot, "merchant-integrations": ShoppingBag, "cross-border-settlement": Globe2,
  "developer-api": Code2, "security-compliance": ShieldCheck, "ecosystem-technology": Network, "strategic-business": Handshake,
};

// Hero cards: what partners can build ON, phrased as areas, not live-status claims.
const HERO_CARDS = [
  { icon: Send, title: "Stablecoin payments", body: "A shared foundation for USDC.", cls: "fp-hero-card-a fp-float" },
  { icon: Globe2, title: "Connected infrastructure", body: "Bring your next payment idea to life.", cls: "fp-hero-card-b fp-float-2" },
  { icon: Code2, title: "Built for developers", body: "APIs, signed webhooks and SDKs.", cls: "fp-hero-card-c fp-float-3" },
  { icon: Handshake, title: "Better, together", body: "Your expertise. New possibilities.", cls: "fp-hero-card-d fp-float" },
];

// Built in this codebase and documented; each links to its real docs page.
// Whether a rail is enabled on a given deployment is shown on /status, not here.
const MODULES: { icon: LucideIcon; title: string; body: string; href: string }[] = [
  { icon: Workflow, title: "Payment APIs", body: "Create payments and read their state over REST.", href: "/docs/architecture/api-routes" },
  { icon: ShoppingBag, title: "Merchant checkout", body: "Hosted USDC checkout, payment links and QR.", href: "/products/merchant" },
  { icon: Webhook, title: "Webhooks", body: "HMAC-signed event delivery with retries.", href: "/docs/architecture/webhooks" },
  { icon: Bot, title: "Agent payment authorization", body: "Mandates, spend policies and x402 pay-per-call.", href: "/products/x402" },
  { icon: Wallet, title: "Wallet integrations", body: "Self-custodial signing and wallet connections.", href: "/products/wallet" },
  { icon: Blocks, title: "Settlement & reconciliation", body: "Balanced ledger journals, re-verified on-chain.", href: "/products/payments" },
];

// Networks the payment code supports (lib/payments/merchant/registry.ts). Listed
// as SUPPORTED NETWORKS — support for a public chain is not a partnership, so
// no logos and no "partner" wording.
const NETWORKS = ["Arbitrum", "Base", "Ethereum", "Polygon", "Arc", "Solana", "Sui"];

const BENEFITS: { live: boolean; title: string; body: string }[] = [
  { live: true, title: "Programmable payment infrastructure", body: "Payment intents, mandates and spend policies exposed as APIs." },
  { live: true, title: "Multi-chain USDC", body: "One integration across the EVM networks, Solana and Sui listed below." },
  { live: true, title: "Developer-first", body: "Documented REST routes, signed webhooks and SDKs in four languages." },
  { live: true, title: "Agentic payment authorization", body: "Agents pay under human-approved mandates, never with open keys." },
  { live: false, title: "Joint product development", body: "Co-designed rails, corridors and experiences with partners." },
  { live: false, title: "Global ecosystem collaboration", body: "Distribution, events and market entry together." },
];

export default function PartnersExperience() {
  const [modal, setModal] = useState<{ open: boolean; interest?: PartnershipInterest; source: ModalSource }>({ open: false, source: "direct" });
  const openModal = useCallback((source: ModalSource, interest?: PartnershipInterest) => {
    trackEvent("partnership_cta_click", { source });
    setModal({ open: true, source, interest });
  }, []);

  // Deep link: /partners#inquire (the navbar's Partners entry) opens the form.
  useEffect(() => {
    const check = () => { if (window.location.hash === "#inquire") setModal({ open: true, source: "nav" }); };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, []);
  const close = useCallback(() => {
    setModal(m => ({ ...m, open: false }));
    if (window.location.hash === "#inquire") history.replaceState(null, "", window.location.pathname + window.location.search);
  }, []);

  return (
    <div className="fp-partners relative overflow-hidden">
      <div className="fp-grid pointer-events-none absolute inset-x-0 top-0 h-[900px]" aria-hidden="true" />

      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <section className="fp-hero relative mx-auto grid max-w-[1280px] items-center gap-10 px-5 pb-12 pt-12 sm:px-8 lg:grid-cols-[1fr_1.05fr] lg:pb-16 lg:pt-16">
        <div className="relative z-10">
          <p className="fp-eyebrow">Global partnership network</p>
          <h1 className="mt-5 text-[44px] font-bold leading-[1.06] tracking-[-0.05em] sm:text-[60px] lg:text-[64px]" style={{ textWrap: "balance" }}>
            Global payments.<br /><span className="fp-gradient-text">Built together.</span>
          </h1>
          <p className="mt-6 max-w-[560px] text-[17px] leading-relaxed text-[var(--fp-text-2)] sm:text-[19px]">
            Build with FurlPay. Bring your expertise to stablecoin payments, wallets, merchant experiences, and the next generation of financial infrastructure.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <button type="button" className="fp-btn fp-btn-primary px-6 py-3.5 text-[16px]" onClick={() => openModal("partners_hero")}>Become a Partner <ArrowRight size={18} aria-hidden="true" /></button>
            <Link href="/talk-to-us" className="fp-btn fp-btn-ghost px-6 py-3.5 text-[16px]" onClick={() => trackEvent("partnership_cta_click", { source: "talk_to_team" })}>Talk to Our Team</Link>
          </div>
          <p className="mt-6 flex items-center gap-2 text-[12px] text-[var(--fp-text-3)]"><Network size={14} aria-hidden="true" /> For builders, platforms, and financial institutions</p>
        </div>

        <div className="relative mx-auto w-full max-w-[640px]">
          <div className="fp-globe-halo" aria-hidden="true" />
          <PaymentsGlobe center={[24, 55]} paused={modal.open} />
          <ul className="contents" aria-label="What partners build with FurlPay">
            {HERO_CARDS.map(({ icon: Icon, title, body, cls }) => (
              <li key={title} className={`fp-card fp-hero-card absolute hidden w-[215px] items-start gap-3 p-4 md:flex ${cls}`}>
                <span className="fp-icon h-10 w-10 shrink-0"><Icon size={18} aria-hidden="true" /></span>
                <span><span className="block text-[14.5px] font-semibold">{title}</span><span className="mt-0.5 block text-[12.5px] leading-snug text-[var(--fp-text-2)]">{body}</span></span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-center text-[11.5px] text-[var(--fp-text-3)]">Routes between world cities are illustrative, not FurlPay transaction data.</p>
        </div>

        {/* Mobile/tablet: the floating cards become a simple grid under the globe. */}
        <ul className="grid gap-3 sm:grid-cols-2 md:hidden" aria-label="What partners build with FurlPay">
          {HERO_CARDS.map(({ icon: Icon, title, body }) => (
            <li key={title} className="fp-card flex items-start gap-3 p-4">
              <span className="fp-icon h-10 w-10 shrink-0"><Icon size={18} /></span>
              <span><span className="block text-[14.5px] font-semibold">{title}</span><span className="mt-0.5 block text-[12.5px] text-[var(--fp-text-2)]">{body}</span></span>
            </li>
          ))}
        </ul>
      </section>

      <section className="relative mx-auto max-w-[1280px] px-5 pb-12 sm:px-8" aria-label="Our approach to partnerships">
        <div className="fp-principles grid gap-7 rounded-2xl border border-[var(--fp-border)] px-7 py-8 sm:grid-cols-3">
          {[
            { icon: Code2, title: "Developer-first", body: "Start with documented APIs" },
            { icon: ShieldCheck, title: "Designed for trust", body: "Explicit policies and permissions" },
            { icon: Handshake, title: "Build with us", body: "Explore a shared opportunity" },
          ].map(({ icon: Icon, title, body }) => <div key={title} className="flex items-center gap-4"><span className="fp-icon h-12 w-12 shrink-0 rounded-full"><Icon size={22} aria-hidden="true" /></span><div><h2 className="text-[17px] font-semibold">{title}</h2><p className="mt-1 text-[13px] text-[var(--fp-text-2)]">{body}</p></div></div>)}
        </div>
      </section>

      {/* ── Partnership categories ───────────────────────────────────── */}
      <section className="relative mx-auto max-w-[1280px] px-5 py-16 sm:px-8" aria-labelledby="fp-categories">
        <p className="fp-eyebrow">Ways to partner</p>
        <h2 id="fp-categories" className="mt-3 max-w-2xl text-[32px] font-bold tracking-[-0.03em] sm:text-[40px]">Where we want to build with you</h2>
        <p className="mt-3 max-w-2xl text-[16px] text-[var(--fp-text-2)]">Areas we are open to partnering in. Choose one to start an inquiry with it already selected.</p>
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {PARTNERSHIP_INTERESTS.map(i => {
            const Icon = INTEREST_ICON[i.id];
            return (
              <li key={i.id} className="fp-card fp-card-hover flex flex-col p-5">
                <span className="fp-icon h-11 w-11"><Icon size={20} aria-hidden="true" /></span>
                <h3 className="mt-4 text-[16px] font-semibold leading-snug">{i.title}</h3>
                <p className="mt-2 flex-1 text-[13.5px] leading-relaxed text-[var(--fp-text-2)]">{i.description}</p>
                <button type="button" onClick={() => openModal("partners_card", i.id)} className="mt-4 inline-flex items-center gap-1.5 self-start text-[13.5px] font-semibold text-[var(--fp-primary)] hover:text-[var(--fp-primary-bright)]" aria-label={`Start an inquiry about ${i.title}`}>
                  Inquire <ArrowRight size={15} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ── Why partner ──────────────────────────────────────────────── */}
      <section className="relative mx-auto max-w-[1280px] px-5 py-16 sm:px-8" aria-labelledby="fp-why">
        <p className="fp-eyebrow">Why FurlPay</p>
        <h2 id="fp-why" className="mt-3 text-[32px] font-bold tracking-[-0.03em] sm:text-[40px]">Why partner with FurlPay?</h2>
        <p className="mt-3 max-w-2xl text-[16px] text-[var(--fp-text-2)]">Explore our platform capabilities and opportunities to collaborate. Check <Link href="/status" className="text-[var(--fp-primary)] underline underline-offset-4">current rail availability</Link> before planning your integration.</p>
        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {BENEFITS.map(b => (
            <div key={b.title} className="fp-card p-6">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider ${b.live ? "bg-[rgba(0,219,160,0.1)] text-[var(--fp-primary-bright)]" : "bg-white/5 text-[var(--fp-text-2)]"}`}>
                {b.live ? <BadgeCheck size={13} aria-hidden="true" /> : <Sparkles size={13} aria-hidden="true" />}{b.live ? "Built" : "Partnership opportunity"}
              </span>
              <h3 className="mt-4 text-[17px] font-semibold">{b.title}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-[var(--fp-text-2)]">{b.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Integration modules ──────────────────────────────────────── */}
      <section className="relative mx-auto max-w-[1280px] px-5 py-16 sm:px-8" aria-labelledby="fp-build">
        <p className="fp-eyebrow">Integrate</p>
        <h2 id="fp-build" className="mt-3 text-[32px] font-bold tracking-[-0.03em] sm:text-[40px]">Build on what already exists</h2>
        <p className="mt-3 max-w-2xl text-[16px] text-[var(--fp-text-2)]">Find a starting point for your integration, then explore the product and documentation.</p>
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map(({ icon: Icon, title, body, href }) => (
            <li key={title}>
              <Link href={href} className="fp-card fp-card-hover group flex h-full items-start gap-4 p-5">
                <span className="fp-icon h-11 w-11 shrink-0"><Icon size={20} aria-hidden="true" /></span>
                <span className="flex-1"><span className="flex items-center gap-1.5 text-[16px] font-semibold">{title}<ArrowRight size={15} className="opacity-60 transition-transform group-hover:translate-x-1" aria-hidden="true" /></span><span className="mt-1 block text-[13.5px] text-[var(--fp-text-2)]">{body}</span></span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Networks (not partners) ──────────────────────────────────── */}
      <section className="relative mx-auto max-w-[1280px] px-5 py-12 sm:px-8" aria-labelledby="fp-networks">
        <div className="fp-card flex flex-col gap-6 p-6 md:flex-row md:items-center md:justify-between md:p-8">
          <div className="max-w-md">
            <p id="fp-networks" className="fp-eyebrow">Supported networks</p>
            <p className="mt-2 text-[14px] leading-relaxed text-[var(--fp-text-2)]">Networks supported by our USDC integration. Availability varies by rail. Network names do not imply a commercial partnership.</p>
          </div>
          <ul className="flex flex-wrap gap-2">
            {NETWORKS.map(n => <li key={n} className="rounded-full border border-[var(--fp-border)] px-3.5 py-1.5 text-[13.5px] text-[var(--fp-text)]">{n}</li>)}
          </ul>
        </div>
      </section>

      {/* ── Final CTA ────────────────────────────────────────────────── */}
      <section className="relative mx-auto max-w-[1280px] px-5 pb-24 pt-12 sm:px-8">
        <div className="fp-card relative overflow-hidden p-8 text-center sm:p-12">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(600px_240px_at_50%_0%,rgba(0,219,160,0.14),transparent)]" aria-hidden="true" />
          <Building2 className="relative mx-auto text-[var(--fp-primary-bright)]" size={32} aria-hidden="true" />
          <h2 className="relative mt-4 text-[28px] font-bold tracking-[-0.02em] sm:text-[36px]">Building infrastructure that moves money?</h2>
          <p className="relative mx-auto mt-3 max-w-xl text-[16px] text-[var(--fp-text-2)]">Tell us what you are building and where we could work together.</p>
          <button type="button" className="fp-btn fp-btn-primary relative mt-7 px-6 py-3.5 text-[16px]" onClick={() => openModal("partners_cta")}>Start a partnership inquiry <ArrowRight size={18} aria-hidden="true" /></button>
        </div>
      </section>
      <footer className="relative mx-auto flex max-w-[1280px] flex-wrap justify-between gap-4 border-t border-[var(--fp-border)] px-5 py-8 text-[13px] text-[var(--fp-text-3)] sm:px-8">
        <Link href="/" className="font-semibold text-[var(--fp-text)]">FurlPay</Link>
        <div className="flex gap-6"><Link href="/legal/privacy">Privacy</Link><Link href="/legal/terms">Terms</Link><Link href="/status">Platform status</Link></div>
      </footer>

      <PartnershipModal open={modal.open} onClose={close} initialInterest={modal.interest} source={modal.source} />
    </div>
  );
}
