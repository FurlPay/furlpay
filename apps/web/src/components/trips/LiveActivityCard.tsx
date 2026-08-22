"use client";

import { MoveDiagonal } from "lucide-react";
import FurlPayLogo from "./FurlPayLogo";
import { RouteDashed } from "./FlightPath";
import styles from "./trips.module.css";
import type { Trip } from "@/lib/trips/demoTrip";

/**
 * The compact lock-screen Live Activity, shown at desktop scale. Mirrors what
 * `FlightLiveActivity` renders inside the device — same data, same hierarchy,
 * blown up so the detail is legible in the marketing column.
 */
export default function LiveActivityCard({
  trip,
  onExpand,
  expanded = false,
}: {
  trip: Trip;
  onExpand?: () => void;
  expanded?: boolean;
}) {
  const { flight, live } = trip;
  return (
    <div className={`${styles.glass} px-5 pb-[24px] pt-[20px] sm:px-6 sm:pb-[26px] sm:pt-[22px]`}>
      <div className="flex items-start justify-between">
        <FurlPayLogo size={25} />
        <button
          type="button"
          onClick={onExpand}
          aria-expanded={expanded}
          aria-label={`${expanded ? "Collapse" : "Expand"} live flight status for ${flight.number}`}
          className="-mr-1 -mt-1 flex h-[34px] w-[34px] items-center justify-center rounded-full border border-white/[0.09] bg-white/[0.06] text-fp-sub transition-[background-color,color,transform] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-white/[0.12] hover:text-fp-white active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fp-green"
        >
          <MoveDiagonal className="h-[17px] w-[17px]" strokeWidth={2.2} />
        </button>
      </div>

      <div className="mt-[22px] flex items-center gap-4">
        <span className="text-[28px] font-bold leading-none tracking-[-0.02em] text-white sm:text-[34px]">
          {flight.originCode}
        </span>
        <RouteDashed />
        <span className="text-[28px] font-bold leading-none tracking-[-0.02em] text-white sm:text-[34px]">
          {flight.destinationCode}
        </span>
      </div>

      <p className="mt-[22px] text-[20px] font-medium leading-none text-white">{flight.number}</p>
      <p className="mt-[13px] text-[18px] font-medium leading-none text-[#7FDCA8]">{live.status}</p>
    </div>
  );
}
