"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarDays, ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import { HERO_CAROUSEL_INTERVAL_MS } from "@/lib/travel/heroSlides";
import { useHeroMotion, useMediaQuery, usePageVisible } from "./HeroMotion";

export interface HeroTrip {
  slug: string;
  title: string;
  city: string;
  destinationSlug: string;
  summary: string;
  style: string;
  days: number;
  budgetUsd: number;
  stops: number;
  photo: string;
}

const SLIDE_MS = 650;

function focusVisible(el: Element): boolean {
  try { return el.matches(":focus-visible"); } catch { return true; } // no :focus-visible support: treat as keyboard
}

/** The "popular trip" carousel over the hero photo. It cycles the real
 *  bookable itineraries (lib/travel/discover.ts); the price is the
 *  itinerary's own per-person budget, excluding flights, and says so.
 *
 *  Cards glide right-to-left every 5 s. The track holds every trip plus a
 *  copy of the first at the end: sliding onto the copy and then snapping
 *  (without a transition) back to the real first card makes the loop
 *  seamless. Autoplay pauses on hover, keyboard focus, a hidden tab and
 *  reduced motion; manual navigation restarts the 5 s clock and shows the
 *  trip's destination behind the hero.
 *
 *  Keyboard: ←/→ move between trips when focus is inside the carousel. */
export default function HeroTripCard({ trips, fluid = false }: { trips: HeroTrip[]; fluid?: boolean }) {
  const n = trips.length;
  const motion = useHeroMotion();
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const visible = usePageVisible();
  const [pos, setPos] = useState(0); // 0..n, where n is the copy of trip 0
  const [animate, setAnimate] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const queued = useRef<number | null>(null);
  const active = n ? pos % n : 0;

  // After an instant snap, re-enable the transition on the next frame (and
  // run a move that was waiting for the snap, i.e. "previous" from trip 1).
  useEffect(() => {
    if (animate) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        setAnimate(true);
        if (queued.current !== null) { setPos(queued.current); queued.current = null; }
      });
    });
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
  }, [animate]);

  const next = useCallback(() => {
    if (reduced) { setPos((p) => (p + 1) % n); return; }
    setAnimate(true);
    setPos((p) => Math.min(p + 1, n));
  }, [n, reduced]);
  const prev = useCallback(() => {
    if (reduced) { setPos((p) => (p - 1 + n) % n); return; }
    if (pos > 0) { setAnimate(true); setPos(pos - 1); return; }
    // On trip 1: jump (invisibly) to its copy at the end, then slide back.
    queued.current = n - 1;
    setAnimate(false);
    setPos(n);
  }, [n, pos, reduced]);

  // Autoplay. Keyed on pos, so any move — manual or automatic — restarts the clock.
  const playing = n > 1 && !reduced && !hovered && !focused && visible && !(motion?.paused ?? false);
  useEffect(() => {
    if (!playing) return;
    const t = window.setTimeout(next, HERO_CAROUSEL_INTERVAL_MS);
    return () => window.clearTimeout(t);
  }, [playing, pos, next]);

  if (n === 0) return null;
  const manual = (move: () => void, targetIndex: number) => {
    move();
    motion?.showDestination(trips[targetIndex].destinationSlug);
  };
  const t = trips[active];
  const slides = n > 1 ? [...trips, trips[0]] : trips;

  return (
    <div
      role="region"
      aria-roledescription="carousel"
      aria-label="Popular trips"
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") { e.preventDefault(); manual(next, (active + 1) % n); }
        else if (e.key === "ArrowLeft") { e.preventDefault(); manual(prev, (active - 1 + n) % n); }
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      // Keyboard focus pauses autoplay; a mouse click on an arrow or dot must not
      // freeze it until the visitor happens to click elsewhere.
      onFocus={(e) => setFocused(focusVisible(e.target))}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false); }}
      className={fluid ? "w-full" : "w-[300px] lg:w-[340px]"}
    >
      <div className="overflow-hidden rounded-2xl border border-white/15 bg-[rgba(5,8,9,0.78)] shadow-[0_24px_60px_-20px_rgba(0,0,0,0.85)] backdrop-blur-[18px]">
        <div
          className="flex"
          style={{
            transform: `translateX(-${pos * 100}%)`,
            transition: animate && !reduced ? `transform ${SLIDE_MS}ms cubic-bezier(0.22, 0.61, 0.36, 1)` : "none",
          }}
          onTransitionEnd={(e) => {
            if (e.target !== e.currentTarget || e.propertyName !== "transform") return;
            if (pos === n) { setAnimate(false); setPos(0); }
          }}
        >
          {slides.map((trip, k) => {
            const isActive = k === pos;
            // Load the card on screen and its neighbours; the rest wait.
            const near = Math.abs(k - pos) <= 1 || (pos === n - 1 && k === 0);
            return (
              <article
                key={`${trip.slug}-${k}`}
                aria-roledescription="slide"
                aria-label={`${(k % n) + 1} of ${n}: ${trip.title}`}
                aria-hidden={!isActive || undefined}
                // Off-screen cards are unreachable by Tab. Set as a DOM property:
                // React 18 does not pass the `inert` attribute through.
                ref={(el) => { if (el) el.inert = !isActive; }}
                className="group relative w-full shrink-0"
              >
                <div className={`relative overflow-hidden ${fluid ? "h-[170px]" : "h-[150px] lg:h-[170px]"}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- small self-hosted card photo */}
                  <img
                    src={trip.photo}
                    alt={trip.city}
                    loading={near ? "eager" : "lazy"}
                    decoding="async"
                    className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[rgba(5,8,9,0.95)] via-transparent to-transparent" />
                  <span className="absolute left-3 top-3 rounded-full bg-[#FF5C7A] px-2.5 py-0.5 text-[10px] font-semibold text-white shadow">Popular</span>
                  <span className="absolute left-[74px] top-3 rounded-full border border-white/15 bg-black/45 px-2 py-0.5 text-[10px] font-medium text-white/85 backdrop-blur">
                    {trip.style}
                  </span>
                  <span className="absolute right-3 top-3 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white/85 backdrop-blur" aria-hidden>
                    {(k % n) + 1} / {n}
                  </span>
                </div>
                <div className="relative -mt-8 px-4 pb-4">
                  <p className="line-clamp-2 min-h-[40px] pr-11 text-[15px] font-semibold leading-snug text-white">{trip.title}</p>
                  <p className="mt-1 line-clamp-2 min-h-[32px] text-[11.5px] leading-snug text-white/60">{trip.summary}</p>
                  <p className="mt-2 text-[13px] text-white/80">
                    from <span className="text-[17px] font-bold text-white">${trip.budgetUsd.toLocaleString("en-US")}</span>
                    <span className="text-[11px] text-white/50"> pp · excl. flights</span>
                  </p>
                  <p className="mt-2 flex items-center gap-3 text-[11px] text-white/55">
                    <span className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" aria-hidden /> {trip.days} days</span>
                    <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" aria-hidden /> {trip.stops} stops planned</span>
                  </p>
                  <Link
                    href={`/travel/itineraries/${trip.slug}`}
                    aria-label={`Open itinerary: ${trip.title}`}
                    className="absolute right-4 top-1 flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white transition hover:border-neon hover:text-neon focus-visible:outline focus-visible:outline-2 focus-visible:outline-neon"
                  >
                    <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      </div>
      {n > 1 && (
        <div className="mt-3 flex items-center gap-2">
          <button type="button" onClick={() => manual(prev, (active - 1 + n) % n)} aria-label="Previous trip" className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/50 text-white backdrop-blur transition hover:border-white/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-neon md:h-8 md:w-8">
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <button type="button" onClick={() => manual(next, (active + 1) % n)} aria-label="Next trip" className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/50 text-white backdrop-blur transition hover:border-white/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-neon md:h-8 md:w-8">
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
          {/* Announced only while the visitor is driving it; autoplay stays quiet. */}
          <span className="sr-only" aria-live={hovered || focused ? "polite" : "off"}>
            Trip {active + 1} of {n}: {t.title}
          </span>
          <span className="ml-1 flex items-center">
            {trips.map((x, i) => (
              <button
                key={x.slug}
                type="button"
                onClick={() => { if (i !== active) manual(() => { setAnimate(!reduced); setPos(i); }, i); }}
                aria-label={`Show trip ${i + 1}: ${x.title}`}
                aria-current={i === active ? "true" : undefined}
                className="flex h-6 items-center px-[3px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-neon"
              >
                <span className={`block h-1 rounded-full transition-all ${i === active ? "w-4 bg-neon" : "w-1.5 bg-white/30"}`} />
              </button>
            ))}
          </span>
        </div>
      )}
    </div>
  );
}
