"use client";

import FurlPayLogo from "./FurlPayLogo";
import { RouteArc } from "./FlightPath";
import styles from "./trips.module.css";
import type { Trip } from "@/lib/trips/demoTrip";

function Tile({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className={`${styles.tile} px-[12px] pb-[10px] pt-[9px] sm:px-[15px] ${className}`}>
      <p className="text-[14px] leading-none text-fp-sub sm:text-[15px]">{label}</p>
      <p className="mt-[10px] text-[22px] font-semibold leading-none tracking-[-0.01em] text-white sm:text-[25px]">
        {value}
      </p>
    </div>
  );
}

/** The expanded Live Activity — the full real-time picture of one flight. */
export default function FlightStatusCard({ trip }: { trip: Trip }) {
  const { flight, live } = trip;
  return (
    <div className={`${styles.glass} px-[18px] pb-[13px] pt-[15px] sm:px-[22px]`}>
      <div className="flex items-center justify-between">
        <FurlPayLogo size={24} />
        <span className="flex items-center rounded-full bg-[#0F4A31] px-[15px] py-[5px] text-[14px] font-semibold tracking-[0.03em] text-[#7FE7B0]">
          LIVE
        </span>
      </div>

      <p className="mt-[12px] text-[21px] font-medium leading-none text-white/95">
        {flight.number} <span className="text-white/45">·</span> {flight.aircraft}
      </p>

      {/* Trajectory sits between the flight number and the airport codes, so the
          aircraft appears to be arriving over the destination code below it. */}
      <div className="-mt-2">
        <RouteArc progress={live.progress} />
      </div>

      <div className="-mt-4 flex items-baseline justify-between">
        <span className="text-[24px] font-semibold leading-none tracking-[-0.015em] text-white sm:text-[28px]">
          {flight.originCode}
        </span>
        <span className="text-[24px] font-semibold leading-none tracking-[-0.015em] text-white sm:text-[28px]">
          {flight.destinationCode}
        </span>
      </div>

      <div className="mt-[12px] flex items-start justify-between">
        <div>
          <p className="text-[17px] leading-none text-fp-sub">{flight.originCity}</p>
          <p className="mt-[9px] text-[22px] font-medium leading-none tracking-[-0.01em] text-white sm:text-[25px]">
            {flight.departureTime}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[17px] leading-none text-fp-sub">{flight.destinationCity}</p>
          <p className="mt-[9px] text-[22px] font-medium leading-none tracking-[-0.01em] text-white sm:text-[25px]">
            {flight.arrivalTime}
          </p>
        </div>
      </div>

      <div className="mt-[15px] flex gap-[14px]">
        <Tile label="Gate" value={flight.gate} className="flex-1" />
        <Tile label="Seat" value={flight.seat} className="flex-1" />
        <Tile label="Boarding" value={`${live.minutesToBoarding} min`} className="flex-[1.7]" />
      </div>

      <div className={`${styles.tile} mt-[11px] flex items-end justify-between px-[15px] pb-[10px] pt-[9px]`}>
        <div>
          <p className="text-[15px] leading-none text-fp-sub">Status</p>
          <p className="mt-[10px] text-[25px] font-semibold leading-none tracking-[-0.01em] text-white">
            {live.statusLong}
          </p>
        </div>
        {/* Reads as an enabled iOS switch: the flight is being tracked. */}
        <span className="mb-[3px] flex h-[24px] w-[54px] items-center justify-end rounded-full bg-[#124b33] px-[3px]">
          <span
            className={`h-[18px] w-[18px] rounded-full bg-[#68E7A3] shadow-[0_0_10px_2px_rgba(104,231,163,0.45)] ${styles.livePulse}`}
          />
        </span>
      </div>
    </div>
  );
}
