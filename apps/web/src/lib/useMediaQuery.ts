"use client";

import { useEffect, useState } from "react";

/**
 * Subscribe to a CSS media query from JS.
 *
 * Returns `false` on the server and on the first client render, then the real
 * value once mounted. Use it only where BOTH branches would be expensive to
 * render at once — a Tailwind `lg:` class is cheaper and has no hydration
 * caveat, so reach for that first.
 *
 * The case this exists for is the ticker page: rendering the phone layout and
 * the desktop layout together would mount two `PriceChart`s, and each one
 * instantiates a lightweight-charts canvas and fetches its own OHLC history.
 * Hiding one with `hidden lg:block` hides the pixels, not the work.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** The `lg` breakpoint, where the ticker page becomes two columns. Kept in one
 *  place so the JS switch and the Tailwind classes cannot drift apart. */
export const DESKTOP_QUERY = "(min-width: 1024px)";
