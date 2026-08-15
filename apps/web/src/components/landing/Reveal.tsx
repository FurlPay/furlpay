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

/*
 * A grid whose children arrive in sequence rather than all at once.
 *
 * Sequence is the cue that separates choreography from a page that simply
 * fades in: six cards appearing together reads as one lazy block, the same six
 * arriving 60ms apart reads as deliberate. The stagger is capped rather than
 * multiplied without limit — by about the eighth item a linear ramp stops
 * looking like rhythm and starts looking like the page is struggling.
 */
export function RevealGroup({
  children,
  className = "",
  stagger = 60,
  maxDelay = 240,
}: {
  children: ReactNode[];
  className?: string;
  /** Gap between consecutive children, in ms. */
  stagger?: number;
  /** Ceiling for the ramp, so long lists do not trail off. */
  maxDelay?: number;
}) {
  return (
    <div className={className}>
      {children.map((child, i) => (
        <Reveal key={i} delay={Math.min(i * stagger, maxDelay)}>
          {child}
        </Reveal>
      ))}
    </div>
  );
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
