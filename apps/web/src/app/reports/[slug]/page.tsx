import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, FileText } from "lucide-react";
import LandingChrome from "@/components/landing/LandingChrome";
import JsonLd from "@/components/JsonLd";
import LeadCaptureForm from "@/components/content/LeadCaptureForm";
import { KeyFindingItem, RelatedContent } from "@/components/content/ContentShell";
import { seoMetadata } from "@/lib/seo/meta";
import { breadcrumb, SITE } from "@/lib/seo/schema";
import {
  formatDate,
  getPublishedReport,
  publishedReports,
  reportCta,
  resolveRelatedReports,
  resolveRelatedWebinars,
  type ReportBlock,
} from "@/lib/content";

// /reports/[slug]
//
// generateStaticParams enumerates PUBLISHED reports only, and dynamicParams is
// false — so a draft slug is a real 404 at routing time, not a soft 404 that
// Google indexes, and the publishing pipeline is not guessable.

export function generateStaticParams() {
  return publishedReports().map((r) => ({ slug: r.slug }));
}

export const dynamicParams = false;

export async function generateMetadata(props: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await props.params;
  const report = getPublishedReport(slug);
  if (!report) return {};
  return seoMetadata({
    title: report.title,
    description: report.description,
    path: `/reports/${report.slug}`,
    image: report.coverImage,
    ogTitle: report.title,
  });
}

export default async function ReportPage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const report = getPublishedReport(slug);
  if (!report) notFound();

  const cta = reportCta(report);
  const relatedReports = resolveRelatedReports(report.relatedReports);
  const relatedWebinars = resolveRelatedWebinars(report.relatedWebinars);

  // schema.org Article. Only fields we actually hold — no invented author, no
  // invented image, no fabricated modification date.
  const articleLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: report.title,
    description: report.description,
    datePublished: report.publishedAt,
    url: `${SITE}/reports/${report.slug}`,
    publisher: { "@type": "Organization", name: "FurlPay", url: SITE },
    ...(report.updatedAt ? { dateModified: report.updatedAt } : {}),
    ...(report.coverImage ? { image: `${SITE}${report.coverImage}` } : {}),
    ...(report.authors?.length
      ? { author: report.authors.map((name) => ({ "@type": "Organization", name })) }
      : {}),
  };

  return (
    <div className="min-h-screen bg-oled text-textPrimary">
      <LandingChrome />
      <JsonLd data={articleLd} />
      <JsonLd
        data={breadcrumb([
          { name: "Home", path: "/" },
          { name: "Research", path: "/reports" },
          { name: report.title, path: `/reports/${report.slug}` },
        ])}
      />

      <main className="section pb-24 pt-14">
        <Link
          href="/reports"
          className="inline-flex items-center gap-1 text-[14px] text-textSecondary transition-colors hover:text-white"
        >
          <ChevronLeft aria-hidden className="h-4 w-4" /> All research
        </Link>

        <div className="mt-8 grid gap-12 lg:grid-cols-[minmax(0,1fr)_340px]">
          {/* ── Article ───────────────────────────────────────────────── */}
          <article className="min-w-0">
            <p className="section-eyebrow">{report.category}</p>
            <h1 className="mt-3 text-[36px] font-extrabold leading-[1.1] tracking-tighter sm:text-[46px]">
              {report.title}
            </h1>
            {report.subtitle && (
              <p className="mt-4 text-[18px] leading-relaxed text-textSecondary">
                {report.subtitle}
              </p>
            )}

            <dl className="mt-6 flex flex-wrap gap-x-6 gap-y-2 border-y border-white/10 py-4 text-[13px]">
              <Meta label="Published" value={formatDate(report.publishedAt)} />
              {report.authors?.length ? (
                <Meta label="Authors" value={report.authors.join(", ")} />
              ) : null}
              {report.readingTime ? <Meta label="Reading time" value={report.readingTime} /> : null}
              {report.pageCount ? <Meta label="Pages" value={String(report.pageCount)} /> : null}
            </dl>

            {report.executiveSummary && (
              <section aria-labelledby="summary" className="mt-10">
                <h2 id="summary" className="text-[22px] font-bold tracking-tight">
                  Executive summary
                </h2>
                <p className="mt-4 border-l-2 border-neon/50 pl-5 text-[16px] leading-relaxed text-textSecondary">
                  {report.executiveSummary}
                </p>
              </section>
            )}

            {report.keyFindings?.length ? (
              <section aria-labelledby="findings" className="mt-14">
                <h2 id="findings" className="text-[22px] font-bold tracking-tight">
                  Key findings
                </h2>
                <ol className="mt-6">
                  {report.keyFindings.map((f, i) => (
                    <KeyFindingItem key={f.title} index={i} title={f.title} detail={f.detail} />
                  ))}
                </ol>
              </section>
            ) : null}

            {report.body?.length ? (
              <section className="mt-14 space-y-5">
                {report.body.map((block, i) => (
                  <Block key={i} block={block} />
                ))}
              </section>
            ) : null}

            {report.methodology && (
              <section aria-labelledby="methodology" className="mt-14">
                <h2 id="methodology" className="text-[22px] font-bold tracking-tight">
                  Methodology
                </h2>
                <p className="mt-4 text-[15px] leading-relaxed text-textSecondary">
                  {report.methodology}
                </p>
              </section>
            )}

            {report.sources?.length ? (
              <section aria-labelledby="sources" className="mt-14">
                <h2 id="sources" className="text-[22px] font-bold tracking-tight">
                  Sources
                </h2>
                <ol className="mt-4 space-y-2 text-[13px] text-textSecondary">
                  {report.sources.map((s, i) => (
                    <li key={s.label} className="flex gap-3">
                      <span className="font-mono text-textMuted">[{i + 1}]</span>
                      {s.url ? (
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-neon hover:underline"
                        >
                          {s.label}
                          <span className="sr-only"> (opens in a new tab)</span>
                        </a>
                      ) : (
                        <span>{s.label}</span>
                      )}
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}

            <RelatedContent
              heading="Related research"
              items={relatedReports.map((r) => ({
                slug: r.slug,
                title: r.title,
                href: `/reports/${r.slug}`,
                meta: formatDate(r.publishedAt),
              }))}
            />
            <RelatedContent
              heading="Related webinars"
              items={relatedWebinars.map((w) => ({
                slug: w.slug,
                title: w.title,
                href: `/webinars/${w.slug}`,
                meta: w.startsAt ? formatDate(w.startsAt) : undefined,
              }))}
            />
          </article>

          {/* ── Aside: cover + access ─────────────────────────────────── */}
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="overflow-hidden rounded-card border border-white/10 bg-white/[0.02]">
              <div className="relative aspect-[3/4] w-full bg-gradient-to-br from-white/[0.06] via-black to-black">
                {report.coverImage ? (
                  <Image
                    src={report.coverImage}
                    alt={`Cover of ${report.title}`}
                    fill
                    sizes="340px"
                    priority
                    className="object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 flex flex-col justify-end gap-3 p-6">
                    <FileText aria-hidden className="h-7 w-7 text-neon/60" />
                    <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-neon/70">
                      FurlPay Research
                    </span>
                    <span className="text-[20px] font-extrabold leading-tight tracking-tighter text-white/90">
                      {report.title}
                    </span>
                  </div>
                )}
              </div>

              <div className="p-5">
                {report.gated ? (
                  <>
                    <h2 className="text-[15px] font-bold tracking-tight">
                      {cta.kind === "download" ? "Download the report" : "Read the report"}
                    </h2>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-textSecondary">
                      Tell us where to send it.
                    </p>
                    <div className="mt-5">
                      <LeadCaptureForm kind="report" slug={report.slug} submitLabel={cta.label} />
                    </div>
                  </>
                ) : (
                  // Ungated: no form, no friction. A gate on content we are
                  // happy to give away is a tax on the reader for nothing.
                  <p className="text-[13px] leading-relaxed text-textSecondary">
                    This report is open to read on this page.
                  </p>
                )}
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-textMuted">
        {label}
      </dt>
      <dd className="mt-0.5 font-medium text-textPrimary">{value}</dd>
    </div>
  );
}

/** Structured block renderer — no HTML string ever reaches the DOM. */
function Block({ block }: { block: ReportBlock }) {
  switch (block.kind) {
    case "heading":
      return <h2 className="pt-6 text-[22px] font-bold tracking-tight">{block.text}</h2>;
    case "paragraph":
      return <p className="text-[16px] leading-relaxed text-textSecondary">{block.text}</p>;
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag className="space-y-2 pl-5 text-[16px] leading-relaxed text-textSecondary">
          {block.items.map((i) => (
            <li key={i} className={block.ordered ? "list-decimal" : "list-disc"}>
              {i}
            </li>
          ))}
        </Tag>
      );
    }
    case "quote":
      return (
        <blockquote className="border-l-2 border-neon/50 pl-5">
          <p className="text-[18px] leading-relaxed text-textPrimary">{block.text}</p>
          {block.attribution && (
            <footer className="mt-2 text-[13px] text-textMuted">— {block.attribution}</footer>
          )}
        </blockquote>
      );
    case "callout":
      return (
        <aside className="rounded-card border border-neon/20 bg-neon/[0.05] p-5">
          {block.title && (
            <p className="text-[13px] font-bold uppercase tracking-[0.12em] text-neon">
              {block.title}
            </p>
          )}
          <p className="mt-2 text-[15px] leading-relaxed text-textSecondary">{block.text}</p>
        </aside>
      );
    case "table":
      return (
        <figure>
          {/* Wide tables scroll inside their own container — the page body
              must never scroll horizontally. */}
          <div className="overflow-x-auto rounded-card border border-white/10">
            <table className="w-full min-w-[480px] text-left text-[14px]">
              <thead className="text-[11px] uppercase tracking-wider text-textMuted">
                <tr>
                  {block.columns.map((c) => (
                    <th key={c} scope="col" className="px-4 py-3 font-medium">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j} className="border-t border-white/[0.06] px-4 py-3 text-textSecondary">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {block.caption && (
            <figcaption className="mt-2 text-[12px] text-textMuted">{block.caption}</figcaption>
          )}
        </figure>
      );
  }
}
