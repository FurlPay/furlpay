import LandingChrome from "@/components/landing/LandingChrome";
import { Hero, Section, CtaBand, CompareTable } from "@/components/marketing/blocks";
import FaqSection from "@/components/marketing/FaqSection";
import JsonLd from "@/components/JsonLd";
import { breadcrumb } from "@/lib/seo/schema";
import type { ReactNode } from "react";

// Template for competitor comparison pages (/compare/*). Honest, sourced, with
// a "as of" disclaimer and trademark note. Highlights Furlpay's column.
export type CompareProps = {
  competitor: string; // display name, e.g. "BitPay"
  slug: string; // e.g. "bitpay"
  crumbBase?: string; // path prefix for the breadcrumb, default "/compare"
  title: string; // H1
  subtitle: ReactNode;
  atomicAnswer: ReactNode;
  rows: { feature: string; furlpay: string; other: string; furlpayWins?: boolean }[];
  analysis: { title: string; body: string }[];
  faq: { q: string; a: string }[];
  disclaimer?: string;
  /**
   * Rendered directly under the hero, above the table.
   *
   * WHY IT IS ON THE TEMPLATE. The five travel comparisons each described
   * booking a stay in USDC, a single-use Visa card and a weekly creator
   * payout as things Furlpay does, opposite a competitor that genuinely does
   * book travel today. None of the three is in production. A page that
   * compares a shipped product against a roadmap has to say so where the
   * reader is looking, not in a footnote — and putting the prop here means
   * the next comparison page has to decide about it rather than forget.
   */
  developmentNotice?: ReactNode;
};

export default function ComparePage(p: CompareProps) {
  return (
    <div className="min-h-screen bg-oled">
      <LandingChrome />
      <JsonLd
        data={breadcrumb([
          { name: "Home", path: "/" },
          { name: "Compare", path: `${p.crumbBase ?? "/compare"}/${p.slug}` },
          { name: `Furlpay vs ${p.competitor}`, path: `${p.crumbBase ?? "/compare"}/${p.slug}` },
        ])}
      />
      <main className="mx-auto max-w-4xl px-6 pb-24 pt-14">
        <Hero
          eyebrow="Compare"
          title={p.title}
          subtitle={p.subtitle}
          secondary={{ href: "/resources/tools/fee-calculator", label: "Calculate savings" }}
        />

        {p.developmentNotice && (
          <p className="mt-8 rounded-xl border border-amber-400/25 bg-amber-400/[0.05] p-5 text-[15px] leading-relaxed text-textSecondary">
            {p.developmentNotice}
          </p>
        )}

        <p className="mt-8 rounded-xl border border-white/10 bg-white/[0.02] p-5 text-[15px] leading-relaxed text-textSecondary">
          {p.atomicAnswer}
        </p>

        <div className="mt-12">
          <CompareTable competitor={p.competitor} rows={p.rows} />
        </div>

        <Section title="The differences that matter">
          <div className="space-y-5">
            {p.analysis.map((a) => (
              <div key={a.title} className="glass-card p-6">
                <h3 className="text-[17px] font-bold">{a.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-textSecondary">{a.body}</p>
              </div>
            ))}
          </div>
        </Section>

        <FaqSection items={p.faq} />

        <CtaBand
          title="Ready to switch?"
          subtitle="Get started in under two minutes — no app download."
          secondary={{ href: "/docs", label: "Read the docs" }}
        />

        <p className="mt-10 text-center text-[11px] text-textMuted">
          {p.disclaimer ??
            `Comparison based on publicly available information as of July 2026 and may change. ${p.competitor} is a trademark of its respective owner. Fees vary by plan, region, and asset.`}
        </p>
      </main>
    </div>
  );
}
