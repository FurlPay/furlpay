"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BedDouble, ChevronRight, CloudOff, SearchX } from "lucide-react";
import { sendJSON } from "@/lib/api";
import { Spinner } from "@/components/ui";
import PropertyCard from "@/components/travel/PropertyCard";
import SkeletonCards from "@/components/travel/SkeletonCards";
import type { Stay } from "@/lib/travel/data";
import Select from "@/components/form/Select";
import { CheckRow, ChipGroup, FilterPanel, FilterSection, RangeField } from "@/components/travel/Filters";
import EmptyState, { EMPTY_ACTION_PRIMARY, EMPTY_ACTION_SECONDARY } from "@/components/travel/EmptyState";
import { outcomeOf, reportSearchOutcome } from "@/lib/travel/searchTelemetry";

type SortId = "price" | "-price" | "rating" | "stars";
const SORTS: { value: SortId; label: string }[] = [
  { value: "price", label: "Price: low to high" },
  { value: "-price", label: "Price: high to low" },
  { value: "rating", label: "Guest rating" },
  { value: "stars", label: "Star rating" },
];
const PRICE_MIN = 50;
const PRICE_MAX = 500;
const STAR_OPTIONS = [
  { value: 0, label: "Any" },
  { value: 3, label: "3★+" },
  { value: 4, label: "4★+" },
  { value: 5, label: "5★" },
];
const shortDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

function StaysResults() {
  const params = useSearchParams();
  const city = params.get("city") ?? "";
  const checkIn = params.get("checkIn") ?? "";
  const checkOut = params.get("checkOut") ?? "";

  const [loading, setLoading] = useState(true);
  const [stays, setStays] = useState<Stay[]>([]);
  const [nights, setNights] = useState(3);

  const [maxPrice, setMaxPrice] = useState(PRICE_MAX);
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
        reportSearchOutcome("stays", outcomeOf(d.results.length, d.unavailableReason), { count: d.results.length, reason: d.unavailableReason });
      })
      // A network failure is not "no results". Conflating them tells someone
      // their search came back empty when in fact it never ran.
      .catch(() => {
        setStays([]);
        setFailed(true);
        reportSearchOutcome("stays", "failed");
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

  const activeFilters = (maxPrice < PRICE_MAX ? 1 : 0) + (minStars > 0 ? 1 : 0) + (freeCancel ? 1 : 0) + (ecoOnly ? 1 : 0);
  const resetFilters = () => { setMaxPrice(PRICE_MAX); setMinStars(0); setFreeCancel(false); setEcoOnly(false); };
  const dates = checkIn && checkOut ? `${shortDate(checkIn)} – ${shortDate(checkOut)}` : "";
  const ready = !loading && !failed && !unavailable;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-6 sm:px-5">
      <nav aria-label="Breadcrumb" className="text-[12.5px] text-white/50">
        <ol className="flex items-center gap-1.5">
          <li><Link href="/travel" className="transition-colors hover:text-white">Travel</Link></li>
          <li aria-hidden><ChevronRight className="h-3.5 w-3.5" /></li>
          <li aria-current="page" className="text-white/80">Stays</li>
        </ol>
      </nav>
      <div className="mt-3 min-w-0">
        <h1 className="text-[26px] font-bold leading-tight tracking-tight text-white sm:text-[30px]">{city ? `Stays in ${city}` : "Stays"}</h1>
        <p className="mt-1 text-[13px] text-white/55" aria-live="polite">
          {loading
            ? "Searching…"
            : ready
              ? `${filtered.length} of ${stays.length} ${stays.length === 1 ? "property" : "properties"} · ${nights} ${nights === 1 ? "night" : "nights"}${dates ? ` · ${dates}` : ""}`
              : dates}
        </p>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[264px_1fr]">
        <FilterPanel activeCount={activeFilters} onReset={resetFilters} resultCount={ready ? filtered.length : null}>
          <FilterSection label="Price per night">
            <RangeField label="Up to" min={PRICE_MIN} max={PRICE_MAX} step={10} value={maxPrice} onChange={setMaxPrice}
              format={(v) => (v >= PRICE_MAX ? `$${v}+` : `$${v}`)} />
          </FilterSection>
          <FilterSection label="Star rating">
            <ChipGroup label="Minimum stars" options={STAR_OPTIONS} value={minStars} onChange={setMinStars} />
          </FilterSection>
          <FilterSection label="Booking">
            <CheckRow checked={freeCancel} onChange={setFreeCancel} label="Free cancellation" />
            <CheckRow checked={ecoOnly} onChange={setEcoOnly} label="Eco-certified" />
          </FilterSection>
        </FilterPanel>

        <div className="min-w-0">
          <div className="mb-4 flex items-center justify-end gap-2">
            <span id="stays-sort-label" className="text-[12.5px] text-white/55">Sort by</span>
            <Select labelId="stays-sort-label" value={sort} options={SORTS} onValueChange={(v) => setSort(v as SortId)} className="!w-[190px]" />
          </div>

          {loading ? (
            <SkeletonCards count={6} imageH="h-40" />
          ) : failed ? (
            <EmptyState
              role="alert"
              icon={<CloudOff className="h-5 w-5" />}
              title="Search couldn't run"
              actions={
                <>
                  <button type="button" onClick={() => setReloadKey((k) => k + 1)} className={EMPTY_ACTION_PRIMARY}>Try again</button>
                  <Link href="/travel?focus=search" className={EMPTY_ACTION_SECONDARY}>Change search</Link>
                </>
              }
            >
              Something went wrong reaching the search service. Nothing was booked.
            </EmptyState>
          ) : unavailable ? (
            // The distinction that matters: "No stays match your filters"
            // blames the reader for a gap on our side and sends them adjusting
            // filters that were never the cause.
            <EmptyState
              icon={<BedDouble className="h-5 w-5" />}
              title={city ? `No bookable rates for ${city}` : "No bookable rates"}
              actions={
                <>
                  {hasIndexed && <Link href="/hotels/map" className={EMPTY_ACTION_PRIMARY}>Browse indexed properties{city ? ` in ${city}` : ""}</Link>}
                  <Link href="/travel?focus=search" className={hasIndexed ? EMPTY_ACTION_SECONDARY : EMPTY_ACTION_PRIMARY}>Try other dates or places</Link>
                </>
              }
            >
              {unavailable === "no_live_provider"
                ? "Live rates need a booking provider, which isn't connected yet — so there is nothing to quote."
                : "Our provider returned no availability for these dates."}
            </EmptyState>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<SearchX className="h-5 w-5" />}
              title={stays.length ? "No stays match your filters" : "No stays found"}
              actions={
                stays.length ? (
                  <>
                    <button type="button" onClick={resetFilters} className={EMPTY_ACTION_PRIMARY}>Reset filters</button>
                    <Link href="/travel?focus=search" className={EMPTY_ACTION_SECONDARY}>Change search</Link>
                  </>
                ) : (
                  <Link href="/travel?focus=search" className={EMPTY_ACTION_PRIMARY}>Change search</Link>
                )
              }
            >
              {stays.length
                ? `${stays.length} ${stays.length === 1 ? "property is" : "properties are"} hidden by the filters you've set. Loosen the price or star rating to see them.`
                : "The search came back empty for this destination and these dates."}
            </EmptyState>
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
