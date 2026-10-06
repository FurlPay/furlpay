"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarDays, ChevronLeft, ChevronRight, MapPin } from "lucide-react";

export interface HeroTrip {
  slug: string;
  title: string;
  city: string;
  days: number;
  budgetUsd: number;
  stops: number;
  photo: string;
}

/** The floating "popular trip" card over the hero photo. It cycles the real
 *  bookable itineraries (lib/travel/discover.ts); the price is the
 *  itinerary's own per-person budget, excluding flights, and says so. */
export default function HeroTripCard({ trips }: { trips: HeroTrip[] }) {
  const [i, setI] = useState(0);
  if (trips.length === 0) return null;
  const t = trips[i];
  const go = (d: number) => setI((n) => (n + d + trips.length) % trips.length);

  return (
    <div className="w-full max-w-[300px]">
      <article
        aria-roledescription="slide"
        aria-label={`${i + 1} of ${trips.length}: ${t.title}`}
        className="group relative overflow-hidden rounded-2xl border border-white/15 bg-[rgba(5,8,9,0.75)] shadow-[0_24px_60px_-20px_rgba(0,0,0,0.8)] backdrop-blur-[18px]"
      >
        <div className="relative h-[150px] overflow-hidden">
          <img key={t.photo} src={t.photo} alt={`${t.city}`} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
          <div className="absolute inset-0 bg-gradient-to-t from-[rgba(5,8,9,0.95)] via-transparent to-transparent" />
          <span className="absolute left-3 top-3 rounded-full bg-[#FF6B8B]/90 px-2.5 py-0.5 text-[10px] font-semibold text-white">Popular</span>
        </div>
        <div className="relative -mt-8 px-4 pb-4">
          <p className="pr-10 text-[15px] font-semibold leading-snug text-white">{t.title}</p>
          <p className="mt-1 text-[13px] text-white/80">
            from <span className="text-[17px] font-bold text-white">${t.budgetUsd.toLocaleString("en-US")}</span>
            <span className="text-[11px] text-white/50"> pp · excl. flights</span>
          </p>
          <p className="mt-2 flex items-center gap-3 text-[11px] text-white/55">
            <span className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" aria-hidden /> {t.days} days</span>
            <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" aria-hidden /> {t.stops} stops planned</span>
          </p>
          <Link
            href={`/travel/itineraries/${t.slug}`}
            aria-label={`Open itinerary: ${t.title}`}
            className="absolute right-4 top-1 flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white transition hover:border-neon hover:text-neon focus-visible:outline focus-visible:outline-2 focus-visible:outline-neon"
          >
            <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
          </Link>
        </div>
      </article>
      {trips.length > 1 && (
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={() => go(-1)} aria-label="Previous trip" className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-black/50 text-white backdrop-blur transition hover:border-white/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-neon">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => go(1)} aria-label="Next trip" className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-black/50 text-white backdrop-blur transition hover:border-white/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-neon">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
