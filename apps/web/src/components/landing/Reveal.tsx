"use client";

import { useEffect, useRef, type ReactNode } from "react";

// Scroll reveal. One shared IntersectionObserver for the whole page (a landing
// page has ~30 revealed blocks; 30 observers is 30 sets of callbacks for no
// benefit), and each element is unobserved once it has appeared — the effect
// is one-way, so there is nothing to keep watching.
//
// The animation itself is a CSS transition on `.reveal`/`.is-in`, which the
// global prefers-reduced-motion rule collapses to ~0ms. Content is never
// hidden behind motion: the page's <noscript> block turns `.reveal` opaque.

let shared: IntersectionObserver | null = null;

function observer(): IntersectionObserver | null {
  if (typeof IntersectionObserver === "undefined") return null;
  shared ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-in");
        shared?.unobserve(entry.target);
      }
    },
    // Fire slightly before the block is fully on screen so the motion finishes
    // as the reader arrives rather than after.
    { rootMargin: "0px 0px -6% 0px", threshold: 0.06 }
  );
  return shared;
}

export default function Reveal({
  children,
  className = "",
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  /** Stagger, in ms. Keep under ~200 — longer reads as lag, not choreography. */
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = observer();
    if (!io) {
      el.classList.add("is-in");
      return;
    }
    io.observe(el);
    return () => io.unobserve(el);
  }, []);

  return (
    <div
      ref={ref}
      className={`reveal ${className}`.trim()}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
