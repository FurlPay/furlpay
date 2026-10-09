"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { MapPin, Pause, Play } from "lucide-react";
import { HERO_BACKDROP_INTERVAL_MS, HERO_MOBILE_QUERY, HERO_SLIDES, slideForDestination } from "@/lib/travel/heroSlides";

// The /travel hero's moving parts: which background photo is showing, the
// cross-fade between photos, and the location label. State lives in one small
// provider so the server-rendered headline, metrics and search form passed in
// as children never re-render or remount when the photo changes.

/** Cross-fade length; keep in step with the `hero-fade` keyframes. */
export const HERO_FADE_MS = 1200;
/** Start fetching the next photo this long before it is due. */
const PRELOAD_LEAD_MS = 1500;

type HeroMotion = {
  index: number;
  /** The visitor pressed pause. */
  paused: boolean;
  reducedMotion: boolean;
  togglePaused: () => void;
  /** Show the photo for a destination (manual trip navigation), if there is one. */
  showDestination: (destinationSlug: string) => void;
  markBroken: (index: number) => void;
};

const HeroMotionContext = createContext<HeroMotion | null>(null);
export const useHeroMotion = () => useContext(HeroMotionContext);

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [query]);
  return matches;
}

export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

// One load per URL for the page's lifetime; resolves false on a failed load.
const loads = new Map<string, Promise<boolean>>();
function preload(src: string): Promise<boolean> {
  let p = loads.get(src);
  if (!p) {
    p = new Promise<boolean>((resolve) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = src;
    });
    loads.set(src, p);
  }
  return p;
}
/** Tests only: forget every load result. */
export const resetHeroPreloadsForTests = () => loads.clear();
const srcFor = (i: number) => (window.matchMedia(HERO_MOBILE_QUERY).matches ? HERO_SLIDES[i].mobile : HERO_SLIDES[i].desktop);

export function HeroMotionProvider({ children }: { children: ReactNode }) {
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const visible = usePageVisible();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const broken = useRef(new Set<number>());
  const indexRef = useRef(index);
  indexRef.current = index;

  // Auto-advance: warm the next photo shortly before it is due, then switch
  // only once it has loaded, so a fade never reveals a half-drawn image. A
  // photo that fails to load is skipped from then on.
  useEffect(() => {
    if (reducedMotion || paused || !visible) return;
    const n = HERO_SLIDES.length;
    const order = Array.from({ length: n - 1 }, (_, k) => (index + 1 + k) % n).filter((j) => !broken.current.has(j));
    if (order.length === 0) return;
    let cancelled = false;
    const warm = window.setTimeout(() => void preload(srcFor(order[0])), HERO_BACKDROP_INTERVAL_MS - PRELOAD_LEAD_MS);
    const advance = window.setTimeout(async () => {
      for (const j of order) {
        const ok = await preload(srcFor(j));
        if (cancelled) return;
        if (ok) { setIndex(j); return; }
        broken.current.add(j);
      }
    }, HERO_BACKDROP_INTERVAL_MS);
    return () => { cancelled = true; window.clearTimeout(warm); window.clearTimeout(advance); };
  }, [index, paused, reducedMotion, visible]);

  const showDestination = useCallback((destinationSlug: string) => {
    const j = slideForDestination(destinationSlug);
    if (j < 0 || j === indexRef.current || broken.current.has(j)) return;
    void preload(srcFor(j)).then((ok) => {
      if (ok) setIndex(j);
      else broken.current.add(j);
    });
  }, []);
  const togglePaused = useCallback(() => setPaused((p) => !p), []);
  const markBroken = useCallback((i: number) => { broken.current.add(i); }, []);

  return (
    <HeroMotionContext.Provider value={{ index, paused, reducedMotion, togglePaused, showDestination, markBroken }}>
      {children}
    </HeroMotionContext.Provider>
  );
}

/**
 * The photo layers. At most two are mounted: the incoming photo fading in on
 * top of the outgoing one, which is removed once the fade completes. Layers
 * are kept in slide order and stacked by z-index, so the outgoing layer is
 * never moved in the DOM — moving it would restart its slow zoom mid-fade.
 */
export function HeroBackdrop() {
  const motion = useHeroMotion();
  const index = motion?.index ?? 0;
  const reduced = motion?.reducedMotion ?? false;
  const [layers, setLayers] = useState<{ current: number; previous: number | null }>({ current: index, previous: null });

  useEffect(() => {
    setLayers((l) => (l.current === index ? l : { current: index, previous: l.current }));
  }, [index]);
  useEffect(() => {
    if (layers.previous === null) return;
    const t = window.setTimeout(() => setLayers((l) => ({ ...l, previous: null })), reduced ? 0 : HERO_FADE_MS + 100);
    return () => window.clearTimeout(t);
  }, [layers, reduced]);

  const mounted = [layers.previous, layers.current].filter((i): i is number => i !== null).sort((a, b) => a - b);

  return (
    <div className="absolute inset-0 -z-10 overflow-hidden bg-[#030505]" aria-hidden>
      {mounted.map((i) => {
        const slide = HERO_SLIDES[i];
        const isCurrent = i === layers.current;
        return (
          <div
            key={slide.id}
            className={`absolute inset-0 ${isCurrent ? "z-[2]" : "z-[1]"} ${isCurrent && layers.previous !== null && !reduced ? "animate-hero-fade" : ""}`}
          >
            <picture>
              <source media={HERO_MOBILE_QUERY} srcSet={slide.mobile} />
              {/* eslint-disable-next-line @next/next/no-img-element -- pre-cropped WebP; the preloader warms these exact URLs */}
              <img
                src={slide.desktop}
                alt=""
                decoding="async"
                fetchPriority={i === 0 ? "high" : "auto"}
                onError={() => motion?.markBroken(i)}
                className={`h-full w-full object-cover ${reduced ? "" : "animate-ken-burns"}`}
              />
            </picture>
          </div>
        );
      })}
      {/* One overlay stack for every photo, so bright and dark scenes read the same. */}
      <div className="absolute inset-0 z-[3] bg-[#030505]/25" />
      {/* Mobile: vertical scrim keeps the photo visible above the copy. md+: left-to-right scrim behind the headline. */}
      <div className="absolute inset-0 z-[3] bg-gradient-to-b from-[#030505]/35 via-[#030505]/75 to-[#030505] md:bg-gradient-to-r md:from-[#030505]/95 md:via-[#030505]/60 md:to-[#030505]/0" />
      <div className="absolute inset-0 z-[3] hidden bg-gradient-to-t from-[#030505] via-transparent to-[#030505]/50 md:block" />
      {/* A faint emerald floor where the hero meets the search panel. */}
      <div className="absolute inset-x-0 bottom-0 z-[3] h-1/3 bg-gradient-to-t from-[#00e599]/[0.07] to-transparent" />
    </div>
  );
}

/** "Santorini, Greece" label for the current photo, plus pause/play for the rotation. */
export function HeroLocationChip({ className = "" }: { className?: string }) {
  const motion = useHeroMotion();
  if (!motion) return null;
  const slide = HERO_SLIDES[motion.index];
  return (
    <div className={`items-center gap-2 ${className}`}>
      <span className="flex items-center gap-1.5 rounded-full border border-white/15 bg-black/40 px-3 py-1.5 text-[11px] text-white/85 backdrop-blur">
        <MapPin className="h-3.5 w-3.5" aria-hidden />
        <span>
          <span className="sr-only">Background photo: </span>
          {slide.place}, {slide.country}
        </span>
      </span>
      {!motion.reducedMotion && (
        <button
          type="button"
          onClick={motion.togglePaused}
          aria-pressed={motion.paused}
          aria-label={motion.paused ? "Play background photos" : "Pause background photos"}
          className="flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-black/40 text-white/80 backdrop-blur transition hover:border-white/40 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-neon"
        >
          {motion.paused ? <Play className="h-3 w-3" aria-hidden /> : <Pause className="h-3 w-3" aria-hidden />}
        </button>
      )}
    </div>
  );
}
