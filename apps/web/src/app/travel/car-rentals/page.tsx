"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { ChevronLeft, SlidersHorizontal, MapPin, CalendarDays, Search } from "lucide-react";
import { sendJSON } from "@/lib/api";
import { Spinner } from "@/components/ui";
import CarRentalCard from "@/components/travel/CarRentalCard";
import SkeletonCards from "@/components/travel/SkeletonCards";
import type { CarRental, CarCategory } from "@/lib/travel/data";

const CATEGORIES: Array<CarCategory | "Any"> = ["Any", "Economy", "Compact", "SUV", "Luxury", "Van"];
type SortId = "price" | "-price" | "rating";

function CarsResults() {
  const params = useSearchParams();
  const router = useRouter();
  const city = params.get("city") ?? "";
  const pickUp = params.get("pickUp") ?? "";
  const dropOff = params.get("dropOff") ?? "";

  const [searchCity, setSearchCity] = useState(city);
  const [searchPickUp, setSearchPickUp] = useState(pickUp);
  const [searchDropOff, setSearchDropOff] = useState(dropOff);

  const [loading, setLoading] = useState(true);
  const [cars, setCars] = useState<CarRental[]>([]);
  const [days, setDays] = useState(3);

  const [category, setCategory] = useState<CarCategory | "Any">("Any");
  const [maxDaily, setMaxDaily] = useState(200);
  const [autoOnly, setAutoOnly] = useState(false);
  const [freeCancel, setFreeCancel] = useState(false);
  const [sort, setSort] = useState<SortId>("price");

  useEffect(() => {
    setLoading(true);
    sendJSON<{ results: CarRental[]; days: number }>("/api/travel/search", { type: "cars", city, pickUp, dropOff })
      .then((d) => {
        setCars(d.results);
        setDays(d.days);
      })
      .catch(() => setCars([]))
      .finally(() => setLoading(false));
  }, [city, pickUp, dropOff]);

  const filtered = useMemo(() => {
    let out = cars.filter(
      (c) =>
        c.dailyUsd <= maxDaily &&
        (category === "Any" || c.category === category) &&
        (!autoOnly || c.transmission === "Automatic") &&
        (!freeCancel || c.freeCancellation),
    );
    out = [...out].sort((a, b) => {
      if (sort === "price") return a.dailyUsd - b.dailyUsd;
      if (sort === "-price") return b.dailyUsd - a.dailyUsd;
      return b.supplierRating - a.supplierRating;
    });
    return out;
  }, [cars, maxDaily, category, autoOnly, freeCancel, sort]);

  function search() {
    const q = new URLSearchParams({ city: searchCity, pickUp: searchPickUp, dropOff: searchDropOff });
    router.push(`/travel/car-rentals?${q.toString()}`);
  }

  return (
    <div className="mx-auto max-w-6xl px-5 pb-24 pt-6">
      <Link href="/travel" className="mb-3 inline-flex items-center gap-1 text-sm text-textSecondary hover:text-white">
        <ChevronLeft className="h-4 w-4" /> Travel
      </Link>
      <h1 className="text-2xl font-bold text-white">
        Car rentals {city && `in ${city}`}
        <span className="ml-2 text-sm font-normal text-textSecondary">
          {loading ? "" : `${filtered.length} cars · ${days} days`}
        </span>
      </h1>

      {/* Search bar */}
      <div className="mt-4 grid gap-2.5 rounded-card border border-white/10 bg-gradient-to-br from-sky-500/[0.10] via-charcoal to-teal-500/[0.08] p-4 sm:grid-cols-4">
        <label className="flex items-center gap-2 rounded-xl bg-white/[0.06] px-3 py-3">
          <MapPin className="h-4 w-4 shrink-0 text-textSecondary" />
          <input
            value={searchCity}
            onChange={(e) => setSearchCity(e.target.value)}
            placeholder="Pick-up city"
            className="w-full bg-transparent text-sm text-white placeholder:text-textSecondary focus:outline-none"
          />
        </label>
        <label className="flex items-center gap-2 rounded-xl bg-white/[0.06] px-3 py-3">
          <CalendarDays className="h-4 w-4 shrink-0 text-textSecondary" />
          <input
            type="date"
            value={searchPickUp}
            onChange={(e) => setSearchPickUp(e.target.value)}
            className="w-full bg-transparent text-sm text-white [color-scheme:dark] focus:outline-none"
          />
        </label>
        <label className="flex items-center gap-2 rounded-xl bg-white/[0.06] px-3 py-3">
          <CalendarDays className="h-4 w-4 shrink-0 text-textSecondary" />
          <input
            type="date"
            value={searchDropOff}
            onChange={(e) => setSearchDropOff(e.target.value)}
            className="w-full bg-transparent text-sm text-white [color-scheme:dark] focus:outline-none"
          />
        </label>
        <button
          onClick={search}
          className="flex items-center justify-center gap-2 rounded-xl bg-neon px-4 py-3 text-sm font-bold text-black transition hover:bg-neonDeep"
        >
          <Search className="h-4 w-4" /> Search cars
        </button>
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-[240px_1fr]">
        {/* Filters */}
        <aside className="h-fit rounded-card border border-white/10 bg-charcoal p-4">
          <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
            <SlidersHorizontal className="h-4 w-4" /> Filters
          </p>

          <p className="text-xs text-textSecondary">Category</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={`rounded-md px-2 py-1 text-xs font-semibold ${
                  category === c ? "bg-white text-black" : "bg-white/[0.06] text-textSecondary"
                }`}
              >
                {c}
              </button>
            ))}
          </div>

          <label className="mt-4 block text-xs text-textSecondary">Max price / day: ${maxDaily}</label>
          <input
            type="range"
            min={25}
            max={200}
            step={5}
            value={maxDaily}
            onChange={(e) => setMaxDaily(Number(e.target.value))}
            className="mt-1 w-full accent-neon"
          />

          <label className="mt-4 flex items-center gap-2 text-xs text-white">
            <input type="checkbox" checked={autoOnly} onChange={(e) => setAutoOnly(e.target.checked)} className="accent-neon" />
            Automatic only
          </label>
          <label className="mt-2 flex items-center gap-2 text-xs text-white">
            <input type="checkbox" checked={freeCancel} onChange={(e) => setFreeCancel(e.target.checked)} className="accent-neon" />
            Free cancellation
          </label>

          <p className="mt-4 text-xs text-textSecondary">Sort by</p>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortId)}
            className="mt-1 w-full rounded-lg bg-white/[0.06] px-2 py-2 text-xs text-white focus:outline-none [&>option]:text-black"
          >
            <option value="price">Price: low to high</option>
            <option value="-price">Price: high to low</option>
            <option value="rating">Supplier rating</option>
          </select>
        </aside>

        {/* Results */}
        <div>
          {loading ? (
            <SkeletonCards count={6} imageH="h-32" />
          ) : filtered.length === 0 ? (
            <p className="py-16 text-center text-sm text-textSecondary">No cars match your filters.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((c) => (
                <CarRentalCard key={c.id} car={c} days={days} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CarRentalsPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <CarsResults />
    </Suspense>
  );
}
