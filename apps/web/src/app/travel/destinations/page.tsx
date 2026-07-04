import Link from "next/link";
import { ArrowRight, Compass } from "lucide-react";
import { Pill } from "@/components/ui";
import DestinationTile from "@/components/travel/DestinationTile";
import { DESTINATION_CATEGORIES, DESTINATIONS } from "@/lib/travel/data";

export const metadata = {
  title: "Destinations — FurlPay Travels",
  description:
    "Discover beaches, mountains, cities, eco-retreats and historical wonders. Book with USDC, SOL or 100+ cryptos and earn 2% cashback.",
};

// Destination discovery: category rails + the full curated destination grid.
// Category tiles deep-link to /travel/destinations/<category> (handled by [slug]).
export default function DestinationsPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 pb-24 pt-8">
      <div className="mb-3 flex items-center gap-2">
        <Pill tone="accent">Destination discovery</Pill>
      </div>
      <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-white">
        <Compass className="h-7 w-7 text-neon" /> Where to next?
      </h1>
      <p className="mt-2 max-w-xl text-sm text-textSecondary">
        {DESTINATIONS.length} curated destinations across {DESTINATION_CATEGORIES.length} vibes — every one bookable
        with USDC, SOL, BTC or 100+ tokens, with 2% cashback.
      </p>

      {/* Category tiles */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {DESTINATION_CATEGORIES.map((c) => (
          <Link
            key={c.slug}
            href={`/travel/destinations/${c.slug}`}
            className="group relative min-h-[130px] overflow-hidden rounded-card border border-white/10 transition hover:border-white/30 hover:shadow-glow-sm"
          >
            <img
              src={c.photo}
              alt={c.title}
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-black/15" />
            <div className="relative flex h-full min-h-[130px] flex-col justify-end p-4">
              <h2 className="text-sm font-bold text-white">{c.title}</h2>
              <p className="mt-0.5 text-[11px] text-white/75">{c.blurb}</p>
              <ArrowRight className="mt-2 h-4 w-4 text-white transition group-hover:translate-x-1" />
            </div>
          </Link>
        ))}
      </div>

      {/* All destinations */}
      <h2 className="mt-12 mb-4 text-xl font-bold text-white">All destinations</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {DESTINATIONS.map((d) => (
          <DestinationTile key={d.slug} destination={d} />
        ))}
      </div>
    </div>
  );
}
