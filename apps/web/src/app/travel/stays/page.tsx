"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, SlidersHorizontal } from "lucide-react";
import { sendJSON } from "@/lib/api";
import { Spinner } from "@/components/ui";
import PropertyCard from "@/components/travel/PropertyCard";
import SkeletonCards from "@/components/travel/SkeletonCards";
import type { Stay } from "@/lib/travel/data";

type SortId = "price" | "-price" | "rating" | "stars";

function StaysResults() {
  const params = useSearchParams();
  const city = params.get("city") ?? "";
  const checkIn = params.get("checkIn") ?? "";
  const checkOut = params.get("checkOut") ?? "";

  const [loading, setLoading] = useState(true);
  const [stays, setStays] = useState<Stay[]>([]);
  const [nights, setNights] = useState(3);

  const [maxPrice, setMaxPrice] = useState(500);
  const [minStars, setMinStars] = useState(0);
  const [freeCancel, setFreeCancel] = useState(false);
  const [ecoOnly, setEcoOnly] = useState(false);
  const [sort, setSort] = useState<SortId>("price");
  /** Why the provider returned nothing, when it did. */
  const [unavailable, setUnavailable] = useState<string | null>(null);
  /** Whether we hold indexed properties for this city, so the empty state can
   *  offer a real route instead of a dead end. */
  const [hasIndexed, setHasIndexed] = useState(false);
  const [failed, setFailed] = useState(false);
  /** Bumped by Retry. `city` comes from the URL and cannot be re-set. */
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setLoading(true);
    setFailed(false);
    sendJSON<{
      results: Stay[];
      nights: number;
      unavailableReason?: string;
      indexedAlternatives?: boolean;
    }>("/api/travel/search", { type: "stays", city, checkIn, checkOut })
      .then((d) => {
        setStays(d.results);
        setNights(d.nights);
        setUnavailable(d.unavailableReason ?? null);
        setHasIndexed(Boolean(d.indexedAlternatives));
      })
      // A network failure is not "no results". Conflating them tells someone
      // their search came back empty when in fact it never ran.
      .catch(() => {
        setStays([]);
        setFailed(true);
      })
      .finally(() => setLoading(false));
  }, [city, checkIn, checkOut, reloadKey]);

  const filtered = useMemo(() => {
    let out = stays.filter(
      (s) =>
        s.nightlyUsd <= maxPrice &&
        s.stars >= minStars &&
        (!freeCancel || s.freeCancellation) &&
        (!ecoOnly || s.eco),
    );
    out = [...out].sort((a, b) => {
      if (sort === "price") return a.nightlyUsd - b.nightlyUsd;
      if (sort === "-price") return b.nightlyUsd - a.nightlyUsd;
      if (sort === "rating") return b.rating - a.rating;
      return b.stars - a.stars;
    });
    return out;
  }, [stays, maxPrice, minStars, freeCancel, ecoOnly, sort]);

  return (
    <div className="mx-auto max-w-6xl px-5 pb-24 pt-6">
      <Link href="/travel" className="mb-3 inline-flex items-center gap-1 text-sm text-textSecondary hover:text-white">
        <ChevronLeft className="h-4 w-4" /> Travel
      </Link>
      <h1 className="text-2xl font-bold text-white">
        Stays in {city || "Anywhere"}
        <span className="ml-2 text-sm font-normal text-textSecondary">
          {loading ? "" : `${filtered.length} results · ${nights} nights`}
        </span>
      </h1>

      <div className="mt-5 grid gap-6 lg:grid-cols-[240px_1fr]">
        {/* Filters */}
        <aside className="h-fit rounded-card border border-white/10 bg-charcoal p-4">
          <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
            <SlidersHorizontal className="h-4 w-4" /> Filters
          </p>

          <label className="block text-xs text-textSecondary">Max price / night: ${maxPrice}</label>
          <input
            type="range"
            min={50}
            max={500}
            step={10}
            value={maxPrice}
            onChange={(e) => setMaxPrice(Number(e.target.value))}
            className="mt-1 w-full accent-neon"
          />

          <p className="mt-4 text-xs text-textSecondary">Minimum stars</p>
          <div className="mt-1 flex gap-1">
            {[0, 3, 4, 5].map((s) => (
              <button
                key={s}
                onClick={() => setMinStars(s)}
                className={`rounded-md px-2 py-1 text-xs font-semibold ${
                  minStars === s ? "bg-white text-black" : "bg-white/[0.06] text-textSecondary"
                }`}
              >
                {s === 0 ? "Any" : `${s}★+`}
              </button>
            ))}
          </div>

          <label className="mt-4 flex items-center gap-2 text-xs text-white">
            <input type="checkbox" checked={freeCancel} onChange={(e) => setFreeCancel(e.target.checked)} className="accent-neon" />
            Free cancellation
          </label>
          <label className="mt-2 flex items-center gap-2 text-xs text-white">
            <input type="checkbox" checked={ecoOnly} onChange={(e) => setEcoOnly(e.target.checked)} className="accent-neon" />
            Eco-certified
          </label>

          <p className="mt-4 text-xs text-textSecondary">Sort by</p>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortId)}
            className="mt-1 w-full rounded-lg bg-white/[0.06] px-2 py-2 text-xs text-white focus:outline-none [&>option]:text-black"
          >
            <option value="price">Price: low to high</option>
            <option value="-price">Price: high to low</option>
            <option value="rating">Rating</option>
            <option value="stars">Stars</option>
          </select>
        </aside>

        {/* Results */}
        <div>
          {loading ? (
            <SkeletonCards count={6} imageH="h-40" />
          ) : failed ? (
            <div className="py-16 text-center">
              <p className="text-sm text-white">Search couldn&apos;t run.</p>
              <p className="mt-1 text-sm text-textSecondary">
                Something went wrong reaching the search service. Nothing was booked.
              </p>
              <button
                type="button"
                onClick={() => setReloadKey((k) => k + 1)}
                className="mt-4 rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/15"
              >
                Try again
              </button>
            </div>
          ) : unavailable ? (
            // The distinction that matters: the old copy said "No stays match
            // your filters", which blames the reader for a gap on our side and
            // sends them adjusting filters that were never the cause.
            <div className="py-16 text-center">
              <p className="text-sm text-white">No bookable rates for {city}.</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-textSecondary">
                {unavailable === "no_live_provider"
                  ? "Live rates need a booking provider, which isn't connected yet — so there is nothing to quote."
                  : "Our provider returned no availability for these dates."}
              </p>
              {hasIndexed && (
                <Link
                  href={`/hotels/map`}
                  className="mt-4 inline-block rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/15"
                >
                  Browse indexed properties in {city}
                </Link>
              )}
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-16 text-center text-sm text-textSecondary">No stays match your filters.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((s) => (
                <PropertyCard key={s.id} stay={s} nights={nights} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function StaysPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <StaysResults />
    </Suspense>
  );
}
