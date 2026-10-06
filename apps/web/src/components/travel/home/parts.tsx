"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";

export function SectionHeader({ title, icon, href, linkLabel, id }: { title: string; icon?: ReactNode; href?: string; linkLabel?: string; id?: string }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <h2 id={id} className="flex items-center gap-2 text-[22px] font-bold tracking-tight text-white sm:text-[24px]">
        {icon}
        {title}
      </h2>
      {href && linkLabel && (
        <Link href={href} className="group flex shrink-0 items-center gap-1 text-[12px] font-medium text-neon hover:brightness-125 focus-visible:outline focus-visible:outline-2 focus-visible:outline-neon">
          {linkLabel} <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" aria-hidden />
        </Link>
      )}
    </div>
  );
}

/** The circular arrow at a card's bottom-right. Decorative inside a link card. */
export function CardArrow() {
  return (
    <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/25 bg-black/30 text-white backdrop-blur transition group-hover:border-neon group-hover:text-neon">
      <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
    </span>
  );
}

/** A card row: a grid on wide screens, a snap-scrolling strip below `lg`,
 *  with prev/next buttons whenever the strip actually overflows. */
export function ScrollRow({ children, label, className = "" }: { children: ReactNode; label: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setEdges({ start: el.scrollLeft <= 2, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 });
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);

  const by = (d: number) => ref.current?.scrollBy({ left: d * ref.current.clientWidth * 0.8, behavior: "smooth" });

  return (
    <div className="relative">
      <div ref={ref} role="list" aria-label={label} className={`no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pb-1 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0 ${className}`}>
        {children}
      </div>
      {!edges.start && (
        <button type="button" onClick={() => by(-1)} aria-label={`Scroll ${label} back`} className="absolute -left-4 top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-[#0B0F10]/95 text-white shadow-lg transition hover:border-neon lg:flex">
          <ChevronLeft className="h-4 w-4" />
        </button>
      )}
      {!edges.end && (
        <button type="button" onClick={() => by(1)} aria-label={`Scroll ${label} forward`} className="absolute -right-4 top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-[#0B0F10]/95 text-white shadow-lg transition hover:border-neon lg:flex">
          <ChevronRight className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
