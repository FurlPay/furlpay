import type { Metadata } from "next";
import Link from "next/link";
import { Calendar, MapPin, Users, Video, ExternalLink, ArrowRight, PlayCircle, Code } from "lucide-react";
import MarketingBar from "@/components/marketing/MarketingBar";
import JsonLd from "@/components/JsonLd";
import { breadcrumb } from "@/lib/seo/schema";

export const metadata: Metadata = {
  title: "Furlpay Events & Roadshow 2026",
  description:
    "Join Furlpay at leading global fintech conferences, developer hackathons, and developer-relation meetups. Learn how we are building the future of PayFi, stablecoin rails, and x402 agentic payments.",
  alternates: { canonical: "/events" },
};

const UPCOMING_EVENTS = [
  {
    title: "Arbitrum Open House & Founder House",
    type: "Hackathon",
    date: "July 10 - 12, 2026",
    time: "All Day",
    location: "Encode Hub, Shoreditch, London",
    description:
      "A 3-day intense builder event with $300,000 in prizes. FurlPay is showcasing our production-grade contracts and the x402 agentic payment protocol live in front of the Arbitrum Foundation and Offchain Labs core engineers.",
    link: "/events/london-founder-house",
    external: false,
    cta: "Join Founder House",
    featured: true,
  },
  {
    title: "RWA WEEK: Stablecoin Velocity in Travel",
    type: "Webinar",
    date: "July 8, 2026",
    time: "5:30 PM - 6:30 PM IST",
    location: "LinkedIn Live / Online",
    description:
      "A deep-dive panel discussion hosted by UVECON.VC featuring FurlPay's founder alongside industry leaders, exploring real-world asset (RWA) tokenization and stablecoin payment layers for the travel sector.",
    link: "https://linkedin.com",
    external: true,
    cta: "Register on LinkedIn",
    featured: false,
  },
  {
    title: "Stripe Tour & PayFi Integration Roadshow",
    type: "Meetup",
    date: "July 28, 2026",
    time: "6:00 PM - 9:00 PM JST",
    location: "Tokyo, Japan",
    description:
      "For Japanese hotel owners, travel tech developers, and ryokan operators. Explore how to implement USDC stablecoin checkouts beside existing Property Management Systems (PMS) with 0.5% fees and 1-second settlement.",
    link: "/talk-to-us",
    external: false,
    cta: "Request Invitation",
    featured: false,
  },
  {
    title: "Money20/20 Middle East (Riyadh)",
    type: "Conference",
    date: "September 14 - 16, 2026",
    time: "All Day",
    location: "Riyadh, Saudi Arabia",
    description:
      "The premier global fintech summit. FurlPay will exhibit in the Startup Pod, pitch for the $400K equity-free Moneysurge pitch competition, and showcase our SAMA sandbox travel payments application.",
    link: "/events/money2020-middle-east",
    external: false,
    cta: "Book Meeting in Riyadh",
    featured: true,
  },
];

const PAST_RESOURCES = [
  {
    title: "How to Build an AI Travel Booking Agent via x402 Protocol",
    type: "Developer Workshop",
    duration: "45 mins",
    speaker: "Ashutosh Kumar Singh, Founder",
    link: "https://youtube.com",
  },
  {
    title: "Stablecoins vs. Card Interchange: A Hotel GM's Practical Guide",
    type: "Webinar Recording",
    duration: "30 mins",
    speaker: "FurlPay Business Dev Team",
    link: "/blog",
  },
  {
    title: "Smart Contract Escrows & Oracle Check-Ins on Arbitrum",
    type: "Technical Deep-dive",
    duration: "15 mins read",
    speaker: "FurlPay Protocol Team",
    link: "/docs",
  },
];

const TRACKS = [
  {
    title: "PayFi & Stablecoins",
    body: "Understand the financial engineering behind USDC velocity, 0.5% transaction routing, and instant settlements without traditional clearing windows.",
  },
  {
    title: "Agentic Payments (x402)",
    body: "Explore the HTTP 402 standard enabling AI agents to negotiate rates, fund escrows, and execute automated hotel/flight bookings autonomously.",
  },
  {
    title: "Fintech Compliance",
    body: "Detailed reviews of operating legally under multi-jurisdiction frameworks including FinCEN (US), FCA (UK), VARA (UAE), JFSA (Japan), and SAMA (KSA).",
  },
];

export default function EventsPage() {
  return (
    <div className="min-h-screen bg-black text-textPrimary">
      <MarketingBar active="events" />
      <JsonLd
        data={breadcrumb([
          { name: "Home", path: "/" },
          { name: "Events", path: "/events" },
        ])}
      />

      <main className="mx-auto max-w-6xl px-6 pb-24 pt-14">
        {/* Hero Section */}
        <section className="text-center">
          <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-neon">Roadshow & Events</p>
          <h1 className="mx-auto max-w-3xl text-[42px] font-extrabold leading-[1.1] tracking-tighter sm:text-[56px]">
            Join us where the future of <span className="text-neon">PayFi</span> is built.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-[16px] leading-relaxed text-textSecondary">
            Meet the FurlPay team at developer summits, fintech conferences, and live code workshops globally. 
            Discover how we&apos;re building the on-chain payment layer for travel and agentic commerce.
          </p>
        </section>

        {/* Featured Events & Calendar */}
        <section className="mt-16">
          <div className="flex items-center justify-between border-b border-white/10 pb-4">
            <h2 className="text-[22px] font-bold tracking-tight">Upcoming Events</h2>
            <span className="text-[13px] text-textSecondary">Sync with Calendar (iCal)</span>
          </div>

          <div className="mt-8 grid gap-6">
            {UPCOMING_EVENTS.map((event) => (
              <div
                key={event.title}
                className={`relative rounded-3xl border p-6 sm:p-8 transition-colors ${
                  event.featured
                    ? "border-neon/30 bg-gradient-to-br from-neon/[0.04] to-transparent"
                    : "border-white/10 bg-white/[0.01] hover:border-white/20"
                }`}
              >
                {event.featured && (
                  <span className="absolute right-6 top-6 rounded-full bg-neon/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-neon">
                    Featured Event
                  </span>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-white/10 px-2 py-0.5 text-[11px] font-medium text-textSecondary">
                    {event.type}
                  </span>
                </div>
                <h3 className="mt-3 text-[22px] font-bold tracking-tight">{event.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-textSecondary max-w-3xl">
                  {event.description}
                </p>

                <div className="mt-6 flex flex-wrap gap-4 text-[13px] text-textMuted">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="h-4 w-4 text-neon" />
                    <span>{event.date}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {event.type === "Webinar" ? (
                      <Video className="h-4 w-4 text-neon" />
                    ) : (
                      <MapPin className="h-4 w-4 text-neon" />
                    )}
                    <span>{event.location}</span>
                  </div>
                </div>

                <div className="mt-8">
                  {event.external ? (
                    <a
                      href={event.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-full bg-white/10 px-6 py-2.5 text-[14px] font-semibold hover:bg-white/20"
                    >
                      {event.cta} <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ) : (
                    <Link
                      href={event.link}
                      className="inline-flex items-center gap-2 rounded-full bg-neon px-6 py-2.5 text-[14px] font-semibold text-black hover:opacity-90"
                    >
                      {event.cta} <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Tracks of Learning */}
        <section className="mt-24">
          <div className="text-center">
            <h2 className="text-[28px] font-bold tracking-tight">Main Tracks & Keynotes</h2>
            <p className="mt-2 text-[14px] text-textSecondary">What we are sharing and presenting at events in 2026.</p>
          </div>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {TRACKS.map((track) => (
              <div key={track.title} className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-neon/10 text-neon">
                  <Code className="h-5 w-5" />
                </div>
                <h3 className="text-[17px] font-bold">{track.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-textSecondary">{track.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* On-Demand Resources */}
        <section className="mt-24 rounded-3xl border border-white/10 bg-white/[0.01] p-6 sm:p-8">
          <h2 className="text-[22px] font-bold tracking-tight">On-Demand Developer Resources</h2>
          <p className="text-[14px] text-textSecondary">Can&apos;t make it to London or Riyadh? Tune in to recordings and deep dives.</p>
          
          <div className="mt-6 divide-y divide-white/10">
            {PAST_RESOURCES.map((resource) => (
              <div key={resource.title} className="flex flex-col gap-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <span className="text-[11px] uppercase tracking-wider text-neon">{resource.type}</span>
                  <h4 className="text-[15px] font-semibold mt-1">{resource.title}</h4>
                  <p className="text-[13px] text-textMuted mt-0.5">{resource.speaker} · {resource.duration}</p>
                </div>
                <div>
                  <a
                    href={resource.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[13px] font-medium text-neon hover:underline"
                  >
                    Watch/Read <PlayCircle className="h-4 w-4 ml-1" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Newsletter Signup */}
        <section className="mt-24 rounded-3xl border border-white/10 bg-gradient-to-br from-neon/[0.04] to-transparent p-8 text-center sm:p-12">
          <h2 className="text-[24px] font-extrabold tracking-tight">Never miss an update</h2>
          <p className="mx-auto mt-2 max-w-md text-[14px] text-textSecondary">
            Sign up for the FurlPay newsletter to receive notifications on upcoming developer events, roadshows, and product announcements.
          </p>
          <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
            <input
              type="email"
              placeholder="Enter your email"
              className="rounded-full border border-white/10 bg-white/[0.03] px-6 py-2.5 text-[14px] text-textPrimary placeholder:text-textSecondary focus:border-neon/50 focus:outline-none sm:w-64"
            />
            <button className="rounded-full bg-neon px-6 py-2.5 text-[14px] font-semibold text-black hover:opacity-90">
              Subscribe
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
