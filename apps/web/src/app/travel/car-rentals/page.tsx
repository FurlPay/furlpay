"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { CarFront, ChevronRight, CloudOff, MapPin, CalendarDays, Search, SearchX } from "lucide-react";
import { sendJSON } from "@/lib/api";
import { Spinner } from "@/components/ui";
import CarRentalCard from "@/components/travel/CarRentalCard";
import SkeletonCards from "@/components/travel/SkeletonCards";
import type { CarRental, CarCategory } from "@/lib/travel/data";
import Select from "@/components/form/Select";
import { CheckRow, ChipGroup, FilterPanel, FilterSection, RangeField } from "@/components/travel/Filters";
import EmptyState, { EMPTY_ACTION_PRIMARY } from "@/components/travel/EmptyState";
import { outcomeOf, reportSearchOutcome } from "@/lib/travel/searchTelemetry";

const CATEGORIES: Array<CarCategory | "Any"> = ["Any", "Economy", "Compact", "SUV", "Luxury", "Van"];
type SortId = "price" | "-price" | "rating";
const SORTS: { value: SortId; label: string }[] = [
  { value: "price", label: "Price: low to high" },
  { value: "-price", label: "Price: high to low" },
  { value: "rating", label: "Supplier rating" },
];
const DAILY_MIN = 25;
const DAILY_MAX = 200;

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
  const [maxDaily, setMaxDaily] = useState(DAILY_MAX);
  const [autoOnly, setAutoOnly] = useState(false);
  const [freeCancel, setFreeCancel] = useState(false);
  const [sort, setSort] = useState<SortId>("price");
  /** Why the provider returned nothing, when it did — not the visitor's filters. */
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setLoading(true);
    setFailed(false);
    sendJSON<{ results: CarRental[]; days: number; unavailableReason?: string }>("/api/travel/search", { type: "cars", city, pickUp, dropOff })
      .then((d) => {
        setCars(d.results);
        setDays(d.days);
        setUnavailable(d.unavailableReason ?? null);
        reportSearchOutcome("cars", outcomeOf(d.results.length, d.unavailableReason), { count: d.results.length, reason: d.unavailableReason });
      })
      // A failed request is not "no cars": it never ran.
      .catch(() => {
        setCars([]);
        setFailed(true);
        reportSearchOutcome("cars", "failed");
      })
      .finally(() => setLoading(false));
  }, [city, pickUp, dropOff, reloadKey]);

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

  const activeFilters = (category !== "Any" ? 1 : 0) + (maxDaily < DAILY_MAX ? 1 : 0) + (autoOnly ? 1 : 0) + (freeCancel ? 1 : 0);
  const resetFilters = () => { setCategory("Any"); setMaxDaily(DAILY_MAX); setAutoOnly(false); setFreeCancel(false); };
  const ready = !loading && !failed && !unavailable;
  const field = "flex h-12 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.05] px-3 transition-colors focus-within:border-neon/50";

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-6 sm:px-5">
      <nav aria-label="Breadcrumb" className="text-[12.5px] text-white/50">
        <ol className="flex items-center gap-1.5">
          <li><Link href="/travel" className="transition-colors hover:text-white">Travel</Link></li>
          <li aria-hidden><ChevronRight className="h-3.5 w-3.5" /></li>
          <li aria-current="page" className="text-white/80">Car rentals</li>
        </ol>
      </nav>
      <div className="mt-3">
        <h1 className="text-[26px] font-bold leading-tight tracking-tight text-white sm:text-[30px]">{city ? `Car rentals in ${city}` : "Car rentals"}</h1>
        <p className="mt-1 text-[13px] text-white/55" aria-live="polite">
          {loading ? "Searching…" : ready ? `${filtered.length} of ${cars.length} cars · ${days} ${days === 1 ? "day" : "days"}` : ""}
        </p>
      </div>

      {/* Search bar */}
      <form
        onSubmit={(e) => { e.preventDefault(); search(); }}
        className="mt-5 grid gap-2.5 rounded-2xl border border-white/[0.08] bg-[#0A0D0C] p-3 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_auto]"
      >
        <label className={field}>
          <MapPin className="h-4 w-4 shrink-0 text-white/45" aria-hidden />
          <span className="sr-only">Pick-up city</span>
          <input
            value={searchCity}
            onChange={(e) => setSearchCity(e.target.value)}
            placeholder="Pick-up city"
            className="w-full bg-transparent text-sm text-white placeholder:text-white/40 focus:outline-none"
          />
        </label>
        <label className={field}>
          <CalendarDays className="h-4 w-4 shrink-0 text-white/45" aria-hidden />
          <span className="sr-only">Pick-up date</span>
          <input type="date" value={searchPickUp} onChange={(e) => setSearchPickUp(e.target.value)} className="w-full bg-transparent text-sm text-white focus:outline-none" />
        </label>
        <label className={field}>
          <CalendarDays className="h-4 w-4 shrink-0 text-white/45" aria-hidden />
          <span className="sr-only">Drop-off date</span>
          <input type="date" value={searchDropOff} min={searchPickUp || undefined} onChange={(e) => setSearchDropOff(e.target.value)} className="w-full bg-transparent text-sm text-white focus:outline-none" />
        </label>
        <button type="submit" className="flex h-12 items-center justify-center gap-2 rounded-xl bg-neon px-5 text-sm font-bold text-black transition hover:brightness-110">
          <Search className="h-4 w-4" aria-hidden /> Search cars
        </button>
      </form>

      <div className="mt-6 grid gap-6 lg:grid-cols-[264px_1fr]">
        <FilterPanel activeCount={activeFilters} onReset={resetFilters} resultCount={ready ? filtered.length : null}>
          <FilterSection label="Category">
            <ChipGroup label="Car category" options={CATEGORIES.map((c) => ({ value: c, label: c }))} value={category} onChange={setCategory} />
          </FilterSection>
          <FilterSection label="Price per day">
            <RangeField label="Up to" min={DAILY_MIN} max={DAILY_MAX} step={5} value={maxDaily} onChange={setMaxDaily}
              format={(v) => (v >= DAILY_MAX ? `$${v}+` : `$${v}`)} />
          </FilterSection>
          <FilterSection label="Rental">
            <CheckRow checked={autoOnly} onChange={setAutoOnly} label="Automatic only" />
            <CheckRow checked={freeCancel} onChange={setFreeCancel} label="Free cancellation" />
          </FilterSection>
        </FilterPanel>

        <div className="min-w-0">
          <div className="mb-4 flex items-center justify-end gap-2">
            <span id="cars-sort-label" className="text-[12.5px] text-white/55">Sort by</span>
            <Select labelId="cars-sort-label" value={sort} options={SORTS} onValueChange={(v) => setSort(v as SortId)} className="!w-[190px]" />
          </div>

          {loading ? (
            <SkeletonCards count={6} imageH="h-32" />
          ) : failed ? (
            <EmptyState
              role="alert"
              icon={<CloudOff className="h-5 w-5" />}
              title="Search couldn't run"
              actions={<button type="button" onClick={() => setReloadKey((k) => k + 1)} className={EMPTY_ACTION_PRIMARY}>Try again</button>}
            >
              Something went wrong reaching the search service. Nothing was booked.
            </EmptyState>
          ) : unavailable ? (
            <EmptyState
              icon={<CarFront className="h-5 w-5" />}
              title={city ? `No bookable cars in ${city}` : "No bookable cars"}
              actions={<Link href="/travel?focus=search" className={EMPTY_ACTION_PRIMARY}>Plan another part of the trip</Link>}
            >
              {unavailable === "no_live_provider"
                ? "Live car rates need a rental provider, which isn't connected yet — so there is nothing to quote."
                : "Our provider returned no cars for these dates. Try a different pick-up city or dates above."}
            </EmptyState>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<SearchX className="h-5 w-5" />}
              title={cars.length ? "No cars match your filters" : "No cars found"}
              actions={cars.length ? <button type="button" onClick={resetFilters} className={EMPTY_ACTION_PRIMARY}>Reset filters</button> : undefined}
            >
              {cars.length
                ? `${cars.length} ${cars.length === 1 ? "car is" : "cars are"} hidden by the filters you've set.`
                : "Enter a pick-up city and dates above to search."}
            </EmptyState>
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
