"use client";

import { useCallback, useEffect, useState } from "react";
import { LocateFixed, Loader2, MapPin } from "lucide-react";
import Link from "next/link";
import IndexedPropertyCard from "./IndexedPropertyCard";
import type { IndexedProperty } from "@/lib/travel/propertySource";
import { useUserLocation, locationMessage } from "@/lib/geo/useUserLocation";
import {
  boundsAround,
  distanceMeters,
  formatDistance,
  SEARCH_RADII_M,
  type Coordinate,
} from "@/lib/geo/coordinates";

// ---------------------------------------------------------------------------
// "Stays near me".
//
// ── THE RADIUS IS NEVER WIDENED SILENTLY ───────────────────────────────────
// The tempting implementation searches 5km, finds nothing, quietly searches
// 100km and presents the results as "nearby". Someone in a town with no
// indexed hotels then sees a list of places two hours away under a heading
// that says they are close. So a widening is always an offer the reader
// accepts — "No stays within 5 km · Search within 25 km" — and the current
// radius is stated on the results.
//
// ── WHY IT ASKS THE SERVER FOR A BOX ───────────────────────────────────────
// The dataset is 16,014 properties and roughly 10MB. Shipping it to the
// browser to sort by distance would be absurd, so the existing bbox endpoint
// does the geography and only the properties inside the box come back. The
// exact coordinate never leaves: what is sent is the box, which is a rounded
// area rather than the point.
// ---------------------------------------------------------------------------

interface MapPoint {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  city?: string | null;
  country?: string | null;
  rating?: number | null;
  ratingCount?: number | null;
  propertyType?: string | null;
  typeDisplay?: string | null;
  photoCount?: number;
  website?: string | null;
}

/** A map point as the card wants it. No invented fields — absent stays absent. */
function toProperty(p: MapPoint): IndexedProperty {
  return {
    id: p.id,
    name: p.name,
    coordinates: { latitude: p.latitude, longitude: p.longitude },
    address: null,
    city: p.city ?? null,
    country: p.country ?? null,
    propertyType: p.propertyType ?? null,
    typeDisplay: p.typeDisplay ?? null,
    rating: p.rating ?? null,
    reviewCount: p.ratingCount ?? null,
    photoCount: p.photoCount ?? 0,
    website: p.website ?? null,
    summary: null,
    rate: null,
    source: "indexed_dataset",
  };
}

type Phase = "idle" | "searching" | "done" | "failed";

export default function NearbyStays({ nights = 1 }: { nights?: number }) {
  const loc = useUserLocation();
  const [radiusIdx, setRadiusIdx] = useState(0);
  const [results, setResults] = useState<IndexedProperty[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");

  const radius = SEARCH_RADII_M[Math.min(radiusIdx, SEARCH_RADII_M.length - 1)];

  const search = useCallback(
    async (centre: Coordinate, r: number) => {
      setPhase("searching");
      try {
        const b = boundsAround(centre, r);
        const params = new URLSearchParams({
          bbox: `${b.minLng},${b.minLat},${b.maxLng},${b.maxLat}`,
          zoom: "13",
        });
        const res = await fetch(`/api/travel/hotels/map?${params}`);
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { points?: MapPoint[] };

        // Rank by real great-circle distance. The endpoint returns what is in
        // the box, in its own order; "nearest" has to be computed.
        const ranked = (data.points ?? [])
          .map(toProperty)
          .map((p) => ({ p, d: distanceMeters(centre, p.coordinates) }))
          .filter((x): x is { p: IndexedProperty; d: number } => x.d !== null && x.d <= r)
          .sort((a, b2) => a.d - b2.d)
          .slice(0, 24)
          .map((x) => x.p);

        setResults(ranked);
        setPhase("done");
      } catch {
        // A failed request is not an empty result, and must not be shown as one.
        setPhase("failed");
      }
    },
    []
  );

  const start = useCallback(() => {
    if (loc.coordinate) {
      void search(loc.coordinate, SEARCH_RADII_M[radiusIdx]);
    } else {
      loc.request();
    }
  }, [loc, radiusIdx, search]);

  // Once a position arrives, run the first search.
  //
  // In an effect, not during render: a fetch in the render phase fires twice
  // under StrictMode and is a side effect React is free to discard or repeat.
  // The phase guard keeps it to one call per position.
  useEffect(() => {
    if (loc.status === "available" && loc.coordinate && phase === "idle") {
      void search(loc.coordinate, SEARCH_RADII_M[0]);
    }
  }, [loc.status, loc.coordinate, phase, search]);

  const failure = locationMessage(loc.status);
  const busy = loc.status === "requesting" || phase === "searching";

  return (
    <section aria-labelledby="nearby-heading" className="mt-8">
      <div className="flex items-center justify-between gap-3">
        <h2 id="nearby-heading" className="text-lg font-bold text-white">
          Stays near you
        </h2>
        {loc.status !== "available" && !failure && (
          <button
            type="button"
            onClick={start}
            disabled={busy}
            // Icon plus text, so the control is not icon-only for a screen
            // reader and the touch target clears 44px.
            aria-label="Find stays near my location"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-white/10 px-4 text-sm font-semibold text-white transition hover:bg-white/15 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <LocateFixed className="h-4 w-4" aria-hidden="true" />
            )}
            {busy ? "Locating…" : "Use my location"}
          </button>
        )}
      </div>

      {/* One live region for the whole flow, so a screen reader hears the
          outcome without every card being announced. */}
      <p aria-live="polite" className="sr-only">
        {busy
          ? "Finding stays near you"
          : phase === "done"
            ? `${results.length} stays found within ${formatDistance(radius)}`
            : failure
              ? failure.title
              : ""}
      </p>

      {!loc.asked && !failure && (
        <p className="mt-1 text-sm text-textSecondary">
          Share your location to see indexed stays closest to you. It is used for this
          search only.
        </p>
      )}

      {failure && (
        <div className="mt-3 rounded-card border border-white/10 bg-charcoal p-4">
          <p className="text-sm font-semibold text-white">{failure.title}</p>
          <p className="mt-1 text-sm text-textSecondary">{failure.body}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {loc.status !== "denied" && loc.status !== "unsupported" && (
              <button
                type="button"
                onClick={() => {
                  loc.reset();
                  loc.request();
                }}
                className="min-h-[44px] rounded-full bg-white/10 px-4 text-sm font-semibold text-white hover:bg-white/15"
              >
                Try again
              </button>
            )}
            <Link
              href="/hotels/map"
              className="inline-flex min-h-[44px] items-center rounded-full border border-white/15 px-4 text-sm font-semibold text-white hover:bg-white/[0.06]"
            >
              Search the map instead
            </Link>
          </div>
        </div>
      )}

      {phase === "failed" && (
        <div className="mt-3 rounded-card border border-white/10 bg-charcoal p-4">
          <p className="text-sm font-semibold text-white">Couldn&apos;t load nearby stays</p>
          <p className="mt-1 text-sm text-textSecondary">
            Something went wrong on our side. Your location was not the problem.
          </p>
          <button
            type="button"
            onClick={() => loc.coordinate && void search(loc.coordinate, radius)}
            className="mt-3 min-h-[44px] rounded-full bg-white/10 px-4 text-sm font-semibold text-white hover:bg-white/15"
          >
            Retry
          </button>
        </div>
      )}

      {phase === "done" && results.length === 0 && (
        <div className="mt-3 rounded-card border border-white/10 bg-charcoal p-4">
          <p className="text-sm font-semibold text-white">
            No indexed stays within {formatDistance(radius)}
          </p>
          <p className="mt-1 text-sm text-textSecondary">
            We index 16,014 properties across 27 countries, and none of them are in
            range. Widening is your call — we will not quietly call somewhere far away
            &ldquo;nearby&rdquo;.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {radiusIdx < SEARCH_RADII_M.length - 1 && (
              <button
                type="button"
                onClick={() => {
                  const next = radiusIdx + 1;
                  setRadiusIdx(next);
                  if (loc.coordinate) void search(loc.coordinate, SEARCH_RADII_M[next]);
                }}
                className="min-h-[44px] rounded-full bg-white/10 px-4 text-sm font-semibold text-white hover:bg-white/15"
              >
                Search within {formatDistance(SEARCH_RADII_M[radiusIdx + 1])}
              </button>
            )}
            <Link
              href="/hotels/map"
              className="inline-flex min-h-[44px] items-center rounded-full border border-white/15 px-4 text-sm font-semibold text-white hover:bg-white/[0.06]"
            >
              Search the map
            </Link>
          </div>
        </div>
      )}

      {phase === "done" && results.length > 0 && (
        <>
          <p className="mt-1 text-sm text-textSecondary">
            {results.length} {results.length === 1 ? "stay" : "stays"} within{" "}
            {formatDistance(radius)}, nearest first.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {results.map((p) => (
              <IndexedPropertyCard
                key={p.id}
                property={p}
                nights={nights}
                from={loc.coordinate}
              />
            ))}
          </div>
        </>
      )}

      {busy && phase === "searching" && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-64 animate-pulse rounded-card border border-white/10 bg-white/[0.03]">
              <div className="h-40 rounded-t-card bg-white/[0.04]" />
              <div className="space-y-2 p-4">
                <div className="h-4 w-2/3 rounded bg-white/[0.06]" />
                <div className="h-3 w-1/2 rounded bg-white/[0.05]" />
              </div>
            </div>
          ))}
        </div>
      )}

      {loc.status === "available" && phase !== "searching" && (
        <p className="mt-3 flex items-center gap-1 text-[11px] text-textSecondary">
          <MapPin className="h-3 w-3" aria-hidden="true" />
          Using your approximate location for this search only. It is not stored.
        </p>
      )}
    </section>
  );
}
