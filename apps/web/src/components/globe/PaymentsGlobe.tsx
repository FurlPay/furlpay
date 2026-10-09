"use client";

import { useEffect, useRef, useState } from "react";
import createGlobe, { type Arc, type Marker } from "cobe";
import { CITIES, ROUTES, greatCirclePoint, routeEnds } from "./globeData";
import GlobeFallback from "./GlobeFallback";

// The one WebGL globe (COBE 2: ~5 KB, no dependencies, dotted continents from a
// real world map, native arcs). The partnership hero and the inquiry modal both
// render this component; nothing else creates a WebGL context for a globe.
//
// COBE 2 has no render loop of its own: every frame here is one update() call.
// That loop runs only while the canvas is on screen and the tab is visible, is
// skipped entirely under prefers-reduced-motion (one static frame instead), and
// is torn down with the WebGL context on unmount. React state changes only for
// the loading → ready/fallback transition — never per frame.
//
// The routes are illustrative city pairs (see globeData.ts), not FurlPay flows.

const ROTATION_SECONDS = 120; // one full turn
const PULSE_SECONDS = 2.6; // a light packet's trip along one route
const EMERALD: [number, number, number] = [0, 0.96, 0.69];
const ARC_DIM: [number, number, number] = [0.0, 0.55, 0.41];

/** COBE's convention for centring a [lat, lon] under the viewer. */
export function anglesFor(lat: number, lon: number): [number, number] {
  return [Math.PI - ((lon * Math.PI) / 180 - Math.PI / 2), (lat * Math.PI) / 180];
}

function webglAvailable(c: HTMLCanvasElement): boolean {
  try {
    return Boolean(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

type Props = {
  className?: string;
  /** Longitude/latitude to face first. Defaults to the Gulf–India–Singapore band. */
  center?: [number, number];
  /** Drag to rotate (pointer). Never captures vertical scrolling on touch. */
  interactive?: boolean;
  paused?: boolean;
  minViewportWidth?: number;
  label?: string;
};

export default function PaymentsGlobe({ className, center = [18, 70], interactive = true, paused = false, minViewportWidth = 0, label = "Globe with illustrative routes between world cities" }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"loading" | "ready" | "fallback">("loading");
  const [largeEnough, setLargeEnough] = useState(false);
  const [lat, lon] = center;

  useEffect(() => {
    const media = window.matchMedia(`(min-width: ${minViewportWidth}px)`);
    const change = () => setLargeEnough(media.matches);
    change(); media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, [minViewportWidth]);

  useEffect(() => {
    const wrap = wrapRef.current, host = hostRef.current;
    if (!wrap || !host || paused || !largeEnough) { setMode("fallback"); return; }
    setMode("loading");
    // COBE wraps its canvas in a div it inserts itself, so the canvas must not be
    // a React-rendered node (React would later try to remove it from a parent it
    // no longer has). React renders `host` empty; everything inside is ours.
    const canvas = document.createElement("canvas");
    if (!webglAvailable(canvas)) { setMode("fallback"); return; }
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.cssText = `width:100%;height:100%;display:block;cursor:${interactive ? "grab" : "default"};touch-action:pan-y`;
    host.appendChild(canvas);

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduce = motion.matches;
    const cssSize = () => Math.max(120, Math.round(wrap.clientWidth));
    let size = cssSize();
    const lowPower = (navigator.hardwareConcurrency ?? 8) <= 4 || size < 420;
    const dpr = Math.min(window.devicePixelRatio || 1, lowPower ? 1.5 : 2);
    const [phi0, theta0] = anglesFor(lat, lon);
    const routes = ROUTES.map(routeEnds);
    const cityMarkers = (pulse: number[]): Marker[] =>
      CITIES.map((c, i) => ({ location: c.location, size: 0.028 + 0.02 * (pulse[i] ?? 0) }));

    let globe: ReturnType<typeof createGlobe>;
    try {
      globe = createGlobe(canvas, {
        devicePixelRatio: dpr,
        width: size,
        height: size,
        phi: phi0,
        theta: theta0 * 0.6,
        dark: 1,
        diffuse: 1.4,
        mapSamples: lowPower ? 9000 : 18000,
        mapBrightness: 7,
        mapBaseBrightness: 0.02,
        baseColor: [0.015, 0.23, 0.13],
        markerColor: EMERALD,
        glowColor: [0.02, 0.32, 0.22],
        arcColor: ARC_DIM,
        arcWidth: 0.8,
        arcHeight: 0.22,
        markerElevation: 0.01,
        markers: cityMarkers([]),
        arcs: routes.map(([from, to]) => ({ from, to })),
        scale: 1,
      });
    } catch {
      host.replaceChildren();
      setMode("fallback");
      return;
    }

    let raf = 0, onScreen = false, pageVisible = !document.hidden, dragging = false, lastX = 0, dragPhi = 0;
    let failed = false, lastFrame = 0, elapsed = 0;
    const cityIndex = new Map(CITIES.map((c, i) => [c.id, i]));

    const frame = () => {
      if (failed) return;
      const t = elapsed / 1000;
      const phi = phi0 + (reduce ? 0 : (t / ROTATION_SECONDS) * Math.PI * 2) + dragPhi;
      // One route at a time carries a packet; the others stay dim. Arrival brightens the destination city.
      const active = Math.floor(t / PULSE_SECONDS) % routes.length;
      const progress = (t % PULSE_SECONDS) / PULSE_SECONDS;
      const arcs: Arc[] = routes.map(([from, to], i) => {
        const glow = i === active ? 0.35 + 0.65 * Math.sin(Math.PI * progress) : 0;
        return { from, to, color: [ARC_DIM[0] + (EMERALD[0] - ARC_DIM[0]) * glow, ARC_DIM[1] + (EMERALD[1] - ARC_DIM[1]) * glow, ARC_DIM[2] + (EMERALD[2] - ARC_DIM[2]) * glow] };
      });
      const pulse: number[] = [];
      const dest = cityIndex.get(ROUTES[active][1]);
      if (dest !== undefined) pulse[dest] = progress > 0.8 ? (progress - 0.8) / 0.2 : 0;
      const breathe = 0.5 + 0.5 * Math.sin(t * 1.3);
      const markers = cityMarkers(CITIES.map((_, i) => (pulse[i] ?? 0) + 0.25 * breathe * (i % 2)));
      const [from, to] = routes[active];
      for (const lag of [0, 0.04, 0.08]) {
        const p = progress - lag;
        if (p > 0 && p < 1) markers.push({ location: greatCirclePoint(from, to, p), size: 0.014 - lag * 0.08, color: [0.6, 1, 0.85] });
      }
      globe.update({ phi, theta: theta0 * 0.6, arcs, markers });
    };

    const loop = (now: number) => {
      if (failed || !onScreen || !pageVisible || reduce) { raf = 0; lastFrame = 0; return; }
      if (!lastFrame || now - lastFrame >= 1000 / 30) {
        elapsed += lastFrame ? Math.min(now - lastFrame, 100) : 0;
        lastFrame = now; frame();
      }
      raf = requestAnimationFrame(loop);
    };
    const stop = () => { cancelAnimationFrame(raf); raf = 0; lastFrame = 0; };
    const resume = () => { if (!failed && !raf && onScreen && pageVisible && !reduce) raf = requestAnimationFrame(loop); };

    frame();
    setMode("ready");
    resume();

    const io = new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; if (onScreen) resume(); else stop(); });
    io.observe(wrap);
    const onVisibility = () => { pageVisible = !document.hidden; if (pageVisible) resume(); else stop(); };
    document.addEventListener("visibilitychange", onVisibility);
    const onMotion = () => { reduce = motion.matches; if (reduce) { stop(); frame(); } else resume(); };
    motion.addEventListener("change", onMotion);
    const ro = new ResizeObserver(() => {
      const next = cssSize();
      if (!failed && next !== size) { size = next; globe.update({ width: size, height: size }); if (reduce || !raf) frame(); }
    });
    ro.observe(wrap);
    const onLost = (e: Event) => { e.preventDefault(); failed = true; stop(); setMode("fallback"); };
    canvas.addEventListener("webglcontextlost", onLost);

    const down = (e: PointerEvent) => { if (!interactive || e.pointerType === "touch" || e.button !== 0) return; dragging = true; lastX = e.clientX; canvas.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => { if (!dragging) return; dragPhi += (e.clientX - lastX) / 200; lastX = e.clientX; if (reduce) frame(); };
    const up = () => { dragging = false; };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("lostpointercapture", up);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      motion.removeEventListener("change", onMotion);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("lostpointercapture", up);
      globe.destroy();
      // Release the GPU context now rather than whenever the canvas is collected.
      try {
        const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as WebGLRenderingContext | null;
        gl?.getExtension("WEBGL_lose_context")?.loseContext();
      } catch { /* already gone */ }
      host.replaceChildren();
    };
    // Primitives, not the array: a fresh default array each render would tear the context down.
  }, [lat, lon, interactive, paused, largeEnough]);

  return (
    <div ref={wrapRef} className={`relative aspect-square w-full ${className ?? ""}`} role="img" aria-label={label}>
      <div className="absolute inset-0" hidden={mode === "ready"}><GlobeFallback /></div>
      <div ref={hostRef} className="relative h-full w-full" style={{ opacity: mode === "ready" ? 1 : 0 }} />
    </div>
  );
}
