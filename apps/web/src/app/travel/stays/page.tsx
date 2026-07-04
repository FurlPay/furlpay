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

  useEffect(() => {
    setLoading(true);
    sendJSON<{ results: Stay[]; nights: number }>("/api/travel/search", { type: "stays", city, checkIn, checkOut })
      .then((d) => {
        setStays(d.results);
        setNights(d.nights);
      })
      .catch(() => setStays([]))
      .finally(() => setLoading(false));
  }, [city, checkIn, checkOut]);

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
