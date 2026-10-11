"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BadgeCheck, Flame, Search } from "lucide-react";
import type { Deal } from "@/lib/travel/data";
import { FEATURED_STAYS } from "@/lib/travel/home";
import { CardArrow, ScrollRow, SectionHeader } from "./parts";

type DealsState = { kind: "loading" } | { kind: "live"; deals: Deal[] } | { kind: "none" };

/** "Today's top deals" — only when /api/travel/deals returns live deals.
 *
 * A deal is a struck-out price someone acts on, and the API has no live rate
 * to discount from (it returns `deals: []`, source "unavailable"). Until it
 * does, this section shows the same four neighbourhoods as FEATURED stays:
 * same cards, no invented discount, each opening a live rate search. */
export default function FeaturedStays() {
  const [state, setState] = useState<DealsState>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    fetch("/api/travel/deals")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: { deals?: Deal[] }) => live && setState(d.deals?.length ? { kind: "live", deals: d.deals } : { kind: "none" }))
      .catch(() => live && setState({ kind: "none" }));
    return () => {
      live = false;
    };
  }, []);

  const hasDeals = state.kind === "live";

  return (
    <section aria-labelledby="deals-title" aria-busy={state.kind === "loading"}>
      <SectionHeader
        id="deals-title"
        title={hasDeals ? "Today's top deals" : "Featured stays"}
        icon={<Flame className="h-5 w-5 text-orange-500" aria-hidden />}
        href={hasDeals ? "/travel/deals" : "/travel/stays"}
        linkLabel={hasDeals ? "View all deals" : "Search all stays"}
      />

      {state.kind === "loading" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((n) => (
            <div key={n} className="h-[262px] animate-pulse rounded-[14px] bg-white/[0.04]" />
          ))}
        </div>
      ) : (
        <ScrollRow label={hasDeals ? "Deals" : "Featured stays"} className="lg:grid lg:grid-cols-4 lg:overflow-visible">
          {hasDeals
            ? state.deals.slice(0, 8).map((d) => <DealCard key={d.id} deal={d} />)
            : FEATURED_STAYS.map((s) => (
                <Link
                  key={s.title}
                  role="listitem"
                  href={`/travel/stays?city=${encodeURIComponent(s.city)}`}
                  className={CARD}
                >
                  <div className="relative h-[150px] overflow-hidden">
                    <img src={s.photo} alt={s.title} loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]" />
                    <span className="absolute bottom-2 left-2 flex items-center gap-1 rounded-full bg-black/65 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
                      <Search className="h-3 w-3" aria-hidden /> Live rates
                    </span>
                  </div>
                  <div className="p-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[14px] font-semibold text-white">{s.title}</p>
                        <p className="text-[12px] text-white/55">{s.area}</p>
                      </div>
                      <span className="shrink-0 rounded-full border border-neon/40 bg-neon/10 px-2 py-0.5 text-[10px] font-semibold text-neon">USDC · SOL · BTC</span>
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <span className="flex items-center gap-1 text-[11px] text-white/55">
                        <BadgeCheck className="h-3.5 w-3.5 text-neon" aria-hidden /> Cancellation terms shown per room
                      </span>
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

const CARD =
  "group w-[78vw] max-w-[300px] shrink-0 snap-start overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#090D0E] transition duration-300 hover:-translate-y-0.5 hover:border-white/20 hover:shadow-[0_12px_30px_-12px_rgba(0,229,153,0.3)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-neon sm:w-[280px] lg:w-auto lg:max-w-none";

/** A live deal, as the API returns it. Only rendered when deals exist. */
function DealCard({ deal: d }: { deal: Deal }) {
  const was = Math.round(d.nightlyUsd / (1 - d.discountPct / 100));
  return (
    <Link
      role="listitem"
      href={`/travel/checkout?kind=stay&ref=${d.id}&name=${encodeURIComponent(d.name)}&amount=${d.nightlyUsd}&nights=1&img=${encodeURIComponent(d.photo)}`}
      className={CARD}
    >
      <div className="relative h-[150px] overflow-hidden">
        <img src={d.photo} alt={`${d.name}, ${d.city}`} loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]" />
        <span className="absolute bottom-2 left-2 rounded-full bg-[#FF4B4B] px-2 py-0.5 text-[10px] font-bold text-white">{d.discountPct}% OFF</span>
      </div>
      <div className="p-3.5">
        <p className="truncate text-[14px] font-semibold text-white">{d.name} · {d.stars}★</p>
        <p className="text-[12px] text-white/55">{d.city}, {d.country}</p>
        <p className="mt-3 flex items-baseline gap-2">
          <span className="text-[12px] text-white/40 line-through">${was}</span>
          <span className="text-[18px] font-bold text-white">${d.nightlyUsd}</span>
          <span className="text-[11px] text-white/50">/night · pay {d.payToken}</span>
        </p>
      </div>
    </Link>
  );
}
