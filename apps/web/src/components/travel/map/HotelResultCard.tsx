"use client";

import { memo, useState } from "react";
import type { MapPoint } from "@/app/api/travel/hotels/map/route";
import { thumbnailSource } from "@/lib/hotels/markerThumbnails";
import SaveButton from "./SaveButton";

// One row of the hotel map's results list.
//
// EVERY FIELD IS CONDITIONAL ON REAL DATA. The points come from curated
// records, OpenStreetMap and Google Places, none of which carries a nightly
// rate, a cancellation policy or a meal plan, so the card has no price, no
// "Free cancellation" and no "Breakfast" — it says what it knows (name, class,
// guest rating, place, type) and hands off to the detail panel. Star class and
// Google's guest rating are DIFFERENT measurements and are labelled as such.

const TYPE_LABEL: Record<string, string> = {
  hotel: "Hotel",
  resort: "Resort",
  guest_house: "Guest house",
  hostel: "Hostel",
  apartment: "Apartment",
  motel: "Motel",
  villa: "Villa",
};

function Stars({ n }: { n: number }) {
  const full = Math.round(n);
  return (
    <span className="text-[12px] tracking-[1px] text-[#F5B83D]" aria-hidden>
      {"★".repeat(full)}
    </span>
  );
}

function Photo({ point }: { point: MapPoint }) {
  const src = thumbnailSource(point);
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    // A neutral tile, not a stock photo: an image the hotel is not in would be
    // a claim about the hotel.
    return (
      <span className="flex h-full w-full items-center justify-center bg-[#0D1314] text-[22px] font-semibold text-white/25" aria-hidden>
        {point.name.slice(0, 1)}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      width={186}
      height={104}
      onError={() => setFailed(true)}
      className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.02]"
    />
  );
}

export interface HotelResultCardProps {
  point: MapPoint;
  selected: boolean;
  hovered: boolean;
  saved: boolean;
  /** km from the map centre, already computed by the list. */
  distanceKm?: number;
  onHover: (id: string | null) => void;
  onSelect: (point: MapPoint) => void;
}

function HotelResultCard({ point: p, selected, hovered, saved, distanceKm, onHover, onSelect }: HotelResultCardProps) {
  const type = TYPE_LABEL[p.hotelType?.toLowerCase()] ?? (p.hotelType ? p.hotelType[0].toUpperCase() + p.hotelType.slice(1) : undefined);
  const place = [p.city, p.country].filter(Boolean).join(", ");
  return (
    <li
      data-hotel-id={p.id}
      className={`group relative flex gap-3.5 rounded-[14px] border bg-[#090D0E] p-2.5 transition duration-200 ${
        selected
          ? "border-[#00E6A7] shadow-[0_0_0_1px_rgba(0,230,167,0.35)]"
          : hovered
            ? "border-white/[0.16] shadow-[0_8px_24px_rgba(0,0,0,0.20)]"
            : "border-white/[0.08]"
      }`}
      onMouseEnter={() => onHover(p.id)}
      onMouseLeave={() => onHover(null)}
    >
      {/* The whole card selects; the button covers it so keyboard users get
          one focus stop per hotel, with the save control layered above. */}
      <button
        type="button"
        onClick={() => onSelect(p)}
        onFocus={() => onHover(p.id)}
        onBlur={() => onHover(null)}
        aria-pressed={selected}
        aria-label={`${p.name}${place ? `, ${place}` : ""}. Show on map and view details`}
        className="absolute inset-0 z-0 rounded-[14px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00E6A7]"
      />
      <div className="relative h-[100px] w-[120px] shrink-0 overflow-hidden rounded-[10px] sm:w-[168px] xl:w-[186px]">
        <Photo point={p} />
        {p.precision === "approximate" && (
          <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/65 px-1.5 py-0.5 text-[9.5px] font-medium text-white/80 backdrop-blur">
            Approx. position
          </span>
        )}
      </div>

      <div className="pointer-events-none relative z-[1] flex min-w-0 flex-1 flex-col py-0.5 pr-9">
        <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug text-[#F5F7F6]">{p.name}</h3>
        {(p.stars !== undefined || p.rating !== undefined) && (
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-[#A4AAA9]">
            {p.stars !== undefined && (
              <span className="flex items-center gap-1" title={`${p.stars}-star class`}>
                <Stars n={p.stars} />
                <span className="sr-only">{p.stars}-star class</span>
              </span>
            )}
            {p.rating !== undefined && (
              <span title="Google guest rating">
                <span className="font-semibold text-[#F5F7F6]">{p.rating.toFixed(1)}</span>
                {p.ratingCount !== undefined && <span> ({p.ratingCount.toLocaleString("en-US")})</span>}
                <span className="sr-only"> Google guest rating</span>
              </span>
            )}
          </p>
        )}
        {(place || distanceKm !== undefined) && (
          <p className="mt-0.5 truncate text-[12px] text-[#A4AAA9]">
            {place}
            {distanceKm !== undefined && (
              <span className="text-[#6E7675]"> · {distanceKm < 1 ? `${Math.round(distanceKm * 1000)} m` : `${distanceKm.toFixed(1)} km`} from map centre</span>
            )}
          </p>
        )}
        <p className="mt-auto flex flex-wrap items-center gap-1.5 pt-1 text-[11px]">
          {type && <span className="rounded-full border border-white/[0.08] px-2 py-0.5 text-[#A4AAA9]">{type}</span>}
          {p.brand && <span className="truncate text-[#6E7675]">{p.brand}</span>}
        </p>
      </div>

      <div className="absolute right-2.5 top-2.5 z-[2]">
        <SaveButton
          size="sm"
          saved={saved}
          place={{ id: p.id, name: p.name, latitude: p.latitude, longitude: p.longitude, city: p.city, country: p.country }}
        />
      </div>
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-2.5 right-2.5 z-[1] flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.12] text-white/70 transition group-hover:border-[#00E6A7] group-hover:text-[#00E6A7]"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </span>
    </li>
  );
}

// Memoised: hovering one card re-renders only the two whose state changed,
// not the whole list.
export default memo(HotelResultCard);
