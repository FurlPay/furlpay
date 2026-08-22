"use client";

import { Check } from "lucide-react";
import Barcode from "./Barcode";
import type { Trip } from "@/lib/trips/demoTrip";

function Field({
  label,
  value,
  accent = false,
  className = "",
}: {
  label: string;
  value: string;
  accent?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-[13px] leading-none text-[#6E6E73]">{label}</p>
      <p
        className={`mt-[9px] text-[24px] font-normal leading-none tracking-[-0.015em] ${
          accent ? "text-fp-ink" : "text-[#111113]"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

const RULE = "h-px w-full bg-[#DCDCDE]";

/** The boarding pass itself — the card a passenger actually shows at the gate. */
export default function BoardingPass({
  trip,
  expanded = false,
  onToggle,
}: {
  trip: Trip;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const { flight, passenger } = trip;
  return (
    <div className="-mt-[16px] mx-[14px] w-[calc(100%-28px)] rounded-[22px] bg-white px-[19px] pb-[11px] pt-[13px] shadow-[0_12px_28px_-18px_rgba(0,0,0,0.4)]">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label={`${expanded ? "Hide" : "Show"} full boarding pass for ${flight.number}`}
        className="flex w-full items-center justify-between rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fp-ink"
      >
        <span className="text-[29px] font-semibold leading-none tracking-[-0.025em] text-[#111113]">
          {flight.number}
        </span>
        <span className="rounded-full bg-[#E8E8EA] px-[12px] py-[6px] text-[14px] leading-none text-[#3C3C43]">
          {flight.aircraft}
        </span>
      </button>

      <div className={`${RULE} mt-[12px]`} />

      <div className="mt-[11px] grid grid-cols-4 gap-x-[6px]">
        <Field label="Boarding" value={flight.boardingTime} accent />
        <Field label="Departs" value={flight.departureTime} />
        <Field label="Gate" value={flight.gate} />
        <Field label="Seat" value={flight.seat} />
      </div>

      <Field label="Arrives" value={flight.arrivalTime} className="mt-[12px]" />

      {/* Detail revealed by tapping the header — the rest of what the gate agent
          scans, kept out of the resting state so the card stays scannable. */}
      {expanded && (
        <div className="mt-[16px] grid grid-cols-2 gap-y-[16px] rounded-[14px] bg-[#F4F4F6] p-[16px]">
          <Field label="From" value={`${flight.originCity} (${flight.originCode})`} />
          <Field label="To" value={`${flight.destinationCity} (${flight.destinationCode})`} />
          <Field label="Aircraft" value={flight.aircraft} />
          <Field label="Boarding gate" value={flight.gate} />
        </div>
      )}

      <div className={`${RULE} mt-[11px]`} />

      <div className="mt-[11px] flex items-end justify-between">
        <div>
          <p className="text-[13px] leading-none text-[#6E6E73]">Passenger</p>
          <p className="mt-[10px] text-[24px] font-normal leading-none tracking-[-0.02em] text-[#111113]">
            {passenger.name}
          </p>
        </div>
        {passenger.verified && (
          <span
            className="flex h-[32px] w-[32px] items-center justify-center rounded-full bg-[#1B7A4E]"
            role="img"
            aria-label="Identity verified"
          >
            <Check className="h-[18px] w-[18px] text-white" strokeWidth={3} />
          </span>
        )}
      </div>

      <div className={`${RULE} mt-[11px]`} />

      <Barcode
        value={`${flight.number}-${flight.seat}-${passenger.name}`}
        className="mt-[11px] w-full"
        height={expanded ? 70 : 42}
      />
      <p className="mt-[7px] text-center text-[10px] font-bold tracking-[0.12em] text-[#3C3C43]">
        FURLPAY
      </p>
    </div>
  );
}
