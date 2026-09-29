import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Clock, PlayCircle } from "lucide-react";
import LandingChrome from "@/components/landing/LandingChrome";
import JsonLd from "@/components/JsonLd";
import LeadCaptureForm from "@/components/content/LeadCaptureForm";
import { RelatedContent, SpeakerCard } from "@/components/content/ContentShell";
import { seoMetadata } from "@/lib/seo/meta";
import { breadcrumb, SITE } from "@/lib/seo/schema";
import {
  formatDate,
  getPublishedWebinar,
  publishedWebinars,
  resolveRelatedReports,
  resolveRelatedWebinars,
  WEBINAR_BADGE,
  webinarCta,
} from "@/lib/content";

// /webinars/[slug]. Published only; a draft slug is a real 404 — see the
// report route for the reasoning.

export function generateStaticParams() {
  return publishedWebinars().map((w) => ({ slug: w.slug }));
}

export const dynamicParams = false;

export async function generateMetadata(props: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await props.params;
  const webinar = getPublishedWebinar(slug);
  if (!webinar) return {};
  return seoMetadata({
    title: webinar.title,
    description: webinar.description,
    path: `/webinars/${webinar.slug}`,
    image: webinar.thumbnail,
    ogTitle: webinar.title,
  });
}

export default async function WebinarPage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const webinar = getPublishedWebinar(slug);
  if (!webinar) notFound();

  const cta = webinarCta(webinar);
  const relatedReports = resolveRelatedReports(webinar.relatedReports);
  const relatedWebinars = resolveRelatedWebinars(webinar.relatedWebinars);

  // An upcoming session is an Event; a published recording is a VideoObject.
  // Only fields we hold — no invented duration, no invented upload date, and
  // no VideoObject at all when there is no video.
  const ld: Record<string, unknown> =
    webinar.sessionStatus === "on-demand" && webinar.videoUrl
      ? {
          "@context": "https://schema.org",
          "@type": "VideoObject",
          name: webinar.title,
          description: webinar.description,
          contentUrl: webinar.videoUrl,
          ...(webinar.thumbnail ? { thumbnailUrl: `${SITE}${webinar.thumbnail}` } : {}),
          ...(webinar.startsAt ? { uploadDate: webinar.startsAt } : {}),
          publisher: { "@type": "Organization", name: "FurlPay", url: SITE },
        }
      : {
          "@context": "https://schema.org",
          "@type": "Event",
          name: webinar.title,
          description: webinar.description,
          eventAttendanceMode: "https://schema.org/OnlineEventAttendanceMode",
          eventStatus: "https://schema.org/EventScheduled",
          location: {
            "@type": "VirtualLocation",
            url: `${SITE}/webinars/${webinar.slug}`,
          },
          organizer: { "@type": "Organization", name: "FurlPay", url: SITE },
          ...(webinar.startsAt ? { startDate: webinar.startsAt } : {}),
          ...(webinar.thumbnail ? { image: `${SITE}${webinar.thumbnail}` } : {}),
          ...(webinar.speakers.length
            ? {
                performer: webinar.speakers.map((s) => ({ "@type": "Person", name: s.name })),
              }
            : {}),
        };

  return (
    <div className="min-h-screen bg-oled text-textPrimary">
      <LandingChrome />
      <JsonLd data={ld} />
      <JsonLd
        data={breadcrumb([
          { name: "Home", path: "/" },
          { name: "Webinars", path: "/webinars" },
          { name: webinar.title, path: `/webinars/${webinar.slug}` },
        ])}
      />

      <main className="section pb-24 pt-14">
        <Link
          href="/webinars"
          className="inline-flex items-center gap-1 text-[14px] text-textSecondary transition-colors hover:text-white"
        >
          <ChevronLeft aria-hidden className="h-4 w-4" /> All webinars
        </Link>

        <div className="mt-8 grid gap-12 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0">
            {/* ── Hero media ─────────────────────────────────────────── */}
            <div className="relative aspect-[16/9] w-full overflow-hidden rounded-card border border-white/10 bg-gradient-to-br from-white/[0.06] via-black to-black">
              {webinar.thumbnail ? (
                <Image
                  src={webinar.thumbnail}
                  alt=""
                  fill
                  sizes="(min-width: 1024px) 760px, 92vw"
                  priority
                  className="object-cover"
                />
              ) : null}
              {/* A player is rendered only when a recording actually exists.
                  Everything else gets a state that says what is true. */}
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/40 text-center">
                <PlayCircle aria-hidden className="h-10 w-10 text-neon/70" />
                <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-neon/80">
                  {WEBINAR_BADGE[webinar.sessionStatus]}
                </p>
                {cta.kind === "none" && (
                  <p className="max-w-xs text-[13px] text-textSecondary">
                    The recording is being prepared and will appear here.
                  </p>
                )}
                {cta.kind === "watch" && webinar.videoUrl && (
                  <a
                    href={webinar.videoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-green px-6 py-2.5 text-[14px]"
                  >
                    {cta.label}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                )}
              </div>
            </div>

            <p className="section-eyebrow mt-8">{webinar.category}</p>
            <h1 className="mt-3 text-[34px] font-extrabold leading-[1.1] tracking-tighter sm:text-[44px]">
              {webinar.title}
            </h1>

            <dl className="mt-5 flex flex-wrap gap-x-6 gap-y-2 border-y border-white/10 py-4 text-[13px]">
              {webinar.startsAt && (
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-textMuted">
                    Date
                  </dt>
                  <dd className="mt-0.5 font-medium">{formatDate(webinar.startsAt)}</dd>
                </div>
              )}
              {webinar.duration && (
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-textMuted">
                    Duration
                  </dt>
                  <dd className="mt-0.5 inline-flex items-center gap-1.5 font-medium">
                    <Clock aria-hidden className="h-3.5 w-3.5 text-neon" />
                    {webinar.duration}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-textMuted">
                  Status
                </dt>
                <dd className="mt-0.5 font-medium">{WEBINAR_BADGE[webinar.sessionStatus]}</dd>
              </div>
            </dl>

            <p className="mt-6 text-[16px] leading-relaxed text-textSecondary">
              {webinar.description}
            </p>

            {webinar.topics?.length ? (
              <section aria-labelledby="topics" className="mt-12">
                <h2 id="topics" className="text-[22px] font-bold tracking-tight">
                  What we cover
                </h2>
                <ul className="mt-4 space-y-2.5">
                  {webinar.topics.map((t) => (
                    <li key={t} className="flex items-start gap-2.5 text-[15px] text-textSecondary">
                      <span aria-hidden className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-neon" />
                      {t}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {webinar.agenda?.length ? (
              <section aria-labelledby="agenda" className="mt-12">
                <h2 id="agenda" className="text-[22px] font-bold tracking-tight">
                  Agenda
                </h2>
                <ol className="mt-4 divide-y divide-white/10 border-y border-white/10">
                  {webinar.agenda.map((a) => (
                    <li key={a.item} className="flex gap-5 py-3.5 text-[15px]">
                      {a.time && (
                        <span className="w-16 shrink-0 font-mono text-[13px] tabular-nums text-neon">
                          {a.time}
                        </span>
                      )}
                      <span className="text-textSecondary">{a.item}</span>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}

            {webinar.speakers.length > 0 && (
              <section aria-labelledby="speakers" className="mt-12">
                <h2 id="speakers" className="text-[22px] font-bold tracking-tight">
                  {webinar.speakers.length === 1 ? "Speaker" : "Speakers"}
                </h2>
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  {webinar.speakers.map((s) => (
                    <SpeakerCard key={s.id} speaker={s} />
                  ))}
                </div>
              </section>
            )}

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
          </div>

          {/* ── Aside: register ──────────────────────────────────────── */}
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-card border border-white/10 bg-white/[0.02] p-5">
              {cta.kind === "register" ? (
                <>
                  <h2 className="text-[15px] font-bold tracking-tight">Register</h2>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-textSecondary">
                    We will email you the joining details.
                  </p>
                  <div className="mt-5">
                    <LeadCaptureForm kind="webinar" slug={webinar.slug} submitLabel={cta.label} />
                  </div>
                </>
              ) : (
                <>
                  <h2 className="text-[15px] font-bold tracking-tight">On demand</h2>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-textSecondary">
                    {webinar.videoUrl
                      ? "This session has been recorded and is free to watch."
                      : "This session has finished. The recording will be published here."}
                  </p>
                  {webinar.videoUrl && (
                    <a
                      href={webinar.videoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-green mt-5 block px-6 py-2.5 text-center text-[14px]"
                    >
                      {cta.label}
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  )}
                </>
              )}
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
