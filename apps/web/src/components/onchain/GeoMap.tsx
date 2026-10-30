"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Map as MapLibreMap, NavigationControl, setWorkerUrl, type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection, LineString, Point } from "geojson";
import world from "@/components/analytics/worldDots.json";
import { countryName, type Corridor } from "@/lib/onchain/corridors";
setWorkerUrl("/maplibre-gl-worker.mjs");
const centers = world.centroids as Record<string, number[]>;
const location = (c: string): [number, number] | null => centers[c] ? [centers[c][0] - 180, 84 - centers[c][1]] : null;

/** Local public-domain Natural Earth geometry; no external map tokens or tiles.
 * Country centroids are drawing anchors, never wallet coordinates. */
export default function GeoMap({ rows, globe, selected, onSelect }: { rows: Corridor[]; globe: boolean; selected: string; onSelect: (code: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const features = useMemo(() => {
    const max = Math.max(1, ...rows.map(r => r.volumeUsd));
    const routes: FeatureCollection<LineString> = { type: "FeatureCollection", features: [] };
    const nodes = new Set<string>();
    for (const r of rows) {
      const a = location(r.from), b = location(r.to);
      if (!a || !b) continue;
      nodes.add(r.from); nodes.add(r.to);
      // Follow the shorter longitude route across the antimeridian.
      const bx = a[0] + ((b[0] - a[0] + 540) % 360 - 180);
      const coords = Array.from({ length: 33 }, (_, i) => {
        const t = i / 32;
        return [a[0] + (bx - a[0]) * t, a[1] * (1 - t) + b[1] * t + Math.sin(Math.PI * t) * Math.min(16, Math.abs(bx - a[0]) / 8)];
      });
      routes.features.push({ type: "Feature", properties: { weight: r.volumeUsd / max }, geometry: { type: "LineString", coordinates: coords } });
    }
    const countries: FeatureCollection<Point> = { type: "FeatureCollection", features: [...nodes].map(code => ({ type: "Feature", properties: { code }, geometry: { type: "Point", coordinates: location(code)! } })) };
    return { routes, countries };
  }, [rows]);
  useEffect(() => {
    if (!host.current) return;
    let m: MapLibreMap;
    let observer: ResizeObserver | undefined;
    try {
      m = new MapLibreMap({ container: host.current, center: [10, 15], zoom: 0.6, minZoom: 0, maxZoom: 6, attributionControl: false,
        style: { version: 8, sources: { land: { type: "geojson", data: "/maps/countries-110m.json" } }, layers: [
          { id: "ocean", type: "background", paint: { "background-color": "#07121a" } },
          { id: "land", type: "fill", source: "land", paint: { "fill-color": "#12374b", "fill-opacity": 0.9 } },
          { id: "borders", type: "line", source: "land", paint: { "line-color": "#245569", "line-width": 0.5 } },
        ] } });
      map.current = m;
      m.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
      m.scrollZoom.disable();
      m.on("load", () => {
        m.addSource("routes", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        m.addSource("nodes", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        m.addLayer({ id: "routes-glow", type: "line", source: "routes", paint: { "line-color": "#12c9bc", "line-width": 5, "line-blur": 4, "line-opacity": 0.35 } });
        m.addLayer({ id: "routes", type: "line", source: "routes", paint: { "line-color": "#14b8e8", "line-width": ["interpolate", ["linear"], ["get", "weight"], 0, 0.6, 1, 2], "line-opacity": 0.85 } });
        m.addLayer({ id: "nodes", type: "circle", source: "nodes", paint: { "circle-radius": 4, "circle-color": "#19d99a", "circle-stroke-width": 1, "circle-stroke-color": "#a7ffdf" } });
        setReady(true);
      });
      m.on("click", "nodes", e => { const code = e.features?.[0]?.properties?.code; if (typeof code === "string") selectRef.current(code); });
      m.on("error", () => setFailed(true));
      observer = new ResizeObserver(() => m.resize());
      observer.observe(host.current);
    } catch { setFailed(true); }
    return () => { observer?.disconnect(); map.current?.remove(); map.current = null; };
  }, []);
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    (m.getSource("routes") as GeoJSONSource)?.setData(features.routes);
    (m.getSource("nodes") as GeoJSONSource)?.setData(features.countries);
    m.setProjection({ type: globe ? "globe" : "mercator" });
    const center = selected ? location(selected) : null;
    m.easeTo({ center: center ?? [10, 15], zoom: center ? 2 : globe ? 0 : 0.6, duration: 0 });
  }, [features, globe, selected, ready]);
  return <div className="relative h-full min-h-[240px] overflow-hidden rounded-[5px] border border-[#192b35]">
    <div ref={host} className="absolute inset-0" aria-label="Interactive country flow map. Drag to pan; use the zoom buttons. Country data is also available in the tables." />
    {failed && <div role="status" className="absolute inset-0 flex items-center justify-center bg-[#07121a] p-6 text-center text-xs text-[#9baebb]">Map rendering unavailable. Use the country and corridor tables alongside it.</div>}
    <span className="pointer-events-none absolute bottom-1 left-2 text-[9px] text-[#9baebb]">Natural Earth · Country centroids{selected ? " · " + countryName(selected) : ""}</span>
  </div>;
}
