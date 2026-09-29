import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, ChevronLeft, ExternalLink, MapPin, Tag } from "lucide-react";
import LandingChrome from "@/components/landing/LandingChrome";
import JsonLd from "@/components/JsonLd";
import EventCard from "@/components/events/EventCard";
import ScheduleCallButton from "@/components/marketing/ScheduleCallButton";
import { seoMetadata } from "@/lib/seo/meta";
import { breadcrumb, SITE } from "@/lib/seo/schema";
import {
  EVENTS,
  eventJsonLd,
  eventStatus,
  formatDateRange,
  formatLocation,
  getEvent,
  participationLabel,
  statusLabel,
  upcomingEvents,
} from "@/lib/events/events";

// ---------------------------------------------------------------------------
// /events/[slug] — one page per event.
//
// Every claim on this page comes from the event record: `participationLabel()`
// renders what FurlPay is actually doing, and nothing here upgrades it. An
// attendee ticket produces "FurlPay is attending" and no page copy, badge or
// JSON-LD says sponsor, partner, exhibitor or speaker. See the honesty rule at
// the top of @/lib/events/events.
// ---------------------------------------------------------------------------

export function generateStaticParams() {
  return EVENTS.map((e) => ({ slug: e.slug }));
}

// The event list is a compile-time constant, so any slug outside it is a real
// miss — not something to render on demand. Without this, an unknown slug is
// rendered at request time and the not-found page comes back with a 200, which
// is a soft 404: Google indexes the URL and treats the error page as content.
export const dynamicParams = false;

export async function generateMetadata(props: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await props.params;
  const event = getEvent(slug);
  if (!event) return {};

  return seoMetadata({
    title: `FurlPay at ${event.name}`,
    description: event.summary,
    path: `/events/${event.slug}`,
    image: `/api/og/event/${event.slug}`,
    ogTitle: `FurlPay at ${event.name}`,
  });
}

export default async function EventPage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const event = getEvent(slug);
  if (!event) notFound();

  const now = new Date();
  const status = eventStatus(event, now);
  const dates = formatDateRange(event.startDate, event.endDate);
  const others = upcomingEvents(now).filter((e) => e.slug !== event.slug);

  const details: { label: string; value: string }[] = [
    { label: "Event", value: event.name },
    { label: "Date", value: dates },
    { label: "Location", value: formatLocation(event) },
    { label: "Category", value: event.category },
    { label: "FurlPay", value: participationLabel(event, now) },
    // Sixth cell, so the three-column grid closes cleanly instead of leaving a
    // blank tile. Hostname only — the linked button above is the way out.
    ...(event.officialUrl
      ? [{ label: "Organiser", value: new URL(event.officialUrl).hostname.replace(/^www\./, "") }]
      : []),
  ];

  return (
    <div className="min-h-screen bg-oled text-textPrimary">
      <LandingChrome />
      <JsonLd data={eventJsonLd(event, SITE)} />
      <JsonLd
        data={breadcrumb([
          { name: "Home", path: "/" },
          { name: "Events", path: "/events" },
          { name: event.name, path: `/events/${event.slug}` },
        ])}
      />

      <main className="section pb-24 pt-14">
        <Link
          href="/events"
          className="inline-flex items-center gap-1 text-[14px] text-textSecondary transition-colors hover:text-white"
        >
          <ChevronLeft aria-hidden className="h-4 w-4" /> All events
        </Link>

        {/* ---- Hero ---------------------------------------------------- */}
        <header className="mt-6 overflow-hidden rounded-card border border-white/10 bg-gradient-to-br from-neon/[0.06] via-white/[0.02] to-transparent">
          <div className="grid items-stretch lg:grid-cols-[1fr_1.1fr]">
            {/* The official event mark, contained at its own aspect ratio —
                never cropped, never stretched to fill the panel. */}
            <div className="relative flex min-h-[200px] items-center justify-center border-b border-white/10 bg-black/40 p-8 sm:min-h-[260px] lg:border-b-0 lg:border-r">
              {event.image ? (
                <Image
                  src={event.image}
                  alt={event.imageAlt ?? event.name}
                  width={event.imageWidth ?? 833}
                  height={event.imageHeight ?? 400}
                  sizes="(min-width: 1024px) 520px, 90vw"
                  priority
                  className="h-auto w-full max-w-[400px] object-contain"
                />
              ) : (
                <p className="text-center text-[26px] font-extrabold leading-tight tracking-tighter text-white/90">
                  {event.name}
                </p>
              )}
              <span className="absolute left-4 top-4 rounded-pill border border-white/15 bg-black/60 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-textMuted backdrop-blur-sm">
                {statusLabel(status)}
              </span>
            </div>

            <div className="flex flex-col justify-center p-6 sm:p-9">
              <p className="section-eyebrow">{event.category}</p>
              <h1 className="mt-3 text-[34px] font-extrabold leading-[1.1] tracking-tighter sm:text-[42px]">
                {event.name}
              </h1>

              <dl className="mt-5 space-y-2.5 text-[15px] text-textSecondary">
                <div className="flex items-start gap-2.5">
                  <dt className="sr-only">Dates</dt>
                  <CalendarDays aria-hidden className="mt-[3px] h-[18px] w-[18px] shrink-0 text-neon" />
                  <dd>{dates}</dd>
                </div>
                <div className="flex items-start gap-2.5">
                  <dt className="sr-only">Location</dt>
                  <MapPin aria-hidden className="mt-[3px] h-[18px] w-[18px] shrink-0 text-neon" />
                  <dd>{formatLocation(event)}</dd>
                </div>
              </dl>

              <p className="mt-6 inline-flex w-fit items-center gap-2 rounded-pill border border-neon/30 bg-neon/10 px-3.5 py-1.5 text-[13px] font-semibold text-neon">
                <Tag aria-hidden className="h-3.5 w-3.5" />
                {participationLabel(event, now)}
              </p>

              <div className="mt-7 flex flex-wrap items-center gap-3">
                <a
                  href="#meet"
                  className="btn-green inline-flex items-center px-7 py-3 text-[15px]"
                >
                  Meet FurlPay
                </a>
                {event.officialUrl && (
                  <a
                    href={event.officialUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-outline inline-flex items-center gap-2 px-6 py-3 text-[15px]"
                  >
                    Official website
                    <ExternalLink aria-hidden className="h-4 w-4" />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* ---- Details ------------------------------------------------- */}
        <section aria-labelledby="details-heading" className="mt-16">
          <h2 id="details-heading" className="text-[22px] font-bold tracking-tight">
            Event details
          </h2>
          <dl className="mt-6 grid gap-px overflow-hidden rounded-card border border-white/10 bg-white/[0.06] sm:grid-cols-2 lg:grid-cols-3">
            {details.map((d) => (
              <div key={d.label} className="bg-oled p-5">
                <dt className="text-[11px] font-semibold uppercase tracking-[0.16em] text-textMuted">
                  {d.label}
                </dt>
                <dd className="mt-1.5 text-[15px] font-semibold text-textPrimary">{d.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* ---- Organiser figures --------------------------------------- */}
        {/* Other people's numbers, attributed to them. We do not restate them
            as our own and we do not round them up. */}
        {event.facts && event.facts.length > 0 && (
          <section aria-labelledby="scale-heading" className="mt-16">
            <h2 id="scale-heading" className="text-[22px] font-bold tracking-tight">
              The event, by the numbers
            </h2>
            <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              {event.facts.map((f) => (
                <div
                  key={f.label}
                  className="rounded-card border border-white/10 bg-white/[0.02] p-4 text-center"
                >
                  <dd className="text-[22px] font-extrabold tracking-tighter text-neon">
                    {f.value}
                  </dd>
                  <dt className="mt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-textMuted">
                    {f.label}
                  </dt>
                </div>
              ))}
            </dl>
            {event.factsSource && (
              <p className="mt-3 text-[12px] text-textMuted">{event.factsSource}</p>
            )}
          </section>
        )}

        {/* ---- Why we are going ---------------------------------------- */}
        {(event.body?.length || event.topics?.length) && (
          <section aria-labelledby="why-heading" className="mt-16 grid gap-10 lg:grid-cols-[1.1fr_1fr]">
            <div>
              <h2 id="why-heading" className="text-[22px] font-bold tracking-tight">
                {status === "past" ? "Why we went" : "Why we are going"}
              </h2>
              <div className="mt-5 space-y-4">
                {event.body?.map((para) => (
                  <p key={para.slice(0, 40)} className="text-[15px] leading-relaxed text-textSecondary">
                    {para}
                  </p>
                ))}
              </div>
            </div>

            {event.topics && event.topics.length > 0 && (
              <div className="rounded-card border border-white/10 bg-white/[0.02] p-6">
                <h3 className="text-[16px] font-bold tracking-tight">
                  {status === "past" ? "What we discussed" : "What we want to discuss"}
                </h3>
                <ul className="mt-4 space-y-2.5">
                  {event.topics.map((topic) => (
                    <li key={topic} className="flex items-start gap-2.5 text-[14px] text-textSecondary">
                      <span
                        aria-hidden
                        className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-neon"
                      />
                      {topic}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {/* ---- Meet ---------------------------------------------------- */}
        <section
          id="meet"
          aria-labelledby="meet-heading"
          className="mt-16 scroll-mt-24 rounded-card border border-neon/20 bg-gradient-to-br from-neon/[0.06] to-transparent p-8 sm:p-12"
        >
          <h2 id="meet-heading" className="text-[26px] font-extrabold tracking-tighter sm:text-[30px]">
            {status === "past"
              ? "Missed us there? Still happy to talk."
              : `Let’s meet in ${event.city}.`}
          </h2>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-textSecondary">
            We want to hear from founders, fintechs, financial institutions, stablecoin issuers,
            developers, investors and potential partners building the infrastructure for global
            payments. Book a slot with our founder, or send a note and we will come back within 24
            hours.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <ScheduleCallButton className="btn-green inline-flex items-center justify-center gap-2 px-7 py-3.5 text-[15px]" />
            <Link
              href="/talk-to-us"
              className="btn-outline inline-flex items-center justify-center px-7 py-3.5 text-[15px]"
            >
              Send a message instead
            </Link>
          </div>
        </section>

        {/* ---- Other events -------------------------------------------- */}
        {others.length > 0 && (
          <section aria-labelledby="others-heading" className="mt-20">
            <div className="border-b border-white/10 pb-4">
              <h2 id="others-heading" className="text-[22px] font-bold tracking-tight">
                Also on the calendar
              </h2>
            </div>
            <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {others.slice(0, 3).map((e) => (
                <EventCard key={e.slug} event={e} now={now} />
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
