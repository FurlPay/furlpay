"use client";

import Link from "next/link";
import { Star, MapPin } from "lucide-react";
import { CITY_PHOTOS } from "@/lib/travel/data";
import type { IndexedProperty } from "@/lib/travel/propertySource";

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
}: {
  property: IndexedProperty;
  nights: number;
}) {
  // Google photo names may not be stored, so the dataset carries a COUNT and
  // imagery is resolved per request elsewhere. The city shot is a legitimate
  // stand-in for a card thumbnail — it is a picture of the city, presented as
  // one, not a photograph claimed to be of this building.
  const photo = property.city ? CITY_PHOTOS[property.city] : undefined;

  const rate = property.rate;
  const total = rate ? rate.amount * nights : null;

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
      </div>
    </div>
  );
}
