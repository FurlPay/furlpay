"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { VIBES, destinationsForVibe, type Vibe } from "@/lib/travel/home";
import { CardArrow, ScrollRow, SectionHeader } from "./parts";

/** Vibe filters over the destination guides. Each card opens that
 *  destination's guide; the figure is the guide's own average hotel rate. */
export default function ExploreByVibe() {
  const [vibe, setVibe] = useState<Vibe>("For you");
  const list = useMemo(() => destinationsForVibe(vibe), [vibe]);

  return (
    <section aria-labelledby="vibe-title">
      <SectionHeader id="vibe-title" title="Explore by vibe" href="/travel/destinations" linkLabel="View all destinations" />

      <div role="tablist" aria-label="Filter destinations by vibe" className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0">
        {VIBES.map((v) => (
          <button
            key={v}
            role="tab"
            type="button"
            aria-selected={vibe === v}
            onClick={() => setVibe(v)}
            className={`h-8 shrink-0 rounded-full border px-4 text-[12px] font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-neon ${
              vibe === v
                ? "border-neon bg-neon/10 text-white shadow-[0_0_16px_-6px_rgba(0,229,153,0.7)]"
                : "border-white/[0.08] bg-white/[0.02] text-white/70 hover:border-white/25 hover:text-white"
            }`}
          >
            {v}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <p className="rounded-2xl border border-white/[0.08] bg-[#090D0E] px-5 py-10 text-center text-[13px] text-white/60">
          No destinations tagged “{vibe}” yet. <Link href="/travel/destinations" className="text-neon hover:underline">Browse them all</Link>.
        </p>
      ) : (
        <ScrollRow label={`${vibe} destinations`} className="lg:grid lg:grid-cols-6 lg:overflow-visible">
          {list.slice(0, 12).map((d) => (
            <Link
              key={d.slug}
              role="listitem"
              href={`/travel/destinations/${d.slug}`}
              className="group relative h-[200px] w-[58vw] max-w-[240px] shrink-0 snap-start overflow-hidden rounded-[14px] border border-white/[0.08] transition duration-300 hover:-translate-y-0.5 hover:border-white/25 hover:shadow-[0_12px_30px_-12px_rgba(0,229,153,0.35)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-neon sm:w-[220px] lg:h-[200px] lg:w-auto lg:max-w-none"
            >
              <img src={d.photo} alt={`${d.name}, ${d.country}`} loading="lazy" className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-3">
                <p className="text-[15px] font-semibold text-white">{d.name}</p>
                <p className="mt-0.5 truncate text-[11px] text-white/65">{d.highlights.join(" • ")}</p>
                <div className="mt-2 flex items-end justify-between">
                  <p className="text-[11px] text-white/60">
                    avg <span className="text-[14px] font-bold text-white">${d.avgHotelUsd}</span>/night
                  </p>
                  <CardArrow />
                </div>
              </div>
            </Link>
          ))}
        </ScrollRow>
      )}
    </section>
  );
}
