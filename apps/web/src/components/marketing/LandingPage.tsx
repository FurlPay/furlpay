import LandingChrome from "@/components/landing/LandingChrome";
import { Hero, FeatureGrid, Section, CtaBand } from "@/components/marketing/blocks";
import FaqSection from "@/components/marketing/FaqSection";
import JsonLd from "@/components/JsonLd";
import MerchantSettlementNotice from "@/components/marketing/MerchantSettlementNotice";
import { breadcrumb } from "@/lib/seo/schema";
import type { ReactNode } from "react";

// Data-driven landing template for the simpler /solutions/* and utility pages.
// Emits a BreadcrumbList + FAQPage graph and follows the same layout as the
// hand-built product pages so the whole marketing surface reads as one system.
export type LandingProps = {
  eyebrow: string;
  title: ReactNode;
  subtitle: ReactNode;
  atomicAnswer: ReactNode; // the 50-word block AI Overviews extract
  featuresTitle?: string;
  features: { title: string; body: string }[];
  faq: { q: string; a: string }[];
  crumbs: { name: string; path: string }[]; // root → current
  primary?: { href: string; label: string };
  secondary?: { href: string; label: string };
  cta: { title: string; subtitle?: string; primary?: { href: string; label: string }; secondary?: { href: string; label: string } };
  disclaimer?: string;
  banner?: ReactNode; // rendered prominently right under the hero (e.g. FCA risk warning)
  /**
   * Render the merchant-settlement notice under the hero.
   *
   * A separate prop from `banner` because the two coexist: the UK, UAE and
   * Japan variants already use `banner` for their regulator risk note, and a
   * page must be able to carry both without one displacing the other.
   *
   * Opt-in rather than default-on: this template also renders utility pages
   * (calculators, guides) that make no merchant offer, and a settlement notice
   * there would be noise that teaches readers to skip amber boxes.
   */
  merchantOffer?: boolean;
  children?: ReactNode; // optional extra sections between features and FAQ
};

export default function LandingPage(p: LandingProps) {
  return (
    <div className="min-h-screen bg-oled">
      <LandingChrome />
      <JsonLd data={breadcrumb(p.crumbs)} />
      {/* `.section` rather than a bespoke max-w-5xl px-6. The nav is `.section`
          (max-w-6xl, px-5 sm:px-6), so a narrower body sat 128px inside its own
          header and read as a squeezed, mobile-ish layout on a desktop. Sharing
          the utility is what holds header and content to one edge — and it
          fixes all 16 pages that render this template at once. */}
      <main className="section pb-24 pt-14">
        <Hero
          eyebrow={p.eyebrow}
          title={p.title}
          subtitle={p.subtitle}
          primary={p.primary}
          secondary={p.secondary}
        />

        {p.banner}
        {p.merchantOffer && <MerchantSettlementNotice />}

        <p className="mt-8 max-w-2xl rounded-xl border border-white/10 bg-white/[0.02] p-5 text-[15px] leading-relaxed text-textSecondary">
          {p.atomicAnswer}
        </p>

        <Section title={p.featuresTitle ?? "What you get"}>
          <FeatureGrid items={p.features} />
        </Section>

        {p.children}

        <FaqSection items={p.faq} />

        <CtaBand
          title={p.cta.title}
          subtitle={p.cta.subtitle}
          primary={p.cta.primary}
          secondary={p.cta.secondary}
        />

        {p.disclaimer && (
          <p className="mt-10 text-center text-[11px] text-textMuted">{p.disclaimer}</p>
        )}
      </main>
    </div>
  );
}
