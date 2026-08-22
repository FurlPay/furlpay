"use client";

import Image from "next/image";
import type { Trip } from "@/lib/trips/demoTrip";

/**
 * Trip hero: emerald title block over the airline photography. The photo's own
 * sky continues the header colour, so the two read as one surface rather than a
 * banner stacked on an image.
 */
export default function TripCard({ trip, onOpen }: { trip: Trip; onOpen?: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${trip.title}, ${trip.routeLabel}`}
      className="mx-[14px] block w-[calc(100%-28px)] overflow-hidden rounded-[26px] bg-[linear-gradient(180deg,#1D7150_0%,#1E7A58_100%)] text-left transition-transform duration-[var(--dur-fast)] ease-[var(--ease-out)] active:scale-[0.99]"
    >
      <span className="block px-[21px] pb-[11px] pt-[14px]">
        <span className="block text-[25px] font-semibold leading-none tracking-[-0.02em] text-white">
          {trip.title}
        </span>
        <span className="mt-[11px] block text-[15px] font-normal leading-none text-white/90">
          {trip.routeLabel}
        </span>
      </span>

      <span className="relative block h-[116px] w-full">
        <Image
          src={trip.heroImage.src}
          alt={trip.heroImage.alt}
          fill
          priority
          sizes="(max-width: 1023px) 92vw, 560px"
          className="object-cover object-center"
        />
      </span>
    </button>
  );
}
