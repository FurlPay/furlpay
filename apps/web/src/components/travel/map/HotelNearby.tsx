"use client";

import { useEffect, useMemo, useState } from "react";
import { formatDistanceKm, haversineKm } from "@/lib/geo/geodesy";
import { POI_COLORS } from "./overlays";
import type { NearbyPoi } from "./useTravelOverlays";

// The hotel's surroundings, in the detail panel:
//
//   AIRPORTS — the nearest commercial airports by STRAIGHT-LINE distance, and
//   labelled as such. A straight line is not a drive; nothing here implies one.
//
//   WHAT'S NEARBY — named places within ~900 m from OpenStreetMap, fetched only
//   when the reader asks (Overpass often fails from Vercel; it must never slow
//   the panel). "Unavailable" and "nothing found" are different answers.

interface NearAirport {
  iata: string;
  name: string;
  distanceKm: number;
}

const CATEGORY_LABEL: Record<string, string> = {
  restaurant: "Restaurants",
  cafe: "Cafes",
  attraction: "Attractions",
  museum: "Museums",
  shopping: "Shopping",
  transport: "Stations",
};

export default function HotelNearby({
  hotelId,
  latitude,
  longitude,
  onPois,
}: {
  hotelId: string;
  latitude: number;
  longitude: number;
  /** Hands the places to the map to draw; [] clears them. */
  onPois: (pois: NearbyPoi[]) => void;
}) {
  const [airports, setAirports] = useState<NearAirport[] | null>(null);
  const [poiState, setPoiState] = useState<"idle" | "loading" | "ok" | "unavailable" | "error">("idle");
  const [pois, setPois] = useState<NearbyPoi[]>([]);
  const [requested, setRequested] = useState(false);

  // New hotel: forget the last one's places, on the panel and on the map.
  useEffect(() => {
    setPois([]);
    setPoiState("idle");
    setRequested(false);
    onPois([]);
    // onPois is a state setter from the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId]);
  useEffect(() => () => onPois([]), [onPois]);

  useEffect(() => {
    const ac = new AbortController();
    setAirports(null);
    fetch(`/api/travel/airports/map?near=${latitude.toFixed(5)},${longitude.toFixed(5)}&limit=2`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { nearest: NearAirport[] }) => setAirports(d.nearest))
      .catch(() => {
        if (!ac.signal.aborted) setAirports([]);
      });
    return () => ac.abort();
  }, [hotelId, latitude, longitude]);

  useEffect(() => {
    if (!requested) return;
    const ac = new AbortController();
    setPoiState("loading");
    fetch(`/api/travel/hotels/pois?lat=${latitude.toFixed(5)}&lng=${longitude.toFixed(5)}`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { status: "ok" | "unavailable"; pois: NearbyPoi[] }) => {
        setPois(d.pois);
        setPoiState(d.status);
        onPois(d.pois);
      })
      .catch(() => {
        if (!ac.signal.aborted) setPoiState("error");
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested, hotelId]);

  const groups = useMemo(() => {
    const here = { latitude, longitude };
    const by = new Map<string, Array<NearbyPoi & { km: number }>>();
    for (const p of pois) {
      const list = by.get(p.category) ?? [];
      list.push({ ...p, km: haversineKm(here, p) });
      by.set(p.category, list);
    }
    return [...by.entries()]
      .map(([cat, list]) => ({ cat, list: list.sort((a, b) => a.km - b.km) }))
      .sort((a, b) => b.list.length - a.list.length);
  }, [pois, latitude, longitude]);

  return (
    <section className="border-t border-white/[0.08] px-4 py-3" aria-label="Around this hotel">
      <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6E7675]">Airports</h3>
      {airports === null ? (
        <div className="mt-2 h-4 w-2/3 animate-pulse rounded bg-white/[0.06]" aria-hidden />
      ) : airports.length === 0 ? (
        <p className="mt-1.5 text-[12.5px] text-[#A4AAA9]">No commercial airport within 200 km.</p>
      ) : (
        <ul className="mt-1.5 space-y-1">
          {airports.map((a) => (
            <li key={a.iata} className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="min-w-0 truncate text-[#E6EAE8]">
                <strong className="font-semibold text-[#7DD3FC]">{a.iata}</strong> {a.name}
              </span>
              <span className="shrink-0 text-[12px] text-[#A4AAA9]">{formatDistanceKm(a.distanceKm)} straight-line</span>
            </li>
          ))}
        </ul>
      )}

      <h3 className="mt-4 text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6E7675]">What&apos;s nearby</h3>
      {poiState === "idle" && (
        <button
          type="button"
          onClick={() => setRequested(true)}
          className="mt-2 h-9 rounded-[10px] border border-white/[0.12] px-3 text-[12.5px] font-semibold text-white transition hover:border-[#00E6A7] hover:text-[#00E6A7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00E6A7]"
        >
          Show places within 900 m
        </button>
      )}
      {poiState === "loading" && (
        <p className="mt-2 flex items-center gap-2 text-[12.5px] text-[#A4AAA9]" role="status">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#00E6A7]" aria-hidden />
          Asking OpenStreetMap…
        </p>
      )}
      {(poiState === "unavailable" || poiState === "error") && (
        <div className="mt-2 text-[12.5px] text-[#A4AAA9]" role="status">
          OpenStreetMap didn&apos;t answer in time, so nearby places aren&apos;t available right now.
          <button type="button" onClick={() => { setRequested(false); setTimeout(() => setRequested(true), 0); }} className="ml-1 font-semibold text-white underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00E6A7]">
            Try again
          </button>
        </div>
      )}
      {poiState === "ok" && pois.length === 0 && (
        <p className="mt-2 text-[12.5px] text-[#A4AAA9]">OpenStreetMap lists no named places of these kinds within 900 m.</p>
      )}
      {poiState === "ok" && pois.length > 0 && (
        <>
          <ul className="mt-2 space-y-2.5">
            {groups.map(({ cat, list }) => (
              <li key={cat}>
                <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[#E6EAE8]">
                  <span className="h-2 w-2 rounded-full" style={{ background: POI_COLORS[cat] }} aria-hidden />
                  {CATEGORY_LABEL[cat] ?? cat} <span className="font-normal text-[#6E7675]">· {list.length}</span>
                </p>
                <ul className="mt-0.5 space-y-0.5 pl-3.5">
                  {list.slice(0, 3).map((p) => (
                    <li key={p.id} className="flex justify-between gap-3 text-[12px] text-[#A4AAA9]">
                      <span className="truncate">{p.name}</span>
                      <span className="shrink-0">{formatDistanceKm(p.km)}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[10.5px] text-[#6E7675]">Places from OpenStreetMap contributors · straight-line distances</p>
        </>
      )}
    </section>
  );
}
