import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Pill } from "@/components/ui";
import { DESTINATION_CATEGORIES, type Destination } from "@/lib/travel/data";

// Curated destination card used on /travel/destinations and category pages.
export default function DestinationTile({ destination: d }: { destination: Destination }) {
  const cat = DESTINATION_CATEGORIES.find((c) => c.slug === d.category);
  return (
    <Link
      href={`/travel/destinations/${d.slug}`}
      className="group relative min-h-[220px] overflow-hidden rounded-card border border-white/10 transition hover:border-white/30 hover:shadow-glow-sm"
    >
      <img
        src={d.photo}
        alt={`${d.name}, ${d.country}`}
        loading="lazy"
        className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/10" />
      <div className="relative flex h-full min-h-[220px] flex-col p-5">
        <div className="flex justify-end">{cat && <Pill tone="gain">{cat.tag}</Pill>}</div>
        <div className="mt-auto">
          <h3 className="text-lg font-bold text-white">{d.name}</h3>
          <p className="text-xs text-white/75">{d.country}</p>
          <p className="mt-1.5 line-clamp-2 text-[11px] text-white/65">{d.tagline}</p>
          <div className="mt-2.5 flex items-center justify-between text-[11px] text-white/75">
            <span>Hotels from ${d.avgHotelUsd}/nt</span>
            <ArrowRight className="h-4 w-4 text-white transition group-hover:translate-x-1" />
          </div>
        </div>
      </div>
    </Link>
  );
}
