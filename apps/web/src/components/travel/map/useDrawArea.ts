"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
import { MAX_VERTICES, isSimpleRing, rectangleRing, type Ring } from "@/lib/hotels/drawArea";
import { SRC_DRAW } from "./overlays";

// Draw-to-search, without a drawing library.
//
// @mapbox/mapbox-gl-draw targets Mapbox GL and is not maintained against
// MapLibre v6; for two shapes the interaction is small enough to own:
//
//   polygon    click to add points; double-click, click the first point, or
//              "Finish" to close it. Max 40 points.
//   rectangle  click one corner, then the opposite corner — two taps, so it
//              works the same with a finger as with a mouse.
//
// While drawing, the hotel map's own click/hover handlers stand down (the
// caller checks `drawingRef`), double-click zoom is off, and Escape cancels.

export type DrawMode = "polygon" | "rectangle";

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

function setDraw(m: MapLibreMap, data: GeoJSON.FeatureCollection) {
  (m.getSource(SRC_DRAW) as GeoJSONSource | undefined)?.setData(data);
}

export function ringFeatures(ring: Ring, cursor?: [number, number], closed = false): GeoJSON.FeatureCollection {
  const feats: GeoJSON.Feature[] = ring.map((c) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: c } }));
  if (closed && ring.length >= 3) {
    feats.push({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...ring, ring[0]]] } });
  } else if (ring.length) {
    const line = cursor ? [...ring, cursor] : ring;
    if (line.length >= 2) feats.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: line } });
  }
  return { type: "FeatureCollection", features: feats };
}

export function useDrawArea({
  map,
  ready,
  area,
  onComplete,
}: {
  map: MapLibreMap | null;
  ready: boolean;
  /** The finished area to show when not drawing. */
  area: Ring | null;
  onComplete: (ring: Ring) => void;
}) {
  const [mode, setMode] = useState<DrawMode | null>(null);
  const [count, setCount] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const ring = useRef<Ring>([]);
  /** Read by the hotel map's handlers so they stand down while drawing. */
  const drawingRef = useRef(false);
  drawingRef.current = mode !== null;
  const complete = useRef(onComplete);
  complete.current = onComplete;

  const reset = useCallback(() => {
    ring.current = [];
    setCount(0);
    setProblem(null);
  }, []);

  const cancel = useCallback(() => {
    setMode(null);
    reset();
  }, [reset]);

  const finish = useCallback(() => {
    const r = ring.current;
    if (r.length < 3) {
      setProblem("Add at least three points.");
      return;
    }
    if (!isSimpleRing(r)) {
      setProblem("The outline crosses itself — clear and draw it again.");
      return;
    }
    setMode(null);
    reset();
    complete.current(r);
  }, [reset]);

  // Show the finished area whenever not drawing.
  useEffect(() => {
    if (!map || !ready || mode) return;
    setDraw(map, area ? ringFeatures(area, undefined, true) : EMPTY);
  }, [map, ready, area, mode]);

  useEffect(() => {
    if (!map || !ready || !mode) return;
    reset();
    setDraw(map, EMPTY);
    map.doubleClickZoom.disable();
    map.getCanvas().style.cursor = "crosshair";

    const onClick = (e: MapMouseEvent) => {
      const pt: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      const r = ring.current;
      if (mode === "rectangle") {
        if (!r.length) {
          ring.current = [pt];
          setCount(1);
          return;
        }
        const rect = rectangleRing(
          { longitude: r[0][0], latitude: r[0][1] },
          { longitude: pt[0], latitude: pt[1] }
        );
        ring.current = rect;
        finish();
        return;
      }
      // Polygon: a click on (or very near) the first point closes it.
      if (r.length >= 3) {
        const first = map.project(r[0]);
        if (Math.hypot(first.x - e.point.x, first.y - e.point.y) < 12) {
          finish();
          return;
        }
      }
      if (r.length >= MAX_VERTICES) {
        setProblem(`Up to ${MAX_VERTICES} points — finish the shape.`);
        return;
      }
      ring.current = [...r, pt];
      setCount(ring.current.length);
      setProblem(null);
      setDraw(map, ringFeatures(ring.current));
    };
    const onMove = (e: MapMouseEvent) => {
      const r = ring.current;
      if (!r.length) return;
      const cur: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      if (mode === "rectangle") {
        const rect = rectangleRing({ longitude: r[0][0], latitude: r[0][1] }, { longitude: cur[0], latitude: cur[1] });
        setDraw(map, ringFeatures(rect, undefined, true));
      } else setDraw(map, ringFeatures(r, cur));
    };
    const onDbl = (e: MapMouseEvent) => {
      e.preventDefault();
      if (mode === "polygon") finish();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    map.on("click", onClick);
    map.on("mousemove", onMove);
    map.on("dblclick", onDbl);
    window.addEventListener("keydown", onKey);
    return () => {
      map.off("click", onClick);
      map.off("mousemove", onMove);
      map.off("dblclick", onDbl);
      window.removeEventListener("keydown", onKey);
      map.doubleClickZoom.enable();
      map.getCanvas().style.cursor = "";
    };
  }, [map, ready, mode, reset, finish, cancel]);

  return { mode, start: setMode, cancel, finish, count, problem, drawingRef };
}
