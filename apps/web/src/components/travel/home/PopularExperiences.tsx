import Link from "next/link";
import { EXPERIENCES } from "@/lib/travel/home";
import { CardArrow, ScrollRow, SectionHeader } from "./parts";

/** Six signature experiences. Each opens the activities search for its city,
 *  where live availability and prices are shown — so no price is printed
 *  here. */
export default function PopularExperiences() {
  return (
    <section aria-labelledby="exp-title">
      <SectionHeader id="exp-title" title="Popular experiences" href="/travel/activities" linkLabel="View all experiences" />
      <ScrollRow label="Experiences" className="lg:grid lg:grid-cols-6 lg:overflow-visible">
        {EXPERIENCES.map((e) => (
          <Link
            key={e.title}
            role="listitem"
            href={`/travel/activities?city=${encodeURIComponent(e.city)}`}
            className="group relative h-[160px] w-[58vw] max-w-[240px] shrink-0 snap-start overflow-hidden rounded-[14px] border border-white/[0.08] transition duration-300 hover:-translate-y-0.5 hover:border-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-neon sm:w-[220px] lg:w-auto lg:max-w-none"
          >
            <img src={e.photo} alt={e.title} loading="lazy" className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/25 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-3">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold text-white">{e.title}</p>
                <p className="truncate text-[11px] text-white/60">{e.place}</p>
                <p className="mt-1 text-[11px] font-medium text-neon">See times & prices</p>
              </div>
              <CardArrow />
            </div>
          </Link>
        ))}
      </ScrollRow>
    </section>
  );
}
