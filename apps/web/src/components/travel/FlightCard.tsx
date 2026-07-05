"use client";

import { useState } from "react";
import Link from "next/link";
import { Plane, Briefcase } from "lucide-react";
import { Pill } from "@/components/ui";
import type { Flight } from "@/lib/travel/data";

// Brand SVG from Duffel's assets CDN; falls back to the IATA code chip when
// the CDN has no asset for a carrier.
function AirlineLogo({ logoUrl, carrier, code }: { logoUrl?: string; carrier: string; code: string }) {
  const [failed, setFailed] = useState(false);
  if (!logoUrl || failed) {
    return (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-xs font-bold text-white">
        {code}
      </span>
    );
  }
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white p-1.5">
      <img
        src={logoUrl}
        alt={carrier}
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-full w-full object-contain"
      />
    </span>
  );
}

function dur(min: number): string {
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

export default function FlightCard({ flight, badge }: { flight: Flight; badge?: string }) {
  // Checkout renders the airline logo + itinerary line above the summary.
  const meta = `${flight.date} · ${dur(flight.durationMin)} · ${
    flight.stops === 0 ? "Direct" : `${flight.stops} stop`
  } · ${flight.cabin}`;
  const href =
    `/travel/checkout?kind=flight&ref=${flight.id}` +
    `&name=${encodeURIComponent(`${flight.from} → ${flight.to}`)}` +
    `&carrier=${encodeURIComponent(flight.carrier)}` +
    `&meta=${encodeURIComponent(meta)}` +
    (flight.logoUrl ? `&img=${encodeURIComponent(flight.logoUrl)}` : "") +
    `&amount=${flight.priceUsd}&nights=0`;
  return (
    <div
      className={`relative rounded-card border bg-charcoal p-4 transition hover:border-white/20 ${
        badge === "Cheapest" ? "border-neon/30" : "border-white/10"
      }`}
    >
      {badge && (
        <span
          className={`absolute -top-2 left-4 rounded-full px-2 py-0.5 text-[10px] font-bold ${
            badge === "Cheapest" ? "bg-neon text-black" : "bg-sky-400 text-black"
          }`}
        >
          {badge}
        </span>
      )}
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <AirlineLogo logoUrl={flight.logoUrl} carrier={flight.carrier} code={flight.carrierCode} />
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
