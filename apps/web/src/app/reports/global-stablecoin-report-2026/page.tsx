import Image from "next/image";
import Link from "next/link";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  ChartColumnIncreasing,
  ChevronRight,
  FileText,
} from "lucide-react";
import JsonLd from "@/components/JsonLd";
import LandingChrome from "@/components/landing/LandingChrome";
import { seoMetadata } from "@/lib/seo/meta";
import ReportDownload from "@/components/content/ReportDownload";
import { breadcrumb, ORG_ID, SITE } from "@/lib/seo/schema";

const TITLE = "FurlPay Global Stablecoin Report 2026";
const DESCRIPTION =
  "Eighty-seven pages on where stablecoins and digital accounts move money. Supply, issuers, USDC and USDT, card-network settlement, cross-border flows, 23 market profiles, regulation, market structure and risk, fiat rails and licences, and the digital banks that issue IBANs, with every major figure labelled by source type.";
// Search-snippet length (~155 chars). DESCRIPTION above stays as the on-page
// summary; every claim here is on the PDF's cover or contents page.
const META_DESCRIPTION =
  "Free 87-page report: stablecoin supply, USDC vs USDT, card-network settlement, cross-border flows, regulation and 23 market profiles. Data to 2 Oct 2026.";
const PATH = "/reports/global-stablecoin-report-2026";
const PDF_PATH = "/reports/global-stablecoin-report-2026.pdf";
// Same report, images downsampled to 150 DPI (publicReportRoutes.spec pins both files).
const LITE_PDF_PATH = "/reports/global-stablecoin-report-2026-lite.pdf";
// Decimal MB, as browsers and phones show file sizes: 16,353,216 and 5,876,092 bytes.
const PDF_SIZE = "16.4 MB";
const LITE_PDF_SIZE = "5.9 MB";
// Built from the PDF's own cover page (1200x630). Lives in public/ so it is
// served as a static file, outside the middleware's login redirect.
const OG_IMAGE = "/reports/global-stablecoin-report-2026-og.png";
// The printed-report mockup in the hero (1024x1536, transparent background).
const COVER_IMAGE = "/reports/global-stablecoin-report-2026-cover.png";
const PUBLISHED = "2026-10-02";

const baseMetadata = seoMetadata({
  title: TITLE,
  description: META_DESCRIPTION,
  path: PATH,
  image: OG_IMAGE,
});

export const metadata = {
  ...baseMetadata,
  // TITLE already carries the brand; the layout template would append it again.
  title: { absolute: `${TITLE} (87-page PDF)` },
  openGraph: {
    ...baseMetadata.openGraph,
    type: "article",
    publishedTime: PUBLISHED,
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: "Cover of the FurlPay Global Stablecoin Report 2026" }],
  },
} satisfies typeof baseMetadata;

const CHAPTERS = [
  {
    number: "01",
    pages: [9, 19],
    title: "Market & issuers",
    description:
      "Stablecoin supply, the issuer landscape, USDC and USDT, reserves, chains and the scale of real-economy payments.",
  },
  {
    number: "02",
    pages: [20, 35],
    title: "Countries & cross-border flows",
    description:
      "23 market profiles, regional adoption and a closer look at the United States, India, Brazil and Asia Pacific.",
  },
  {
    number: "03",
    pages: [36, 49],
    title: "Networks & use cases",
    description:
      "Card-network settlement, infrastructure, treasury, remittances, agent payments, regulation and the outlook.",
  },
  {
    number: "04",
    pages: [50, 63],
    title: "Structure & risk",
    description:
      "Paxos, PYUSD and USDG, issuer economics from SEC filings, audits, liquidity, the yield wall, cross-chain rails, confidential payments and depegs.",
  },
  {
    number: "05",
    pages: [64, 74],
    title: "Fiat rails & licences",
    description:
      "The licensing stack, MiCA after transition, PSD2 and PSD3, virtual IBANs, Verification of Payee, safeguarding and Canada.",
  },
  {
    number: "06",
    pages: [75, 83],
    title: "Digital banks & IBANs",
    description:
      "A verified league table of the digital banks that issue IBANs: Revolut, Wise, N26, bunq, Klarna, PayPal, Stripe and Banking Circle.",
  },
];

export default function GlobalStablecoinReportPage() {
  return (
    <div className="min-h-screen bg-oled text-textPrimary">
      <LandingChrome />
      <JsonLd
        data={breadcrumb([
          { name: "Home", path: "/" },
          { name: "Research", path: "/research" },
          { name: TITLE, path: PATH },
        ])}
      />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Report",
          name: TITLE,
          headline: TITLE,
          description: DESCRIPTION,
          url: `${SITE}${PATH}`,
          datePublished: PUBLISHED,
          // The PDF's research window (page 3).
          temporalCoverage: "2025-01/2026-10-02",
          image: `${SITE}${OG_IMAGE}`,
          author: { "@type": "Organization", name: "FurlPay Research", parentOrganization: { "@id": ORG_ID } },
          publisher: { "@id": ORG_ID },
          inLanguage: "en",
          isAccessibleForFree: true,
          numberOfPages: 87,
          encoding: [
            { "@type": "MediaObject", contentUrl: `${SITE}${PDF_PATH}`, encodingFormat: "application/pdf", contentSize: PDF_SIZE },
            { "@type": "MediaObject", contentUrl: `${SITE}${LITE_PDF_PATH}`, encodingFormat: "application/pdf", contentSize: LITE_PDF_SIZE },
          ],
        }}
      />

      <main>
        <ReportHero />

        <div className="section pb-24 pt-6">
          <dl className="mt-14grid grid-cols-2 gap-px overflow-hidden rounded-card border border-white/10 bg-white/[0.06] lg:grid-cols-4">
            {[
              { label: "Published", value: "2 October 2026" },
              { label: "Research window", value: "January 2025 – 2 October 2026" },
              { label: "Format", value: "87-page PDF" },
              { label: "Edition", value: "Annual · 2026 edition" },
            ].map((detail) => (
              <div key={detail.label} className="bg-oled p-5">
                <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-textMuted">
                  {detail.label}
                </dt>
                <dd className="mt-2 text-[14px] font-semibold leading-relaxed">{detail.value}</dd>
              </div>
            ))}
          </dl>

          <section aria-labelledby="summary-heading" className="mt-16 grid gap-6 lg:grid-cols-[0.65fr_1.35fr]">
            <div>
              <p className="section-eyebrow">Executive summary</p>
              <h2 id="summary-heading" className="mt-3 text-[28px] font-extrabold leading-tight tracking-tighter">
                Where stablecoins actually move money.
              </h2>
            </div>
            <div className="space-y-4 text-[16px] leading-relaxed text-textSecondary">
              <p>
                The report tests whether USDC is becoming an important settlement layer for global
                payments. Its conclusion is strongest in specific areas: card-network settlement,
                crypto-linked card spend, institutional mint and redeem, and agent micropayments.
              </p>
              <p>
                The report finds the thesis supported for institutional and network settlement,
                partly supported for card-funded consumer spending, and not yet supported for mass
                remittances and emerging-market retail, where USDT dominates.
              </p>
            </div>
          </section>

          <section aria-labelledby="contents-heading" className="mt-16">
            <h2 id="contents-heading" className="text-[24px] font-bold tracking-tight">Inside the report</h2>
            <div className="mt-6 grid gap-5 md:grid-cols-3">
              {CHAPTERS.map((chapter) => (
                <article key={chapter.number} className="rounded-card border border-white/10 bg-white/[0.02] p-6">
                  <p className="text-[12px] font-semibold tracking-[0.16em] text-neon">PART {chapter.number}</p>
                  <h3 className="mt-5 text-[18px] font-bold tracking-tight">{chapter.title}</h3>
                  <p className="mt-3 text-[14px] leading-relaxed text-textSecondary">{chapter.description}</p>
                  <a
                    href={`${PDF_PATH}#page=${chapter.pages[0]}`}
                    className="mt-4 inline-flex items-center gap-1 text-[13px] font-semibold text-neon hover:underline"
                  >
                    Read Part {chapter.number}, pages {chapter.pages[0]}–{chapter.pages[1]}
                    <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />
                    <span className="sr-only"> (PDF)</span>
                  </a>
                </article>
              ))}
            </div>
          </section>

          <section aria-labelledby="methodology-heading" className="mt-14 rounded-card border border-white/10 p-6 sm:p-8">
            <h2 id="methodology-heading" className="text-[20px] font-bold tracking-tight">How to read the data</h2>
            <p className="mt-3 max-w-4xl text-[14px] leading-relaxed text-textSecondary">
              The report distinguishes on-chain transfers, adjusted transfers, institutional
              settlement and economic payments. These measures have different scopes and should
              not be added together. Major figures carry source labels and evidence statuses;
              company claims and estimates are identified in the PDF alongside its methodology
              and references.
            </p>
            <p className="mt-4 max-w-4xl text-[12px] leading-relaxed text-textMuted">
              For information only; not investment, legal or tax advice. Company-reported metrics
              have not been independently audited. FurlPay capabilities in the report are marked
              “To be confirmed” pending product documentation.
            </p>
          </section>

          <footer className="mt-14 flex flex-col items-start justify-between gap-5 border-t border-white/10 pt-7 sm:flex-row sm:items-center">
            <p className="text-[14px] text-textSecondary">FurlPay Research · Open access for everyone.</p>
            <a href={PDF_PATH} className="inline-flex items-center gap-2 text-[14px] font-semibold text-neon hover:underline">
              Open the complete PDF ({PDF_SIZE}) <ArrowUpRight aria-hidden className="h-4 w-4" />
            </a>
          </footer>
        </div>
      </main>
    </div>
  );
}

const HERO_FACTS = [
  { icon: CalendarDays, label: "Published", value: "2 October 2026" },
  { icon: FileText, label: "Pages", value: "87" },
  { icon: ChartColumnIncreasing, label: "Edition", value: "Annual report" },
];

/** The report's landing hero: copy and actions on the left, the printed
 *  report on the right, lit by a restrained green atmosphere. */
function ReportHero() {
  return (
    <section aria-labelledby="report-title" className="relative isolate overflow-hidden">
      {/* Atmosphere: a glow behind the report, a horizontal light band across
          the lower hero, and thin orbital lines. Decorative only. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_72%_42%,rgba(0,229,153,0.13),transparent_70%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_45%_40%_at_74%_48%,rgba(0,229,153,0.10),transparent_70%)]" />
        <div className="absolute inset-x-0 top-[74%] h-56 -translate-y-1/2 bg-[radial-gradient(ellipse_50%_45%_at_72%_50%,rgba(0,229,153,0.24),transparent_70%)] blur-2xl" />
        <div className="absolute left-[45%] right-0 top-[74%] h-px bg-gradient-to-r from-transparent via-neon/70 to-neon/10 blur-[0.5px]" />
        <svg
          className="absolute right-[-10%] top-[4%] hidden h-[88%] w-[58%] lg:block"
          viewBox="0 0 1000 800"
          fill="none"
          preserveAspectRatio="none"
        >
          <ellipse cx="560" cy="430" rx="520" ry="210" transform="rotate(-14 560 430)" stroke="rgb(0 229 153 / 0.16)" />
          <ellipse cx="620" cy="400" rx="430" ry="300" transform="rotate(18 620 400)" stroke="rgb(0 229 153 / 0.10)" />
          <ellipse cx="700" cy="360" rx="330" ry="330" stroke="rgb(0 229 153 / 0.07)" />
        </svg>
      </div>

      <div className="mx-auto w-full max-w-[1640px] px-5 pb-16 pt-8 sm:px-8 lg:px-12 lg:pb-20 lg:pt-11">
        <nav aria-label="Breadcrumb" className="flex items-center gap-3 text-[15px] text-textSecondary sm:text-[17px]">
          <Link href="/research" className="inline-flex items-center gap-3 transition-colors hover:text-textPrimary">
            <ArrowLeft aria-hidden className="h-[18px] w-[18px]" />
            All research
          </Link>
          <ChevronRight aria-hidden className="h-4 w-4" />
          <Link href="/research/stablecoin-markets" className="text-white/80 transition-colors hover:text-textPrimary">
            Stablecoins
          </Link>
        </nav>

        <div className="mt-12 grid items-center gap-14 lg:mt-[52px] lg:items-start lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)] lg:gap-8 lg:pl-[60px]">
          <div className="lg:pt-3">
            <p className="text-[13px] font-semibold uppercase tracking-[0.2em] text-neon sm:text-[14px]">
              Annual report
            </p>
            <h1
              id="report-title"
              className="mt-4 text-[clamp(40px,3.95vw,70px)] font-bold leading-[1.0] tracking-[-0.035em] text-textPrimary"
            >
              FurlPay Global
              <br />
              Stablecoin Report
              <br />
              <span className="text-neon">2026</span>
            </h1>
            <p className="mt-5 max-w-[650px] text-[clamp(17px,1.24vw,22px)] leading-[1.5] text-white/70">
              A data-driven analysis of stablecoin supply, payment flows, issuers, cross-border
              adoption, card settlement, regulation and the infrastructure moving money globally.
            </p>

            {/* One row with dividers from `sm` up (never wrapped, so a divider
                cannot start a line); a plain stacked list on phones. */}
            <dl className="mt-9 grid gap-4 sm:flex sm:items-center">
              {HERO_FACTS.map(({ icon: Icon, label, value }, i) => (
                <div
                  key={label}
                  className={`flex items-center gap-5 sm:gap-6 sm:pr-10 lg:gap-3 lg:pr-4 xl:gap-6 xl:pr-10 ${i > 0 ? "sm:border-l sm:border-white/15 sm:pl-8 lg:pl-4 xl:pl-8" : ""}`}
                >
                  <Icon aria-hidden strokeWidth={1.5} className="h-7 w-7 shrink-0 text-white/75 lg:h-6 lg:w-6 xl:h-7 xl:w-7" />
                  <div className="whitespace-nowrap text-[15px] leading-snug lg:text-[14px] xl:text-[15px]">
                    <dt className="text-textSecondary">{label}</dt>
                    <dd className="text-textPrimary">{value}</dd>
                  </div>
                </div>
              ))}
            </dl>

            {/* Download asks for a business email first (ReportDownload), then
                hands over the lite edition: same 87 pages and text, images
                compressed, 5.9 MB instead of 16.4 MB on mobile data. The full
                file is linked from every chapter and the page footer. */}
            <div className="mt-9 flex flex-col gap-4 sm:flex-row sm:gap-5">
              <ReportDownload
                slug="global-stablecoin-report-2026"
                reportTitle={TITLE}
                fileHref={LITE_PDF_PATH}
                fileName="FurlPay-Global-Stablecoin-Report-2026.pdf"
                coverSrc={COVER_IMAGE}
                className="inline-flex h-[60px] items-center justify-center gap-3 whitespace-nowrap rounded-[10px] bg-neon px-10 text-[17px] font-semibold text-black shadow-glow-sm transition hover:-translate-y-0.5 hover:bg-neon/90 sm:h-[66px] sm:px-[52px] sm:text-[19px] lg:px-8 xl:px-[52px]"
              >
                Download PDF
                <ArrowDownToLine aria-hidden className="h-5 w-5" />
              </ReportDownload>
              <a
                href="#summary-heading"
                className="inline-flex h-[60px] items-center justify-center gap-3 whitespace-nowrap rounded-[10px] border border-white/25 bg-white/[0.02] px-10 text-[17px] font-semibold text-textPrimary transition hover:border-white/45 hover:bg-white/[0.05] sm:h-[66px] sm:px-[50px] sm:text-[19px] lg:px-8 xl:px-[50px]"
              >
                Explore report
                <ArrowRight aria-hidden className="h-5 w-5" />
              </a>
            </div>
            <p className="mt-4 flex flex-wrap items-center gap-x-3 text-[15px] text-textSecondary">
              <span>Free research</span>
              <span aria-hidden>·</span>
              <span>PDF</span>
              <span aria-hidden>·</span>
              <span>No account required</span>
            </p>
          </div>

          <div className="relative mx-auto flex w-full max-w-[480px] justify-center lg:-mt-[72px] lg:max-w-none lg:pr-12">
            {/* Glow and floor reflection the cover stands in. */}
            <div aria-hidden className="absolute left-1/2 top-1/2 -z-10 h-[78%] w-[86%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-neon/[0.14] blur-[90px]" />
            <div aria-hidden className="absolute bottom-[5%] left-1/2 -z-10 h-10 w-[62%] -translate-x-1/2 rounded-[50%] bg-neon/25 blur-2xl" />
            <Image
              src={COVER_IMAGE}
              alt="The FurlPay Global Stablecoin Report 2026, printed annual report cover"
              width={1024}
              height={1536}
              priority
              sizes="(min-width: 1024px) 30vw, 78vw"
              className="h-auto w-[min(78vw,360px)] drop-shadow-[0_40px_60px_rgba(0,0,0,0.6)] lg:w-[clamp(320px,26vw,470px)]"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
