"use client";

import { formatDistanceKm } from "@/lib/geo/geodesy";
import type { RadiusQuery } from "@/lib/hotels/radius";
import type { MapAirport, RouteInfo } from "./useTravelOverlays";

// The travel context currently on the map, as chips at its top-left: the
// radius being searched, the flight route being shown, and the airport the
// reader picked. Each says exactly what it is and how to remove it.

const CHIP =
  "pointer-events-auto flex max-w-full items-center gap-2 rounded-full border border-white/[0.10] bg-[#090D0E]/95 py-1.5 pl-3 pr-1.5 text-[12px] text-[#E6EAE8] shadow-[0_8px_24px_rgba(0,0,0,0.35)] backdrop-blur";
const X =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[#A4AAA9] hover:bg-white/[0.08] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00E6A7]";

function Close({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className={X}>
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  );
}

export default function TravelContextChips({
  radius,
  radiusLabel,
  onClearRadius,
  route,
  routeError,
  onClearRoute,
  airport,
  onCloseAirport,
  onAirportRadius,
}: {
  radius: RadiusQuery | null;
  radiusLabel: string;
  onClearRadius: () => void;
  route: RouteInfo | null;
  routeError: [string, string] | null;
  onClearRoute: () => void;
  airport: MapAirport | null;
  onCloseAirport: () => void;
  onAirportRadius: (a: MapAirport) => void;
}) {
  if (!radius && !route && !routeError && !airport) return null;
  return (
    <div className="pointer-events-none absolute left-4 top-[44px] z-20 flex max-w-[calc(100%-96px)] flex-col items-start gap-2">
      {radius && (
        <div className={CHIP} role="status">
          <span className="h-2 w-2 shrink-0 rounded-full border border-[#00E6A7]" aria-hidden />
          <span className="truncate">
            Within <strong className="font-semibold text-white">{radius.km} km</strong> of {radiusLabel}
          </span>
          <Close label="Clear radius search" onClick={onClearRadius} />
        </div>
      )}
      {route && (
        <div className={CHIP} role="status">
          <span className="h-0.5 w-4 shrink-0 rounded bg-[#38BDF8]" aria-hidden />
          <span className="truncate">
            <strong className="font-semibold text-white">{route.from.iata} → {route.to.iata}</strong> · {formatDistanceKm(route.km)} straight-line
          </span>
          <Close label="Hide flight route" onClick={onClearRoute} />
        </div>
      )}
      {routeError && !route && (
        <div className={CHIP} role="status">
          <span className="truncate text-[#A4AAA9]">
            Couldn&apos;t show route {routeError[0]} → {routeError[1]}: unknown airport code
          </span>
          <Close label="Dismiss" onClick={onClearRoute} />
        </div>
      )}
      {airport && (
        <div
          className="pointer-events-auto w-[280px] max-w-full rounded-[14px] border border-white/[0.10] bg-[#090D0E] p-3 shadow-[0_16px_40px_rgba(0,0,0,0.45)]"
          role="dialog"
          aria-label={`${airport.name} (${airport.iata})`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[15px] font-bold text-[#7DD3FC]">{airport.iata}</p>
              <p className="truncate text-[13px] font-semibold text-white">{airport.name}</p>
              <p className="text-[12px] text-[#A4AAA9]">
                {[airport.city, airport.country].filter(Boolean).join(", ")}
              </p>
            </div>
            <Close label="Close airport" onClick={onCloseAirport} />
          </div>
          <button
            type="button"
            onClick={() => onAirportRadius(airport)}
            className="mt-3 h-9 w-full rounded-[10px] border border-white/[0.12] text-[12.5px] font-semibold text-white transition hover:border-[#00E6A7] hover:text-[#00E6A7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00E6A7]"
          >
            Hotels within 25 km of {airport.iata}
          </button>
        </div>
      )}
    </div>
  );
}
