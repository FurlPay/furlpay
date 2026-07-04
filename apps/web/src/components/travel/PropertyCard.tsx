"use client";

import Link from "next/link";
import { Star, MapPin } from "lucide-react";
import { Pill } from "@/components/ui";
import { CITY_PHOTOS, type Stay } from "@/lib/travel/data";

export default function PropertyCard({ stay, nights }: { stay: Stay; nights: number }) {
  const total = stay.nightlyUsd * nights;
  const href = `/travel/checkout?ref=${stay.id}&name=${encodeURIComponent(stay.name)}&amount=${total}&nights=${nights}`;
  // Real property photo (Duffel Stays) beats the generic city shot.
  const photo = stay.photo ?? CITY_PHOTOS[stay.city];
  return (
    <div className="group overflow-hidden rounded-card border border-white/10 bg-charcoal transition hover:border-white/20">
      <div className={`relative h-40 overflow-hidden bg-gradient-to-br ${stay.image}`}>
        {photo && (
          <>
            <img
              src={photo}
              alt={stay.name}
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/45 to-transparent" />
          </>
        )}
        <div className="absolute left-3 top-3 flex gap-1.5">
          <Pill tone="gain">2% back in USDC</Pill>
          {stay.eco && <Pill tone="accent">Eco</Pill>}
        </div>
        <span className="absolute right-3 top-3 rounded-full bg-black/50 px-2 py-1 text-[11px] font-semibold text-white">
          {stay.type}
        </span>
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-white">{stay.name}</h3>
            <p className="mt-0.5 flex items-center gap-1 text-xs text-textSecondary">
              <MapPin className="h-3 w-3" /> {stay.city}
            </p>
          </div>
          <span className="flex items-center gap-0.5 rounded-md bg-white/[0.06] px-1.5 py-0.5 text-xs font-semibold text-white">
            <Star className="h-3 w-3 fill-neon text-neon" /> {stay.rating}
          </span>
        </div>

        <div className="mt-2 flex items-center gap-1 text-amber-400">
          {Array.from({ length: stay.stars }).map((_, i) => (
            <Star key={i} className="h-3 w-3 fill-amber-400" />
          ))}
          <span className="ml-1 text-[11px] text-textSecondary">({stay.reviews.toLocaleString()} reviews)</span>
        </div>

        <div className="mt-3 flex items-end justify-between">
          <div>
            <p className="text-lg font-bold text-white">
              ${stay.nightlyUsd}
              <span className="text-xs font-normal text-textSecondary"> /night</span>
            </p>
            <p className="text-[11px] text-textSecondary">
              ${total.toLocaleString()} total · {nights} {nights === 1 ? "night" : "nights"}
            </p>
          </div>
          <Link
            href={href}
            className="rounded-lg bg-neon px-3.5 py-2 text-xs font-bold text-black transition hover:bg-neonDeep"
          >
            Book Now
          </Link>
        </div>
        {stay.roomsLeft <= 3 && (
          <p className="mt-2 text-[11px] font-semibold text-loss">
            Only {stay.roomsLeft} {stay.roomsLeft === 1 ? "room" : "rooms"} left
          </p>
        )}
      </div>
    </div>
  );
}
