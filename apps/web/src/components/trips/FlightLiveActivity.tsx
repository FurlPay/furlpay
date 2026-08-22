"use client";

import { ArrowRight } from "lucide-react";
import { FurlPayMark } from "./FurlPayLogo";
import { RouteDip } from "./FlightPath";
import type { Trip } from "@/lib/trips/demoTrip";

/**
 * The Live Activity as it appears in-app, directly under the status bar: the
 * same card iOS would render on the Lock Screen, pinned to the top of Trips.
 */
export default function FlightLiveActivity({
  trip,
  onOpen,
}: {
  trip: Trip;
  onOpen?: () => void;
}) {
  const { flight, live } = trip;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open live status for flight ${flight.number}, ${live.status}`}
      className="mx-[14px] flex w-[calc(100%-28px)] items-center gap-[10px] rounded-[26px] bg-[linear-gradient(160deg,#06170F_0%,#020A07_100%)] px-[14px] py-[10px] text-left shadow-[0_10px_24px_-12px_rgba(0,0,0,0.55)] transition-transform duration-[var(--dur-fast)] ease-[var(--ease-out)] active:scale-[0.985]"
    >
      <FurlPayMark size={33} className="mt-[15px] shrink-0 self-start" />

      <span className="min-w-0 flex-1">
        <span className="block text-[12px] font-medium leading-none text-[#4ADE96]">FurlPay</span>
        <span className="mt-[6px] flex items-center gap-[6px] text-[23px] font-bold leading-none tracking-[-0.02em] text-white">
          {flight.originCode}
          <ArrowRight className="h-[18px] w-[18px] text-white" strokeWidth={2.6} />
          {flight.destinationCode}
        </span>
        <span className="mt-[6px] block text-[14px] font-medium leading-none text-white/90">
          {flight.number}
        </span>
        <span className="mt-[5px] block text-[14px] font-medium leading-none text-[#5FDCA0]">
          {live.status}
        </span>
      </span>

      <RouteDip className="mt-[14px] h-[32px] w-[106px] shrink-0 self-start" />
    </button>
  );
}
