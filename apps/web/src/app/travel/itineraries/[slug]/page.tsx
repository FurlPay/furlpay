import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, CalendarDays, Wallet, ArrowRight, BedDouble, Ticket, Plane } from "lucide-react";
import { Pill } from "@/components/ui";
import { ITINERARIES, getItinerary } from "@/lib/travel/discover";
import { CASHBACK_RATE } from "@/lib/travel/data";

export function generateStaticParams() {
  return ITINERARIES.map((i) => ({ slug: i.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }) {
  const it = getItinerary(params.slug);
  if (!it) return {};
  return { title: it.title, description: it.summary };
}

export default function ItineraryPage({ params }: { params: { slug: string } }) {
  const it = getItinerary(params.slug);
  if (!it) notFound();

  const cashback = Math.round(it.budgetUsd * CASHBACK_RATE);
  const stayUrl = `/travel/stays?city=${encodeURIComponent(it.city)}`;
  const actUrl = `/travel/activities?city=${encodeURIComponent(it.city)}`;

  return (
    <div className="mx-auto max-w-4xl px-5 pb-24 pt-6">
      <Link href="/travel/itineraries" className="mb-4 inline-flex items-center gap-1 text-sm text-textSecondary hover:text-white">
        <ChevronLeft className="h-4 w-4" /> Itineraries
      </Link>

      {/* Hero */}
      <div className="relative overflow-hidden rounded-card border border-white/10">
        <img src={it.photo} alt={it.city} className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/55 to-black/25" />
        <div className="relative p-7 sm:p-10">
          <div className="flex flex-wrap gap-2">
            <Pill tone="accent">{it.days} days</Pill>
            <Pill tone="gain">{it.style}</Pill>
          </div>
          <h1 className="mt-4 text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl">{it.title}</h1>
          <p className="mt-2 max-w-lg text-sm text-white/75">{it.summary}</p>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-white/85">
            <span className="flex items-center gap-1.5"><Wallet className="h-4 w-4" /> ~${it.budgetUsd} pp ex-flights</span>
            <span className="flex items-center gap-1.5 font-semibold text-emerald-300">+{cashback} USDC cashback</span>
          </div>
        </div>
      </div>

      {/* Book the trip */}
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Link href={stayUrl} className="flex min-h-[52px] items-center justify-center gap-2 rounded-card border border-white/10 bg-charcoal text-sm font-semibold text-white transition hover:border-neon/50">
          <BedDouble className="h-4 w-4 text-neon" /> Book stays in {it.city}
        </Link>
        <Link href="/travel/flights" className="flex min-h-[52px] items-center justify-center gap-2 rounded-card border border-white/10 bg-charcoal text-sm font-semibold text-white transition hover:border-neon/50">
          <Plane className="h-4 w-4 text-neon" /> Find flights
        </Link>
        <Link href={actUrl} className="flex min-h-[52px] items-center justify-center gap-2 rounded-card border border-white/10 bg-charcoal text-sm font-semibold text-white transition hover:border-neon/50">
          <Ticket className="h-4 w-4 text-neon" /> Book activities
        </Link>
      </div>

      {/* Day-by-day */}
      <section className="mt-10">
        <h2 className="mb-5 flex items-center gap-2 text-xl font-bold text-white">
          <CalendarDays className="h-5 w-5 text-sky-400" /> Day by day
        </h2>
        <ol className="relative space-y-6 border-l border-white/10 pl-6">
          {it.plan.map((d) => (
            <li key={d.day} className="relative">
              <span className="absolute -left-[31px] flex h-6 w-6 items-center justify-center rounded-full bg-neon text-[11px] font-bold text-black">
                {d.day}
              </span>
              <h3 className="text-sm font-bold text-white">Day {d.day} — {d.title}</h3>
              <ul className="mt-2 space-y-1.5">
                {d.items.map((item) => (
                  <li key={item} className="flex gap-2 text-sm text-textSecondary">
                    <span className="text-neon">•</span> {item}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </section>

      {/* CTA */}
      <div className="mt-10 rounded-card border border-white/10 bg-gradient-to-br from-sky-500/[0.12] via-charcoal to-teal-500/[0.10] p-6 text-center">
        <h2 className="text-xl font-bold text-white">Book this whole trip with USDC</h2>
        <p className="mx-auto mt-1 max-w-md text-xs text-textSecondary">
          ~${it.budgetUsd} per person · 15-minute rate lock at checkout · +{cashback} USDC cashback auto-deposited.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Link href={stayUrl} className="inline-flex items-center gap-1 rounded-lg bg-neon px-5 py-2.5 text-sm font-bold text-black transition hover:bg-neonDeep">
            Start with the stay <ArrowRight className="h-4 w-4" />
          </Link>
          <Link href={`/travel/destinations/${it.destinationSlug}`} className="rounded-lg border border-white/15 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/[0.06]">
            {it.city} destination guide
          </Link>
        </div>
      </div>
    </div>
  );
}
