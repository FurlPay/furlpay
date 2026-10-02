import type { Metadata } from "next";
import Link from "next/link";
import LandingChrome from "@/components/landing/LandingChrome";
import JsonLd from "@/components/JsonLd";
import { ContentHero } from "@/components/content/ContentShell";
import ResearchLibrary, { sanitizeFilters } from "@/components/content/ResearchLibrary";
import { seoMetadata } from "@/lib/seo/meta";
import { breadcrumb } from "@/lib/seo/schema";
import { CADENCES, RESEARCH_DESKS } from "@/lib/content";

type SP = Promise<Record<string, string | string[] | undefined>>;

const BASE = seoMetadata({
  title: "Research & Intelligence",
  description:
    "Evidence-graded research on stablecoins, payments infrastructure, blockchain security, regulation and networks — weekly briefs to annual reports, every figure labelled by source type.",
  path: "/research",
  ogTitle: "FurlPay Research & Intelligence",
});

// A filtered or searched view is a lens on the same library, not a page of
// its own: it stays crawlable for links but is not indexed, and its canonical
// is the unfiltered hub.
export async function generateMetadata(props: { searchParams: SP }): Promise<Metadata> {
  const f = sanitizeFilters(await props.searchParams);
  return f.desk || f.cadence || f.year || f.q ? { ...BASE, robots: { index: false, follow: true } } : BASE;
}

const SCHEDULE: { cadence: keyof typeof CADENCES; title: string; detail: string }[] = [
  { cadence: "weekly", title: "Stablecoin & Security Brief", detail: "Key developments, incident alerts and market movements." },
  { cadence: "monthly", title: "Global Stablecoin Market Report", detail: "Issuers, chains, payments, countries and competitors." },
  { cadence: "monthly", title: "Blockchain Security Intelligence", detail: "Threats, exploits, vulnerabilities and lessons." },
  { cadence: "quarterly", title: "Payments & Fintech Infrastructure Review", detail: "Partnerships, adoption, economics and market structure." },
  { cadence: "quarterly", title: "Regulatory Landscape Report", detail: "Jurisdiction-by-jurisdiction developments and implications." },
  { cadence: "annual", title: "Global Stablecoin Report", detail: "The comprehensive annual edition, with methodology." },
  { cadence: "annual", title: "Blockchain Security Year in Review", detail: "Major incidents, verifiable losses, patterns and mitigations." },
];

export default async function ResearchPage(props: { searchParams: SP }) {
  const filters = sanitizeFilters(await props.searchParams);
  return (
    <div className="min-h-screen bg-oled text-textPrimary">
      <LandingChrome />
      <JsonLd data={breadcrumb([{ name: "Home", path: "/" }, { name: "Research", path: "/research" }])} />
      <main className="section pb-24 pt-14">
        <ContentHero
          eyebrow="FurlPay Research & Intelligence"
          title="Evidence-graded research on how money actually moves"
          lead="Stablecoins, payments infrastructure, security, regulation and networks. Every major figure is labelled by source type, on-chain transfer volume is never presented as payment volume, and nothing is published before editorial review and source validation."
        />

        <section aria-labelledby="desks" className="mt-12">
          <h2 id="desks" className="text-[18px] font-bold tracking-tight">Research desks</h2>
          <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {RESEARCH_DESKS.map((d) => (
              <li key={d.slug}>
                <Link
                  href={`/research/${d.slug}`}
                  className="block h-full rounded-card border border-white/10 bg-white/[0.02] p-5 transition-colors hover:border-neon/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-neon"
                >
                  <span className="text-[15px] font-semibold">{d.title}</span>
                  <span className="mt-2 block text-[13px] leading-relaxed text-textSecondary">{d.blurb}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <ResearchLibrary base="/research" filters={filters} />

        <section aria-labelledby="schedule" className="mt-16">
          <h2 id="schedule" className="text-[18px] font-bold tracking-tight">Publishing programme</h2>
          <p className="mt-2 max-w-2xl text-[13px] text-textSecondary">
            The planned cadence. A scheduled date is never a reason to publish: each edition appears only after it passes review.
          </p>
          <ul className="mt-5 divide-y divide-white/5 rounded-card border border-white/10">
            {SCHEDULE.map((s) => (
              <li key={s.title} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-baseline sm:gap-4">
                <span className="w-36 shrink-0 text-[12px] font-semibold uppercase tracking-wide text-neon">{CADENCES[s.cadence]}</span>
                <span className="text-[14px] font-medium">{s.title}</span>
                <span className="text-[13px] text-textMuted">{s.detail}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
