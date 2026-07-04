import Link from "next/link";
import { Play, ArrowRight, Clapperboard } from "lucide-react";
import { Pill } from "@/components/ui";
import { VLOGS } from "@/lib/travel/discover";

export const metadata = {
  title: "Travel Vlogs",
  description:
    "Curated travel videos with a bookable trip next to every one — video drives bookings 3x more than photos, so we made ours bookable.",
};

// Bookable vlogs — the 2026 conversion pattern (Expedia research: video sways
// bookings ~3x vs stills). Every video card pairs "watch" with "book".
export default function VlogsPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 pb-24 pt-8">
      <div className="mb-3 flex items-center gap-2">
        <Pill tone="accent">Watch, then book</Pill>
      </div>
      <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-white">
        <Clapperboard className="h-7 w-7 text-neon" /> Travel vlogs
      </h1>
      <p className="mt-2 max-w-xl text-sm text-textSecondary">
        Hand-picked videos for every destination we cover — and unlike a feed, every vlog here has a “Book this
        trip” button next to it. Inspiration to itinerary in one click.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {VLOGS.map((v) => (
          <div
            key={v.id}
            className="group overflow-hidden rounded-card border border-white/10 bg-charcoal transition hover:border-white/25 hover:shadow-glow-sm"
          >
            <a
              href={v.watchUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Watch: ${v.title}`}
              className="relative block h-40 overflow-hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-neon"
            >
              <img
                src={v.photo}
                alt={v.city}
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-black/10" />
              <span className="absolute left-1/2 top-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-black shadow-lg transition group-hover:scale-110">
                <Play className="ml-0.5 h-5 w-5 fill-current" />
              </span>
              <span className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white">
                {v.durationMin} min
              </span>
              <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white">
                {v.topic}
              </span>
            </a>
            <div className="p-4">
              <h2 className="text-sm font-bold leading-snug text-white">{v.title}</h2>
              <p className="mt-1 text-[11px] text-textSecondary">{v.city} · {v.creator}</p>
              <div className="mt-3 flex items-center gap-2">
                <a
                  href={v.watchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-h-[36px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/15 px-3 text-xs font-semibold text-white transition hover:bg-white/[0.06]"
                >
                  <Play className="h-3.5 w-3.5" /> Watch
                </a>
                <Link
                  href={`/travel/destinations/${v.destinationSlug}`}
                  className="flex min-h-[36px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-neon px-3 text-xs font-bold text-black transition hover:bg-neonDeep"
                >
                  Book this trip <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
