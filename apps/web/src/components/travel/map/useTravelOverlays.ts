"use client";

import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap, MapLayerMouseEvent } from "maplibre-gl";
import { circlePolygon, greatCircle, haversineKm } from "@/lib/geo/geodesy";
import type { RadiusQuery } from "@/lib/hotels/radius";
import {
  LYR_AIRPORT_DOT,
  SRC_AIRPORTS,
  SRC_POIS,
  SRC_RADIUS,
  SRC_ROUTE,
  airportFeatures,
} from "./overlays";

// Travel-context overlays, owned outside HotelMap so the map component only
// says WHAT to show. Every fetch here is cancellable and bounded; none of it
// runs during the hotel load, so a slow or failing overlay never delays a pin.

export interface MapAirport {
  iata: string;
  name: string;
  city: string;
  country: string;
  size: number;
  latitude: number;
  longitude: number;
}

export interface RouteInfo {
  from: MapAirport;
  to: MapAirport;
  km: number;
}

export interface NearbyPoi {
  id: string;
  name: string;
  category: string;
  latitude: number;
  longitude: number;
}

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

function setSource(m: MapLibreMap, id: string, data: GeoJSON.FeatureCollection | GeoJSON.Feature) {
  (m.getSource(id) as GeoJSONSource | undefined)?.setData(data);
}

/** `SFO-NRT` → ["SFO","NRT"], or null. */
export function parseRouteParam(raw: string | null): [string, string] | null {
  const m = raw?.toUpperCase().match(/^([A-Z]{3})-([A-Z]{3})$/);
  return m && m[1] !== m[2] ? [m[1], m[2]] : null;
}

export function useTravelOverlays({
  map,
  ready,
  airportsOn,
  routeCodes,
  radius,
  pois,
  onRouteLoaded,
}: {
  map: MapLibreMap | null;
  ready: boolean;
  airportsOn: boolean;
  routeCodes: [string, string] | null;
  radius: RadiusQuery | null;
  pois: NearbyPoi[];
  /** Called once with the destination, so the map can fly there when the URL
   *  named a route but no camera. */
  onRouteLoaded?: (r: RouteInfo) => void;
}) {
  const [airports, setAirports] = useState<MapAirport[]>([]);
  const [airportStatus, setAirportStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [selectedAirport, setSelectedAirport] = useState<MapAirport | null>(null);
  const [route, setRoute] = useState<RouteInfo | null>(null);
  const [routeError, setRouteError] = useState(false);
  const routeLoaded = useRef(onRouteLoaded);
  routeLoaded.current = onRouteLoaded;

  // --- airports in view: refetched on moveend while the layer is on --------
  useEffect(() => {
    if (!map || !ready) return;
    if (!airportsOn) {
      setSource(map, SRC_AIRPORTS, EMPTY);
      setAirports([]);
      setSelectedAirport(null);
      setAirportStatus("idle");
      return;
    }
    let ac: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fetchView = () => {
      ac?.abort();
      ac = new AbortController();
      const b = map.getBounds();
      const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((n) => n.toFixed(3)).join(",");
      setAirportStatus("loading");
      const mine = ac;
      fetch(`/api/travel/airports/map?bbox=${bbox}&z=${map.getZoom().toFixed(1)}`, { signal: mine.signal })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d: { airports: MapAirport[] }) => {
          if (mine.signal.aborted) return;
          setAirports(d.airports);
          setSource(map, SRC_AIRPORTS, airportFeatures(d.airports));
          setAirportStatus("ok");
        })
        .catch(() => {
          if (!mine.signal.aborted) setAirportStatus("error");
        });
    };
    const onMove = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(fetchView, 300);
    };
    fetchView();
    map.on("moveend", onMove);
    return () => {
      map.off("moveend", onMove);
      if (timer) clearTimeout(timer);
      ac?.abort();
    };
  }, [map, ready, airportsOn]);

  // --- airport hover + click (only while the layer is on) -------------------
  const airportsRef = useRef(airports);
  airportsRef.current = airports;
  useEffect(() => {
    if (!map || !ready || !airportsOn) return;
    let hovered: number | null = null;
    const clear = () => {
      if (hovered !== null) map.setFeatureState({ source: SRC_AIRPORTS, id: hovered }, { hover: false });
      hovered = null;
    };
    const onMove = (e: MapLayerMouseEvent) => {
      const f = e.features?.[0];
      if (!f || f.id === undefined) return;
      if (hovered !== f.id) {
        clear();
        hovered = f.id as number;
        map.setFeatureState({ source: SRC_AIRPORTS, id: hovered }, { hover: true });
      }
      map.getCanvas().style.cursor = "pointer";
    };
    const onLeave = () => {
      clear();
      map.getCanvas().style.cursor = "";
    };
    const onClick = (e: MapLayerMouseEvent) => {
      const iata = e.features?.[0]?.properties?.iata as string | undefined;
      const a = airportsRef.current.find((x) => x.iata === iata);
      if (a) setSelectedAirport(a);
    };
    map.on("mousemove", LYR_AIRPORT_DOT, onMove);
    map.on("mouseleave", LYR_AIRPORT_DOT, onLeave);
    map.on("click", LYR_AIRPORT_DOT, onClick);
    return () => {
      map.off("mousemove", LYR_AIRPORT_DOT, onMove);
      map.off("mouseleave", LYR_AIRPORT_DOT, onLeave);
      map.off("click", LYR_AIRPORT_DOT, onClick);
      clear();
    };
  }, [map, ready, airportsOn]);

  // --- flight route: two real airports, a geodesic arc ----------------------
  const routeKey = routeCodes ? routeCodes.join("-") : "";
  useEffect(() => {
    if (!map || !ready) return;
    setRouteError(false);
    if (!routeCodes) {
      setRoute(null);
      setSource(map, SRC_ROUTE, EMPTY);
      return;
    }
    const ac = new AbortController();
    fetch(`/api/travel/airports/map?iata=${routeCodes.join(",")}`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { airports: MapAirport[] }) => {
        const from = d.airports.find((a) => a.iata === routeCodes[0]);
        const to = d.airports.find((a) => a.iata === routeCodes[1]);
        // An unknown code draws nothing — never a guessed endpoint.
        if (!from || !to) {
          setRoute(null);
          setRouteError(true);
          setSource(map, SRC_ROUTE, EMPTY);
          return;
        }
        // An arc crossing the antimeridian comes back as a MultiLineString; it
        // is split into LineStrings so the line layer's geometry filter draws
        // every part.
        const arc = greatCircle(from, to);
        const lines = arc.geometry.type === "MultiLineString" ? arc.geometry.coordinates : [arc.geometry.coordinates];
        const end = (a: MapAirport): GeoJSON.Feature => ({
          type: "Feature",
          properties: { iata: a.iata },
          geometry: { type: "Point", coordinates: [a.longitude, a.latitude] },
        });
        setSource(map, SRC_ROUTE, {
          type: "FeatureCollection",
          features: [
            ...lines.map((c): GeoJSON.Feature => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: c } })),
            end(from),
            end(to),
          ],
        });
        const info = { from, to, km: haversineKm(from, to) };
        setRoute(info);
        routeLoaded.current?.(info);
      })
      .catch(() => {
        if (!ac.signal.aborted) setRouteError(true);
      });
    return () => ac.abort();
    // routeKey stands for routeCodes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, ready, routeKey]);

  // --- radius circle ---------------------------------------------------------
  useEffect(() => {
    if (!map || !ready) return;
    setSource(map, SRC_RADIUS, radius ? circlePolygon(radius.center, radius.km) : EMPTY);
  }, [map, ready, radius]);

  // --- nearby places ---------------------------------------------------------
  useEffect(() => {
    if (!map || !ready) return;
    setSource(map, SRC_POIS, {
      type: "FeatureCollection",
      features: pois.map((p, i) => ({
        type: "Feature",
        id: i + 1,
        geometry: { type: "Point", coordinates: [p.longitude, p.latitude] },
        properties: { name: p.name, category: p.category },
      })),
    });
  }, [map, ready, pois]);

  return { airports, airportStatus, selectedAirport, setSelectedAirport, route, routeError };
}
