import Image from "next/image";
import Link from "next/link";
import { ArrowRight, CalendarDays, ExternalLink, MapPin } from "lucide-react";
import LandingChrome from "@/components/landing/LandingChrome";
import JsonLd from "@/components/JsonLd";
import EventCard from "@/components/events/EventCard";
import { seoMetadata } from "@/lib/seo/meta";
import { breadcrumb } from "@/lib/seo/schema";
import {
  eventStatus,
  featuredEvent,
  formatDateRange,
  formatLocation,
  participationLabel,
  pastEvents,
  statusLabel,
  upcomingEvents,
} from "@/lib/events/events";

// ---------------------------------------------------------------------------
// /events — the events hub.
//
// Everything on this page is derived from EVENTS in @/lib/events/events. The
// previous version of this file hard-coded four events inline, which is how it
// ended up serving two 404 links (/events/london-founder-house and
// /events/money2020-middle-east had no route), two CTAs pointing at bare
// https://linkedin.com and https://youtube.com, and a list of finished events
// under a heading that said "Upcoming".
//
// Sections render only when they have something in them, so the page is never
// a set of empty headings. There is deliberately no client-side category
// filter: with a handful of events the Upcoming/Past split is the whole
// navigation problem, and a filter would ship JS to solve nothing. Add one when
// the grid outgrows a single screen.
// ---------------------------------------------------------------------------

export const metadata = seoMetadata({
  title: "Events",
  description:
    "Where to find FurlPay in person. Conferences, summits and developer events we are attending, speaking at, or hosting — including TOKEN2049 Singapore on 7-8 October 2026.",
  path: "/events",
  ogTitle: "FurlPay Events",
});

const TOPICS = [
  {
    title: "Stablecoin payments",
    body: "Settlement in USDC and other stablecoins, what it costs against card interchange, and where the rails still break.",
  },
  {
    title: "Agentic payments",
    body: "The x402 standard for machine-to-machine payment: how an agent negotiates, funds an escrow, and settles without a human in the loop.",
  },
  {
    title: "Cross-border infrastructure",
    body: "Payouts, virtual card issuing, and operating across multiple regulatory regimes without rebuilding the stack per market.",
  },
];

export default function EventsPage() {
  // One clock for the whole render, so a card and its section heading cannot
  // disagree about what "today" is.
  const now = new Date();
  const featured = featuredEvent(now);
  const upcoming = upcomingEvents(now).filter((e) => e.slug !== featured?.slug);
  const past = pastEvents(now);

  return (
    <div className="min-h-screen bg-oled text-textPrimary">
      <LandingChrome />
      <JsonLd
        data={breadcrumb([
          { name: "Home", path: "/" },
          { name: "Events", path: "/events" },
        ])}
      />

      <main className="section pb-24 pt-14">
        {/* ---- Hero ---------------------------------------------------- */}
        <header className="max-w-3xl">
          <p className="section-eyebrow">Events</p>
          <h1 className="mt-3 text-[40px] font-extrabold leading-[1.08] tracking-tighter sm:text-[52px]">
            Meet FurlPay around the world.
          </h1>
          <p className="mt-5 max-w-2xl text-[16px] leading-relaxed text-textSecondary">
            We show up where payment infrastructure actually gets decided — crypto and fintech
            summits, banking and stablecoin conferences, and developer events. If we are going to be
            in your city, come and find us.
          </p>
        </header>

        {/* ---- Featured ------------------------------------------------ */}
        {featured && (
          <section aria-labelledby="featured-heading" className="mt-14">
            <h2 id="featured-heading" className="sr-only">
              Featured event
            </h2>

            <article className="group relative overflow-hidden rounded-card border border-neon/25 bg-gradient-to-br from-neon/[0.07] via-white/[0.02] to-transparent">
              <div className="grid items-stretch gap-0 lg:grid-cols-[1.05fr_1fr]">
                {/* Art */}
                <div className="relative flex min-h-[220px] items-center justify-center border-b border-white/10 bg-black/40 p-8 sm:min-h-[280px] lg:border-b-0 lg:border-r">
                  {featured.image ? (
                    <Image
                      src={featured.image}
                      alt={featured.imageAlt ?? featured.name}
                      width={featured.imageWidth ?? 833}
                      height={featured.imageHeight ?? 400}
                      sizes="(min-width: 1024px) 520px, 90vw"
                      priority
                      className="h-auto w-full max-w-[420px] object-contain"
                    />
                  ) : (
                    <p className="text-center text-[26px] font-extrabold leading-tight tracking-tighter text-white/90">
                      {featured.name}
                    </p>
                  )}
                  <span className="absolute left-4 top-4 rounded-pill border border-neon/40 bg-neon/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-neon">
                    {statusLabel(eventStatus(featured, now))}
                  </span>
                </div>

                {/* Copy */}
                <div className="flex flex-col justify-center p-6 sm:p-9">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-textMuted">
                    {featured.category}
                  </p>
                  <h3 className="mt-2 text-[27px] font-extrabold leading-tight tracking-tighter sm:text-[32px]">
                    <Link href={`/events/${featured.slug}`} className="card-hit">
                      {featured.name}
                    </Link>
                  </h3>

                  <dl className="mt-4 space-y-2 text-[14px] text-textSecondary">
                    <div className="flex items-start gap-2">
                      <dt className="sr-only">Dates</dt>
                      <CalendarDays aria-hidden className="mt-[3px] h-4 w-4 shrink-0 text-neon" />
                      <dd>{formatDateRange(featured.startDate, featured.endDate)}</dd>
                    </div>
                    <div className="flex items-start gap-2">
                      <dt className="sr-only">Location</dt>
                      <MapPin aria-hidden className="mt-[3px] h-4 w-4 shrink-0 text-neon" />
                      <dd>{formatLocation(featured)}</dd>
                    </div>
                  </dl>

                  <p className="mt-4 text-[14px] leading-relaxed text-textSecondary">
                    {featured.summary}
                  </p>

                  <div className="mt-7 flex flex-wrap items-center gap-4">
                    <span className="inline-flex items-center gap-1.5 rounded-pill bg-neon px-5 py-2.5 text-[14px] font-semibold text-black shadow-glow-sm">
                      View event
                      <ArrowRight
                        aria-hidden
                        className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
                      />
                    </span>
                    <span className="text-[12px] font-semibold uppercase tracking-[0.12em] text-neon/80">
                      {participationLabel(featured, now)}
                    </span>
                  </div>
                </div>
              </div>
            </article>
          </section>
        )}

        {/* ---- Upcoming ------------------------------------------------ */}
        {upcoming.length > 0 && (
          <section aria-labelledby="upcoming-heading" className="mt-20">
            <div className="flex items-baseline justify-between border-b border-white/10 pb-4">
              <h2 id="upcoming-heading" className="text-[22px] font-bold tracking-tight">
                Upcoming events
              </h2>
              <span className="text-[13px] text-textMuted">
                {upcoming.length} {upcoming.length === 1 ? "event" : "events"}
              </span>
            </div>
            <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {upcoming.map((event) => (
                <EventCard key={event.slug} event={event} now={now} />
              ))}
            </div>
          </section>
        )}

        {/* ---- What we talk about -------------------------------------- */}
        <section aria-labelledby="topics-heading" className="mt-20">
          <h2 id="topics-heading" className="text-[22px] font-bold tracking-tight">
            What we come to talk about
          </h2>
          <div className="mt-8 grid gap-5 md:grid-cols-3">
            {TOPICS.map((topic) => (
              <div
                key={topic.title}
                className="rounded-card border border-white/10 bg-white/[0.02] p-6"
              >
                <h3 className="text-[16px] font-bold tracking-tight">{topic.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-textSecondary">{topic.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ---- Past ---------------------------------------------------- */}
        {past.length > 0 && (
          <section aria-labelledby="past-heading" className="mt-20">
            <div className="flex items-baseline justify-between border-b border-white/10 pb-4">
              <h2 id="past-heading" className="text-[22px] font-bold tracking-tight">
                Past events
              </h2>
              <span className="text-[13px] text-textMuted">
                {past.length} {past.length === 1 ? "event" : "events"}
              </span>
            </div>
            <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {past.map((event) => (
                <EventCard key={event.slug} event={event} now={now} />
              ))}
            </div>
          </section>
        )}

        {/* ---- Newsletter --------------------------------------------- */}
        {/* Links to /newsletter, which has the working signup. The previous
            version of this page rendered an email input and a Subscribe button
            with no handler attached to either. */}
        <section className="mt-20 rounded-card border border-white/10 bg-gradient-to-br from-neon/[0.05] to-transparent p-8 text-center sm:p-12">
          <h2 className="text-[24px] font-extrabold tracking-tight">Know where we will be next</h2>
          <p className="mx-auto mt-2 max-w-md text-[14px] leading-relaxed text-textSecondary">
            We announce events on the FurlPay newsletter before they go on this page.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <Link href="/newsletter" className="btn-green px-7 py-3 text-[15px]">
              Subscribe to updates
            </Link>
            <Link href="/talk-to-us" className="btn-outline px-7 py-3 text-[15px]">
              Talk to us
            </Link>
          </div>
        </section>

        {/* ---- On-demand ---------------------------------------------- */}
        <section aria-labelledby="ondemand-heading" className="mt-20">
          <h2 id="ondemand-heading" className="text-[22px] font-bold tracking-tight">
            Can it wait until you are at a desk?
          </h2>
          <p className="mt-2 text-[14px] text-textSecondary">
            The same material we take to events, written down.
          </p>
          <div className="mt-6 divide-y divide-white/10 border-y border-white/10">
            <Link
              href="/blog"
              className="flex items-center justify-between gap-4 py-4 transition-colors hover:text-neon"
            >
              <span>
                <span className="text-[11px] uppercase tracking-[0.14em] text-neon">Writing</span>
                <span className="mt-1 block text-[15px] font-semibold">
                  Stablecoins against card interchange, and the rest of the blog
                </span>
              </span>
              <ArrowRight aria-hidden className="h-4 w-4 shrink-0" />
            </Link>
            <Link
              href="/docs"
              className="flex items-center justify-between gap-4 py-4 transition-colors hover:text-neon"
            >
              <span>
                <span className="text-[11px] uppercase tracking-[0.14em] text-neon">
                  Documentation
                </span>
                <span className="mt-1 block text-[15px] font-semibold">
                  Smart contract escrows, the API, and the x402 integration guide
                </span>
              </span>
              <ArrowRight aria-hidden className="h-4 w-4 shrink-0" />
            </Link>
            <a
              href="https://github.com/FurlPay"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-4 py-4 transition-colors hover:text-neon"
            >
              <span>
                <span className="text-[11px] uppercase tracking-[0.14em] text-neon">Source</span>
                <span className="mt-1 block text-[15px] font-semibold">
                  Our SDKs and open-source packages on GitHub
                  <span className="sr-only"> (opens in a new tab)</span>
                </span>
              </span>
              <ExternalLink aria-hidden className="h-4 w-4 shrink-0" />
            </a>
          </div>
        </section>
      </main>
    </div>
  );
}
