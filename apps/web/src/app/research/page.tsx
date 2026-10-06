import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Search } from "lucide-react";
import LandingChrome from "@/components/landing/LandingChrome";
import JsonLd from "@/components/JsonLd";
import { EmptyState } from "@/components/content/ContentShell";
import ContentCard from "@/components/content/ContentCard";
import { sanitizeFilters, type LibraryFilters } from "@/components/content/ResearchLibrary";
import { DeskCard, FeaturedReportCard, ProgrammeCard, SeriesCard, type SeriesArtKind } from "@/components/research/ResearchCards";
import { seoMetadata } from "@/lib/seo/meta";
import { breadcrumb } from "@/lib/seo/schema";
import { RESEARCH_DESKS, filterResearch, publishedReports, reportSummary, type Cadence } from "@/lib/content";

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

// Card copy for the six desks: the catalog's blurbs, shortened for a card.
const DESK_CARD_BLURB: Record<string, string> = {
  "stablecoin-markets": "Supply, issuers, reserves, chains and real-world payment flows.",
  security: "Incidents, depegs, custody and wallet risk.",
  "payments-infrastructure": "Card networks, settlement, cross-border economics and merchant adoption.",
  regulation: "Enacted law, final rules, consultations and guidance.",
  networks: "Chains, x402 and agent payments, settlement latency and tooling.",
  "market-intelligence": "Launches, partnerships, pricing and market structure.",
};

// Filter pills: short labels for the same six desks.
const PILLS: { label: string; desk?: string }[] = [
  { label: "All" },
  { label: "Stablecoins", desk: "stablecoin-markets" },
  { label: "Payments", desk: "payments-infrastructure" },
  { label: "Security", desk: "security" },
  { label: "Regulation", desk: "regulation" },
  { label: "Infrastructure", desk: "networks" },
  { label: "Markets", desk: "market-intelligence" },
];

// The planned series. None has a published edition yet, so the cards say so
// and link to their desk; no date or "Read" is shown for an edition that does
// not exist.
const SERIES: { cadence: Cadence; title: string; blurb: string; desk: string; art: SeriesArtKind }[] = [
  { cadence: "monthly", title: "Global Stablecoin Market Report", blurb: "Issuers, chains, payments and market developments.", desk: "stablecoin-markets", art: "rings" },
  { cadence: "monthly", title: "Blockchain Security Intelligence", blurb: "Threats, exploits, vulnerabilities and lessons.", desk: "security", art: "shield" },
  { cadence: "quarterly", title: "Payments & Fintech Infrastructure Review", blurb: "Partnerships, adoption, economics and market structure.", desk: "payments-infrastructure", art: "cards" },
  { cadence: "quarterly", title: "Regulatory Landscape Report", blurb: "Jurisdiction-by-jurisdiction developments and implications.", desk: "regulation", art: "stack" },
];

// One title per cadence for the compact cards; the full plan is one click away.
const PROGRAMME: { cadence: Cadence; title: string; desk: string }[] = [
  { cadence: "weekly", title: "Stablecoin & Security Brief", desk: "stablecoin-markets" },
  { cadence: "monthly", title: "Global Stablecoin Market Report", desk: "stablecoin-markets" },
  { cadence: "quarterly", title: "Payments & Fintech Review", desk: "payments-infrastructure" },
  { cadence: "annual", title: "Global Stablecoin Report", desk: "stablecoin-markets" },
];
const FULL_PROGRAMME: { cadence: Cadence; title: string }[] = [
  { cadence: "weekly", title: "Stablecoin & Security Brief" },
  { cadence: "monthly", title: "Global Stablecoin Market Report" },
  { cadence: "monthly", title: "Blockchain Security Intelligence" },
  { cadence: "quarterly", title: "Payments & Fintech Infrastructure Review" },
  { cadence: "quarterly", title: "Regulatory Landscape Report" },
  { cadence: "annual", title: "Global Stablecoin Report" },
  { cadence: "annual", title: "Blockchain Security Year in Review" },
];

// Topics the flagship's own chapters cover (report page: Parts 01–06).
const FEATURED_TOPICS: Record<string, string[]> = {
  "global-stablecoin-report-2026": ["Stablecoins", "Payments", "Cross-border", "Regulation", "23 markets"],
};

const pillHref = (f: LibraryFilters, desk?: string) => {
  const p = new URLSearchParams();
  if (desk) p.set("desk", desk);
  if (f.q) p.set("q", f.q);
  const s = p.toString();
  return s ? `/research?${s}#library` : "/research#library";
};

const SECTION_H2 = "text-[clamp(22px,2.2vw,28px)] font-bold tracking-tight";

export default async function ResearchPage(props: { searchParams: SP }) {
  const filters = sanitizeFilters(await props.searchParams);
  const filtered = !!(filters.desk || filters.cadence || filters.year || filters.q);
  const all = publishedReports();
  const results = filterResearch(filters, all);
  const featured = results.find((r) => r.featured) ?? null;
  const others = results.filter((r) => r !== featured);
  const series = filters.q ? [] : SERIES.filter((s) => !filters.desk || s.desk === filters.desk);

  return (
    <div className="min-h-screen bg-oled text-textPrimary">
      <LandingChrome />
      <JsonLd data={breadcrumb([{ name: "Home", path: "/" }, { name: "Research", path: "/research" }])} />

      <main className="relative isolate overflow-hidden">
        <HeroGlobe />

        <div className="section pb-24 pt-12 sm:pt-14">
          {/* ── Hero ── */}
          <header className="max-w-[760px]">
            <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-neon">FurlPay Research &amp; Intelligence</p>
            <h1 className="mt-4 text-[clamp(34px,4.2vw,52px)] font-bold leading-[1.06] tracking-tight">
              Evidence-graded research on <br className="hidden md:block" />how money actually moves
            </h1>
            <p className="mt-4 max-w-[540px] text-[16px] leading-relaxed text-textSecondary sm:text-[17px]">
              Research on stablecoins, payments, infrastructure, security and regulation — grounded in data and primary
              sources.
            </p>
          </header>

          {/* ── Research desks ── */}
          <section aria-labelledby="desks" className="mt-14">
            <h2 id="desks" className={SECTION_H2}>Research desks</h2>
            <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {RESEARCH_DESKS.map((d) => (
                <li key={d.slug}>
                  <DeskCard slug={d.slug} title={d.title} blurb={DESK_CARD_BLURB[d.slug] ?? d.blurb} />
                </li>
              ))}
            </ul>
          </section>

          {/* ── Research library ── */}
          <section id="library" aria-labelledby="library-h" className="mt-16 scroll-mt-24">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h2 id="library-h" className={SECTION_H2}>Research library</h2>
                <p className="mt-2 text-[15px] text-textSecondary">Explore FurlPay&apos;s latest research.</p>
              </div>
              <form action="/research#library" method="get" role="search" className="flex w-full gap-3 lg:max-w-[560px]">
                {filters.desk && <input type="hidden" name="desk" value={filters.desk} />}
                <label htmlFor="research-q" className="sr-only">Search research</label>
                <div className="relative min-w-0 flex-1">
                  <Search aria-hidden className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-textMuted" />
                  <input
                    id="research-q"
                    name="q"
                    type="search"
                    defaultValue={filters.q ?? ""}
                    placeholder="Search reports, e.g. USDC, GENIUS Act, Singapore"
                    className="h-12 w-full rounded-[10px] border border-white/10 bg-white/[0.03] pl-11 pr-4 text-[14px] outline-none transition-colors placeholder:text-textMuted focus:border-neon/60 focus-visible:ring-2 focus-visible:ring-neon/20"
                  />
                </div>
                <button type="submit" className="btn-green h-12 shrink-0 rounded-[10px] px-6 text-[14px]">
                  Search
                </button>
              </form>
            </div>

            <nav aria-label="Filter by research area" className="-mx-5 mt-6 overflow-x-auto px-5 sm:mx-0 sm:px-0">
              <ul className="flex w-max gap-2 sm:w-auto sm:flex-wrap">
                {PILLS.map((p) => {
                  const active = (filters.desk ?? undefined) === p.desk;
                  return (
                    <li key={p.label}>
                      <Link
                        href={pillHref(filters, p.desk)}
                        aria-current={active ? "page" : undefined}
                        className={`inline-flex h-9 items-center whitespace-nowrap rounded-full border px-4 text-[13px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neon ${
                          active
                            ? "border-neon bg-neon text-black"
                            : "border-white/10 bg-white/[0.02] text-textPrimary/85 hover:border-white/25"
                        }`}
                      >
                        {p.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>

            {filtered && (
              <p className="mt-5 text-[13px] text-textMuted" aria-live="polite">
                {results.length} {results.length === 1 ? "report" : "reports"} ·{" "}
                <Link href="/research#library" className="text-neon hover:underline">Clear filters</Link>
              </p>
            )}

            <div className="mt-8">
              {featured ? (
                <FeaturedReportCard report={featured} topics={FEATURED_TOPICS[featured.slug] ?? []} />
              ) : results.length === 0 ? (
                <EmptyState
                  title={all.length === 0 ? "No research published yet" : "No reports match these filters"}
                  body={
                    all.length === 0
                      ? "FurlPay Research is in preparation. Reports appear here only after editorial review and source validation."
                      : "Try a different search term, or clear the filters."
                  }
                  action={{ label: "Clear filters", href: "/research#library" }}
                />
              ) : null}
            </div>

            {others.length > 0 && (
              <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {others.map((r) => (
                  <li key={r.slug}>
                    <ContentCard item={reportSummary(r)} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ── Upcoming research (planned series) ── */}
          {series.length > 0 && (
            <section aria-labelledby="upcoming" className="mt-14">
              <div className="flex items-end justify-between gap-4">
                <h2 id="upcoming" className={SECTION_H2}>Upcoming research</h2>
                <Link href="#programme" className="inline-flex items-center gap-1.5 text-[14px] font-medium text-neon hover:underline">
                  View programme <ArrowRight aria-hidden className="h-4 w-4" />
                </Link>
              </div>
              <ul className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {series.map((s) => (
                  <li key={s.title} className="min-h-[240px] xl:min-h-[300px]">
                    <SeriesCard cadence={s.cadence} title={s.title} blurb={s.blurb} deskSlug={s.desk} art={s.art} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* ── Publishing programme (compact) ── */}
          <section id="programme" aria-labelledby="programme-h" className="mt-14 scroll-mt-24">
            <h2 id="programme-h" className={SECTION_H2}>Publishing programme</h2>
            <p className="mt-2 text-[15px] text-textSecondary">Our regular research publications.</p>
            <ul className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {PROGRAMME.map((p) => (
                <li key={p.cadence}>
                  <ProgrammeCard cadence={p.cadence} title={p.title} href={`/research/${p.desk}`} />
                </li>
              ))}
            </ul>
            <details className="group mt-4 text-[13px] text-textSecondary">
              <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 font-medium text-neon hover:underline">
                View full programme
                <ArrowRight aria-hidden className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
              </summary>
              <ul className="mt-3 grid gap-x-8 gap-y-1.5 sm:grid-cols-2">
                {FULL_PROGRAMME.map((p) => (
                  <li key={p.title}>
                    <span className="mr-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-neon">{p.cadence}</span>
                    {p.title}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-textMuted">Each edition is published only after editorial review and source validation.</p>
            </details>
          </section>
        </div>
      </main>
    </div>
  );
}

/** Atmospheric green globe behind the hero: decorative, fades into the page. */
function HeroGlobe() {
  return (
    <div aria-hidden className="pointer-events-none absolute right-[-12%] top-[-140px] -z-10 hidden h-[620px] w-[620px] md:block lg:right-[-4%]">
      <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_45%_55%,rgba(0,229,153,0.16),transparent_62%)]" />
      <svg viewBox="0 0 600 600" className="absolute inset-0 h-full w-full [mask-image:radial-gradient(circle_at_40%_60%,black_35%,transparent_72%)]">
        <g fill="none" stroke="rgb(0 229 153 / 0.28)" strokeWidth="1">
          <circle cx="300" cy="300" r="230" />
          <ellipse cx="300" cy="300" rx="230" ry="80" />
          <ellipse cx="300" cy="300" rx="230" ry="160" />
          <ellipse cx="300" cy="300" rx="80" ry="230" />
          <ellipse cx="300" cy="300" rx="160" ry="230" />
          <path d="M70 300h460" />
        </g>
        <g fill="rgb(0 229 153 / 0.7)">
          <circle cx="210" cy="190" r="2.5" />
          <circle cx="380" cy="240" r="2" />
          <circle cx="330" cy="360" r="2.5" />
          <circle cx="240" cy="400" r="2" />
          <circle cx="430" cy="320" r="2" />
          <circle cx="160" cy="300" r="2" />
        </g>
        <path d="M210 190 Q300 230 380 240 T430 320" fill="none" stroke="rgb(0 229 153 / 0.5)" strokeWidth="1" />
        <path d="M160 300 Q240 340 330 360 T240 400" fill="none" stroke="rgb(0 229 153 / 0.35)" strokeWidth="1" />
      </svg>
    </div>
  );
}
