"use client";

import { useEffect, useMemo, useRef } from "react";
import type { MapPoint, MapResponse } from "@/app/api/travel/hotels/map/route";
import { RESULT_SORTS, distanceKm, sortResults, type ResultSort } from "@/lib/hotels/resultSort";
import HotelResultCard from "./HotelResultCard";

// The results list beside the map.
//
// IT IS THE MAP'S OWN DATA. `points` is exactly what the map last painted (the
// same array, after the same Saved filter), so the list and the markers can
// never disagree about what is here. Sorting reorders the list only, locally.
//
// THE COUNT SAYS WHAT IT COUNTS. Properties drawn individually are listed;
// curated properties folded into clusters at this zoom are not individual rows
// yet, so the header names them separately and says how to see them.

export interface HotelResultsPanelProps {
  points: MapPoint[];
  meta: Omit<MapResponse, "points" | "clusters"> | null;
  loading: boolean;
  error: string | null;
  sort: ResultSort;
  onSort: (s: ResultSort) => void;
  center: { latitude: number; longitude: number } | null;
  hoveredId: string | null;
  selectedId: string | null;
  savedIds: Set<string>;
  filtersActive: boolean;
  onHover: (id: string | null) => void;
  onSelect: (p: MapPoint) => void;
  onRetry: () => void;
  onClearFilters: () => void;
}

export default function HotelResultsPanel(props: HotelResultsPanelProps) {
  const { points, meta, loading, error, sort, onSort, center, hoveredId, selectedId, savedIds, filtersActive } = props;
  const list = useRef<HTMLOListElement>(null);

  const sorted = useMemo(() => sortResults(points, sort, center ?? undefined), [points, sort, center]);
  const clustered = meta?.counts.curatedClustered ?? 0;

  // A hotel selected on the MAP scrolls its card into view, gently.
  useEffect(() => {
    if (!selectedId) return;
    const el = list.current?.querySelector<HTMLElement>(`[data-hotel-id="${CSS.escape(selectedId)}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedId]);

  return (
    <section aria-label="Hotels in this area" className="flex h-full min-h-0 flex-col bg-[#030505]">
      <header className="flex items-center justify-between gap-3 px-4 pb-3 pt-4 lg:px-5">
        <div className="min-w-0">
          <h1 className="text-[20px] font-bold leading-tight tracking-tight text-[#F5F7F6]" aria-live="polite">
            {loading && !points.length ? "Finding stays…" : `${points.length.toLocaleString("en-US")} ${points.length === 1 ? "property" : "properties"} in view`}
          </h1>
          {clustered > 0 && (
            <p className="mt-0.5 text-[12px] text-[#A4AAA9]">
              +{clustered.toLocaleString("en-US")} more in clusters — zoom in or open a cluster to list them
            </p>
          )}
        </div>
        <label className="flex shrink-0 items-center gap-2 text-[12px] text-[#A4AAA9]">
          <span className="hidden sm:inline">Sort</span>
          <select
            value={sort}
            onChange={(e) => onSort(e.target.value as ResultSort)}
            aria-label="Sort hotels"
            className="h-10 min-w-[150px] rounded-[10px] border border-white/[0.10] bg-[#090D0E] px-3 text-[13px] font-medium text-[#F5F7F6] focus:border-[#00E6A7]/60 focus:outline-none [&>option]:bg-[#090D0E]"
          >
            {RESULT_SORTS.map((s) => (
              <option key={s.id} value={s.id} disabled={s.id === "distance" && !center}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4 lg:px-4">
        {error && (
          <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-red-400/25 bg-red-500/[0.06] px-4 py-3">
            <p className="text-[13px] text-red-200">We couldn&apos;t load stays right now.</p>
            <button type="button" onClick={props.onRetry} className="text-[13px] font-semibold text-white hover:text-[#00E6A7]">
              Try again
            </button>
          </div>
        )}

        {loading && !points.length ? (
          <ul className="space-y-2.5" aria-hidden>
            {[0, 1, 2, 3, 4].map((n) => (
              <li key={n} className="flex gap-3.5 rounded-[14px] border border-white/[0.06] bg-[#090D0E] p-2.5">
                <div className="h-[100px] w-[120px] shrink-0 animate-pulse rounded-[10px] bg-white/[0.05] sm:w-[168px]" />
                <div className="flex-1 space-y-2 py-1">
                  <div className="h-3.5 w-3/4 animate-pulse rounded bg-white/[0.06]" />
                  <div className="h-3 w-1/3 animate-pulse rounded bg-white/[0.05]" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-white/[0.05]" />
                </div>
              </li>
            ))}
          </ul>
        ) : points.length === 0 && !error ? (
          <div className="mt-6 rounded-[14px] border border-white/[0.08] bg-[#090D0E] px-5 py-8 text-center">
            <p className="text-[15px] font-semibold text-[#F5F7F6]">No stays in view</p>
            <p className="mx-auto mt-1.5 max-w-xs text-[13px] text-[#A4AAA9]">
              {clustered > 0
                ? "Properties here are grouped into clusters at this zoom. Zoom in or open a cluster on the map."
                : filtersActive
                  ? "Try removing a filter or moving the map."
                  : "Try moving the map, zooming out, or searching a destination."}
            </p>
            {filtersActive && (
              <button type="button" onClick={props.onClearFilters} className="mt-4 rounded-[10px] border border-white/[0.12] px-4 py-2 text-[13px] font-semibold text-white transition hover:border-[#00E6A7] hover:text-[#00E6A7]">
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <ol ref={list} className="space-y-2.5">
            {sorted.map((p) => (
              <HotelResultCard
                key={p.id}
                point={p}
                selected={p.id === selectedId}
                hovered={p.id === hoveredId}
                saved={savedIds.has(p.id)}
                distanceKm={center ? distanceKm(center, p) : undefined}
                onHover={props.onHover}
                onSelect={props.onSelect}
              />
            ))}
          </ol>
        )}

        {meta?.osmDeferred && points.length > 0 && (
          <p className="mt-3 text-center text-[11.5px] text-[#6E7675]">More hotels from OpenStreetMap are still loading for this area…</p>
        )}
      </div>
    </section>
  );
}
