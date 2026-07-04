"use client";

import Link from "next/link";
import { Plane, Briefcase } from "lucide-react";
import { Pill } from "@/components/ui";
import type { Flight } from "@/lib/travel/data";

function dur(min: number): string {
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

export default function FlightCard({ flight }: { flight: Flight }) {
  const href = `/travel/checkout?ref=${flight.id}&name=${encodeURIComponent(
    `${flight.carrierCode} ${flight.from}→${flight.to}`,
  )}&amount=${flight.priceUsd}&nights=0`;
  return (
    <div className="rounded-card border border-white/10 bg-charcoal p-4 transition hover:border-white/20">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-xs font-bold text-white">
            {flight.carrierCode}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">{flight.carrier}</p>
            <p className="text-[11px] text-textSecondary">
              {flight.cabin} · {flight.baggage}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 text-center">
          <div>
            <p className="text-sm font-bold text-white">{flight.departTime}</p>
            <p className="text-[11px] text-textSecondary">{flight.from}</p>
          </div>
          <div className="flex flex-col items-center">
            <span className="text-[10px] text-textSecondary">{dur(flight.durationMin)}</span>
            <div className="my-0.5 flex w-16 items-center">
              <span className="h-px flex-1 bg-white/20" />
              <Plane className="h-3 w-3 rotate-90 text-textSecondary" />
              <span className="h-px flex-1 bg-white/20" />
            </div>
            <span className="text-[10px] text-textSecondary">
              {flight.stops === 0 ? "Direct" : `${flight.stops} stop`}
            </span>
          </div>
          <div>
            <p className="text-sm font-bold text-white">{flight.arriveTime}</p>
            <p className="text-[11px] text-textSecondary">{flight.to}</p>
          </div>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-lg font-bold text-white">${flight.priceUsd.toLocaleString()}</p>
          <div className="mt-1 flex justify-end">
            <Pill tone="gain">2% back</Pill>
          </div>
          <Link
            href={href}
            className="mt-2 inline-block rounded-lg bg-neon px-3.5 py-1.5 text-xs font-bold text-black transition hover:bg-neonDeep"
          >
            Select
          </Link>
        </div>
      </div>
    </div>
  );
}
