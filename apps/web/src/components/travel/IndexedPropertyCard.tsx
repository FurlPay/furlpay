"use client";

import Link from "next/link";
import { Star, MapPin, Navigation } from "lucide-react";
import { CITY_PHOTOS } from "@/lib/travel/data";
import type { IndexedProperty } from "@/lib/travel/propertySource";
import { directionsUrl } from "@/lib/travel/directions";
import { distanceMeters, formatDistanceAway, type Coordinate } from "@/lib/geo/coordinates";

// ---------------------------------------------------------------------------
// A property card for real indexed data.
//
// SEPARATE FROM PropertyCard ON PURPOSE. That one takes a `Stay`, whose
// `nightlyUsd` is a required number, and it computes `total = nightlyUsd *
// nights` straight into a checkout URL as `&amount=`. When the Stay came from
// generateStays(), that meant a price derived from a hash of the city name
// arrived at a payment screen. The component was not at fault — it was handed
// a type that promised a price, so it used one.
//
// This card takes a property whose rate may be null, and when it is null there
// is no price, no total, and no route to checkout. You cannot buy something we
// cannot price. That is enforced by the shape rather than by remembering.
// ---------------------------------------------------------------------------

export default function IndexedPropertyCard({
  property,
  nights,
  from,
}: {
  property: IndexedProperty;
  nights: number;
  /** The reader's position, when they shared it. Distance is shown only when
   *  BOTH ends are real — see distanceMeters, which returns null rather than
   *  zero for an unknown end. */
  from?: Coordinate | null;
}) {
  // Google photo names may not be stored, so the dataset carries a COUNT and
  // imagery is resolved per request elsewhere. The city shot is a legitimate
  // stand-in for a card thumbnail — it is a picture of the city, presented as
  // one, not a photograph claimed to be of this building.
  const photo = property.city ? CITY_PHOTOS[property.city] : undefined;

  const rate = property.rate;
  const total = rate ? rate.amount * nights : null;

  // Null when the coordinate is missing or nonsense, in which case no button
  // is rendered at all. A directions link that opens a map pointed at nowhere
  // is worse than none: it looks like it worked.
  const away = formatDistanceAway(
    distanceMeters(from ?? null, {
      latitude: property.coordinates.latitude,
      longitude: property.coordinates.longitude,
    })
  );

  const directions = directionsUrl({
    latitude: property.coordinates.latitude,
    longitude: property.coordinates.longitude,
    placeId: property.id,
    name: property.name,
  });

  return (
    <div className="group overflow-hidden rounded-card border border-white/10 bg-charcoal transition hover:border-white/20">
      <div className="relative h-40 overflow-hidden bg-gradient-to-br from-slate-700/40 to-slate-900/40">
        {photo && (
          <>
            <img
              src={photo}
              alt=""
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/45 to-transparent" />
          </>
        )}
        {property.typeDisplay && (
          <span className="absolute left-3 top-3 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur">
            {property.typeDisplay}
          </span>
        )}
      </div>

      <div className="p-4">
        <h3 className="truncate text-[15px] font-semibold text-white">{property.name}</h3>

        <p className="mt-1 flex items-center gap-1 truncate text-xs text-textSecondary">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          {[property.city, property.country].filter(Boolean).join(", ") || "Location unavailable"}
        </p>

        {/* Distance appears only when the reader shared a position AND this
            property has a real one. It is a claim about geography, so a guess
            would be worse here than a blank. */}
        {away && <p className="mt-1 text-xs font-medium text-neon">{away}</p>}

        {/* A rating is shown only when there is one. The review count comes
            with it, because a 4.9 over three reviews and a 4.4 over nine
            thousand are not the same claim. */}
        {property.rating !== null ? (
          <p className="mt-2 flex items-center gap-1 text-xs text-white">
            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
            <span className="font-semibold">{property.rating.toFixed(1)}</span>
            {property.reviewCount !== null && (
              <span className="text-textSecondary">({property.reviewCount.toLocaleString()})</span>
            )}
          </p>
        ) : (
          <p className="mt-2 text-xs text-textSecondary">No rating yet</p>
        )}

        <div className="mt-3 flex items-end justify-between gap-2">
          {rate && total !== null ? (
            <>
              <p className="text-lg font-bold text-white">
                {rate.currency} {rate.amount.toLocaleString()}
                <span className="text-xs font-normal text-textSecondary"> /night</span>
              </p>
              <Link
                href={
                  `/travel/checkout?kind=stay&ref=${encodeURIComponent(property.id)}` +
                  `&name=${encodeURIComponent(property.name)}&amount=${total}&nights=${nights}`
                }
                className="rounded-full bg-neon px-3 py-1.5 text-xs font-semibold text-black"
              >
                Book
              </Link>
            </>
          ) : (
            // No rate, so no price and no way to buy. Saying why is better than
            // an empty space that reads as a loading state that never resolves.
            <p className="text-xs text-textSecondary">
              Live pricing unavailable
              {property.website && (
                <>
                  {" · "}
                  <a
                    href={property.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-neon hover:underline"
                  >
                    Visit site
                  </a>
                </>
              )}
            </p>
          )}
        </div>

        {/* Directions sits below the price row so it is available whether or
            not the property can be booked — knowing where somewhere is does
            not depend on us being able to sell it. */}
        {directions && (
          <a
            href={directions}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-xs font-semibold text-white transition hover:border-white/25 hover:bg-white/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40"
            aria-label={`Directions to ${property.name} on Google Maps, opens in a new tab`}
          >
            <Navigation className="h-3.5 w-3.5" aria-hidden="true" />
            Directions
          </a>
        )}
      </div>
    </div>
  );
}
