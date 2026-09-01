import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ChevronLeft,
  CalendarDays,
  BedDouble,
  Stamp,
  Coins,
  Star,
  Lightbulb,
  ArrowRight,
  Thermometer,
} from "lucide-react";
import { summariseNamedDestination } from "@/lib/hotels/destinationSummary";
import { CITY_COORDS } from "@/lib/travel/data";
import { Pill } from "@/components/ui";
import PropertyCard from "@/components/travel/PropertyCard";
import FlightCard from "@/components/travel/FlightCard";
import ActivityCard from "@/components/travel/ActivityCard";
import DestinationTile from "@/components/travel/DestinationTile";
import {
  DESTINATION_CATEGORIES,
  DESTINATIONS,
  destinationsByCategory,
  getDestination,
  generateStays,
  generateFlights,
  generateActivities,
} from "@/lib/travel/data";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function generateStaticParams() {
  return [
    ...DESTINATION_CATEGORIES.map((c) => ({ slug: c.slug })),
    ...DESTINATIONS.map((d) => ({ slug: d.slug })),
  ];
}

export async function generateMetadata(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const cat = DESTINATION_CATEGORIES.find((c) => c.slug === params.slug);
  if (cat) return { title: `${cat.title} — FurlPay Travels`, description: cat.blurb };
  const d = getDestination(params.slug);
  if (!d) return {};
  return { title: `${d.name}, ${d.country} — FurlPay Travels`, description: d.tagline };
}

// /travel/destinations/[slug] serves both category listings (beach, mountains,
// cities, eco-retreats, historical) and individual destination pages (tokyo…).
export default async function DestinationOrCategoryPage(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const category = DESTINATION_CATEGORIES.find((c) => c.slug === params.slug);
  if (category) {
    const list = destinationsByCategory(category.slug);
    return (
      <div className="mx-auto max-w-6xl px-5 pb-24 pt-8">
        <Link href="/travel/destinations" className="mb-3 inline-flex items-center gap-1 text-sm text-textSecondary hover:text-white">
          <ChevronLeft className="h-4 w-4" /> Destinations
        </Link>
        <div className="mb-3 flex items-center gap-2">
          <Pill tone="gain">{category.tag}</Pill>
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white">{category.title}</h1>
        <p className="mt-2 text-sm text-textSecondary">{category.blurb} {category.examples.join(" · ")}.</p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((d) => (
            <DestinationTile key={d.slug} destination={d} />
          ))}
        </div>
        {list.length === 0 && (
          <p className="mt-12 text-sm text-textSecondary">Curated picks landing soon — search stays directly instead.</p>
        )}
      </div>
    );
  }

  const d = getDestination(params.slug);
  if (!d) notFound();

  const topStays = generateStays(d.name, { count: 8, minStars: 4 }).slice(0, 3);
  const topFlights = generateFlights("LHR", d.name.slice(0, 3), "").slice(0, 3);
  const topActivities = generateActivities(d.name).slice(0, 3);
  const maxTemp = Math.max(...d.weather.map(Math.abs), 1);

  // Counted from the indexed dataset, not authored. Null when we hold no
  // coordinate for this destination, which is a different statement from
  // holding no properties there and must not render as a zero.
  const indexed = summariseNamedDestination(CITY_COORDS[d.name]);

  // `avgHotelUsd` and `avgFlightUsd` are NOT shown, and that is deliberate.
  // They are editorial numbers on a hand-authored record — nobody measured
  // them — but rendered in a stats row beside the visa rule and the currency
  // they read as observations. That is the same failure as an inferred star
  // rating drawn identically to a counted one. They stay in the type for the
  // copy that references them in prose; they do not get a statistic's frame.
  //
  // What replaces them is a real count, or nothing at all.
  const stats = [
    { Icon: CalendarDays, label: "Best time to visit", value: d.bestTime },
    {
      Icon: BedDouble,
      label: "Properties indexed",
      value: indexed && indexed.total > 0 ? indexed.total.toLocaleString() : "Not yet indexed",
    },
    {
      Icon: Star,
      label: "Average rating",
      // The denominator matters: a 4.6 over eleven rated properties is not the
      // destination's rating. Below a floor we say nothing rather than imply
      // the whole city was measured.
      value:
        indexed?.rating && indexed.rating.over >= 25
          ? `${indexed.rating.mean.toFixed(1)} over ${indexed.rating.over.toLocaleString()}`
          : "Not enough ratings",
    },
    { Icon: Stamp, label: "Visa", value: d.visa },
    { Icon: Coins, label: "Currency", value: d.currency },
  ];

  return (
    <div className="mx-auto max-w-6xl px-5 pb-24 pt-6">
      <Link href="/travel/destinations" className="mb-3 inline-flex items-center gap-1 text-sm text-textSecondary hover:text-white">
        <ChevronLeft className="h-4 w-4" /> Destinations
      </Link>

      {/* Hero */}
      <div className="relative overflow-hidden rounded-card border border-white/10">
        <img src={d.photo} alt={`${d.name}, ${d.country}`} className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/50 to-black/20" />
        <div className="relative p-8 sm:p-12">
          <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">{d.name}</h1>
          <p className="mt-1 text-sm font-semibold text-white/85">{d.country}</p>
          <p className="mt-3 max-w-lg text-sm text-white/75">{d.tagline}</p>
          <Link
            href={`/travel/stays?city=${encodeURIComponent(d.name)}`}
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-white px-5 py-2.5 text-sm font-bold text-black transition hover:bg-white/90"
          >
            Book {d.name} with USDC <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {/* Quick stats */}
      <div className="mt-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label} className="rounded-card border border-white/10 bg-charcoal p-4">
            <s.Icon className="h-4 w-4 text-neon" />
            <p className="mt-2 text-[11px] text-textSecondary">{s.label}</p>
            <p className="mt-0.5 text-sm font-semibold text-white">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Overview + tips */}
      <div className="mt-10 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <section>
          <h2 className="mb-3 text-xl font-bold text-white">Travel guide</h2>
          <p className="text-sm leading-relaxed text-textSecondary">{d.overview}</p>
        </section>
        <section className="rounded-card border border-white/10 bg-charcoal p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
            <Lightbulb className="h-4 w-4 text-amber-400" /> Local tips
          </h2>
          <ul className="space-y-2">
            {d.tips.map((t) => (
              <li key={t} className="flex gap-2 text-xs text-textSecondary">
                <span className="text-neon">•</span> {t}
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* Weather */}
      <section className="mt-10">
        <h2 className="mb-4 flex items-center gap-2 text-xl font-bold text-white">
          <Thermometer className="h-5 w-5 text-sky-400" /> Weather by month
          <span className="text-xs font-normal text-textSecondary">avg. high °C</span>
        </h2>
        <div className="rounded-card border border-white/10 bg-charcoal p-5">
          <div className="grid grid-cols-12 items-end gap-1.5 sm:gap-2" style={{ height: 120 }}>
            {d.weather.map((t, i) => (
              <div key={MONTHS[i]} className="flex h-full flex-col items-center justify-end gap-1">
                <span className="text-[10px] font-semibold text-white">{t}°</span>
                <div
                  className={`w-full rounded-t ${t >= 28 ? "bg-amber-400/70" : t >= 15 ? "bg-neon/70" : "bg-sky-400/70"}`}
                  style={{ height: `${Math.max(6, (Math.abs(t) / maxTemp) * 70)}%` }}
                />
                <span className="text-[9px] text-textSecondary">{MONTHS[i]}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Top stays */}
      <section className="mt-10">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">Top stays in {d.name}</h2>
          <Link href={`/travel/stays?city=${encodeURIComponent(d.name)}`} className="text-sm text-neon hover:underline">
            View all →
          </Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {topStays.map((s) => (
            <PropertyCard key={s.id} stay={s} nights={3} />
          ))}
        </div>
      </section>

      {/* Top flights */}
      <section className="mt-10">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">Cheapest flights</h2>
          <Link href="/travel/flights" className="text-sm text-neon hover:underline">
            Search flights →
          </Link>
        </div>
        <div className="space-y-3">
          {topFlights.map((f) => (
            <FlightCard key={f.id} flight={f} />
          ))}
        </div>
      </section>

      {/* Top activities */}
      <section className="mt-10">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">Best-rated experiences</h2>
          <Link href={`/travel/activities?city=${encodeURIComponent(d.name)}`} className="text-sm text-neon hover:underline">
            View all →
          </Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {topActivities.map((a) => (
            <ActivityCard key={a.id} activity={a} />
          ))}
        </div>
      </section>

      {/* Crypto CTA */}
      <section className="mt-12 rounded-card border border-white/10 bg-gradient-to-br from-sky-500/[0.12] via-charcoal to-teal-500/[0.10] p-6 text-center sm:p-8">
        <h2 className="text-2xl font-bold text-white">Book your trip to {d.name} with USDC</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-textSecondary">
          Pay with USDC, SOL, BTC or 100+ tokens. 15-minute rate lock at checkout, 2% cashback auto-deposited to your
          wallet.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Link
            href={`/travel/stays?city=${encodeURIComponent(d.name)}`}
            className="rounded-lg bg-neon px-5 py-2.5 text-sm font-bold text-black transition hover:bg-neonDeep"
          >
            Find stays
          </Link>
          <Link
            href="/travel/crypto-travel"
            className="rounded-lg border border-white/15 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/[0.06]"
          >
            How crypto travel works
          </Link>
        </div>
      </section>
    </div>
  );
}
