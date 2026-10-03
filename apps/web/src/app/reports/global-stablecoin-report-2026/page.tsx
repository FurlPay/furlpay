import Link from "next/link";
import { ArrowDownToLine, ArrowUpRight, ChevronLeft, Globe2 } from "lucide-react";
import JsonLd from "@/components/JsonLd";
import LandingChrome from "@/components/landing/LandingChrome";
import { seoMetadata } from "@/lib/seo/meta";
import { breadcrumb, ORG_ID, SITE } from "@/lib/seo/schema";

const TITLE = "FurlPay Global Stablecoin Report 2026";
const DESCRIPTION =
  "Eighty-seven pages on where stablecoins and digital accounts move money. Supply, issuers, USDC and USDT, card-network settlement, cross-border flows, 23 market profiles, regulation, market structure and risk, fiat rails and licences, and the digital banks that issue IBANs, with every major figure labelled by source type.";
const PATH = "/reports/global-stablecoin-report-2026";
const PDF_PATH = "/reports/global-stablecoin-report-2026.pdf";

export const metadata = seoMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: PATH,
});

const CHAPTERS = [
  {
    number: "01",
    title: "Market & issuers",
    description:
      "Stablecoin supply, the issuer landscape, USDC and USDT, reserves, chains and the scale of real-economy payments.",
  },
  {
    number: "02",
    title: "Countries & cross-border flows",
    description:
      "23 market profiles, regional adoption and a closer look at the United States, India, Brazil and Asia Pacific.",
  },
  {
    number: "03",
    title: "Networks & use cases",
    description:
      "Card-network settlement, infrastructure, treasury, remittances, agent payments, regulation and the outlook.",
  },
  {
    number: "04",
    title: "Structure & risk",
    description:
      "Paxos, PYUSD and USDG, issuer economics from SEC filings, audits, liquidity, the yield wall, cross-chain rails, confidential payments and depegs.",
  },
  {
    number: "05",
    title: "Fiat rails & licences",
    description:
      "The licensing stack, MiCA after transition, PSD2 and PSD3, virtual IBANs, Verification of Payee, safeguarding and Canada.",
  },
  {
    number: "06",
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
          datePublished: "2026-10-02",
          author: { "@type": "Organization", name: "FurlPay Research" },
          publisher: { "@id": ORG_ID },
          inLanguage: "en",
          isAccessibleForFree: true,
          numberOfPages: 87,
          encoding: {
            "@type": "MediaObject",
            contentUrl: `${SITE}${PDF_PATH}`,
            encodingFormat: "application/pdf",
          },
        }}
      />

      <main className="section pb-24 pt-14">
        <Link
          href="/research"
          className="inline-flex items-center gap-1 text-[14px] text-textSecondary transition-colors hover:text-neon"
        >
          <ChevronLeft aria-hidden className="h-4 w-4" /> All research
        </Link>

        <header className="mt-8 grid items-center gap-10 lg:grid-cols-[1.35fr_0.8fr] lg:gap-16">
          <div>
            <p className="section-eyebrow">FurlPay Research · Annual report</p>
            <h1 className="mt-4 max-w-3xl text-[38px] font-extrabold leading-[1.08] tracking-tighter sm:text-[54px]">
              FurlPay Global Stablecoin Report <span className="text-neon">2026</span>
            </h1>
            <p className="mt-6 max-w-2xl text-[18px] leading-relaxed text-textSecondary">
              Stablecoins for a global economy: market data, 23 market profiles, networks,
              regulation and outlook.
            </p>
            <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-textMuted">
              {DESCRIPTION}
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href={PDF_PATH}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-green inline-flex items-center justify-center gap-2 px-7 py-3.5 text-[15px]"
              >
                Read the full report <ArrowUpRight aria-hidden className="h-4 w-4" />
                <span className="sr-only"> (PDF, opens in a new tab)</span>
              </a>
              <a
                href={PDF_PATH}
                download="FurlPay-Global-Stablecoin-Report-2026.pdf"
                className="btn-outline inline-flex items-center justify-center gap-2 px-6 py-3.5 text-[15px]"
              >
                Download PDF <ArrowDownToLine aria-hidden className="h-4 w-4" />
              </a>
            </div>
            <p className="mt-4 flex items-center gap-2 text-[13px] text-textSecondary">
              <Globe2 aria-hidden className="h-4 w-4 shrink-0 text-neon" />
              Free and publicly accessible. No signup required.
            </p>
          </div>

          <div
            aria-hidden="true"
            className="relative mx-auto flex aspect-[4/5] w-full max-w-[360px] flex-col justify-between overflow-hidden rounded-card border border-neon/30 bg-gradient-to-br from-neon/[0.12] via-white/[0.03] to-black p-8 shadow-glow-sm"
          >
            <div className="absolute -right-24 top-20 h-72 w-72 rounded-full border border-neon/20" />
            <div className="absolute -right-16 top-28 h-56 w-56 rounded-full border border-neon/15" />
            <div className="absolute -right-8 top-36 h-40 w-40 rounded-full border border-neon/10" />
            <p className="relative text-[12px] font-bold uppercase tracking-[0.22em] text-neon">
              FurlPay / Research
            </p>
            <div className="relative mt-16">
              <p className="text-[34px] font-extrabold leading-[1.1] tracking-tighter">
                Global<br />Stablecoin<br />Report
              </p>
              <p className="mt-3 text-[64px] font-extrabold leading-none tracking-tighter text-neon">
                2026
              </p>
            </div>
            <div className="relative mt-10 border-t border-white/15 pt-4 text-[11px] uppercase tracking-[0.15em] text-textSecondary">
              87 pages · 23 markets · One global view
            </div>
          </div>
        </header>

        <dl className="mt-14 grid grid-cols-2 gap-px overflow-hidden rounded-card border border-white/10 bg-white/[0.06] lg:grid-cols-4">
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
            Open the complete PDF <ArrowUpRight aria-hidden className="h-4 w-4" />
          </a>
        </footer>
      </main>
    </div>
  );
}
