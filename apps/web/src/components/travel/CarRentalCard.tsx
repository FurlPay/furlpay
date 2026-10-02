"use client";

import Link from "next/link";
import { Users, DoorOpen, Fuel, Cog, ShieldCheck, Infinity as InfinityIcon } from "lucide-react";
import { Pill } from "@/components/ui";
import type { CarRental } from "@/lib/travel/data";

export default function CarRentalCard({ car, days }: { car: CarRental; days: number }) {
  const total = Math.round(car.dailyUsd * days * 100) / 100;
  const href = `/travel/checkout?kind=car&ref=${car.id}&name=${encodeURIComponent(`${car.make} ${car.model} · ${car.supplier}`)}&amount=${total}&nights=${days}`;
  return (
    <div className="overflow-hidden rounded-card border border-white/10 bg-charcoal transition hover:border-white/20">
      <div className={`relative h-32 bg-gradient-to-br ${car.image}`}>
        {car.photo && (
          <img
            src={car.photo}
            alt={`${car.make} ${car.model}`}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover"
            onError={(e) => (e.currentTarget.style.display = "none")}
          />
        )}
        {/* readability scrim over the photo for the pills */}
        <div className="absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-black/50 to-transparent" />
        <div className="absolute left-3 top-3 flex gap-1.5">
          <Pill tone="gain">2% back in USDC</Pill>
          {car.fuel === "Electric" && <Pill tone="accent">EV</Pill>}
        </div>
        <span className="absolute right-3 top-3 rounded-full bg-black/50 px-2 py-1 text-[11px] font-semibold text-white">
          {car.category}
        </span>
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-white">
              {car.make} {car.model} <span className="font-normal text-textSecondary">or similar</span>
            </h3>
            <p className="mt-0.5 text-xs text-textSecondary">{car.supplier}</p>
          </div>
          <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-xs font-semibold text-white">
            {car.supplierRating}/10
          </span>
        </div>

        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-textSecondary">
          <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {car.seats} seats</span>
          <span className="flex items-center gap-1"><DoorOpen className="h-3 w-3" /> {car.doors} doors</span>
          <span className="flex items-center gap-1"><Cog className="h-3 w-3" /> {car.transmission}</span>
          <span className="flex items-center gap-1"><Fuel className="h-3 w-3" /> {car.fuel}</span>
        </div>

        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
          <span className="flex items-center gap-1 text-emerald-400">
            <ShieldCheck className="h-3 w-3" /> {car.insurance}
          </span>
          {car.unlimitedMileage && (
            <span className="flex items-center gap-1 text-textSecondary">
              <InfinityIcon className="h-3 w-3" /> Unlimited mileage
            </span>
          )}
        </div>

        <div className="mt-3 flex items-end justify-between">
          <div>
            <p className="text-lg font-bold text-white">
              ${car.dailyUsd}
              <span className="text-xs font-normal text-textSecondary"> /day</span>
            </p>
            <p className="text-[11px] text-textSecondary">
              ${total.toLocaleString()} total · {days} {days === 1 ? "day" : "days"} · ≈ {total.toLocaleString()} USDC
            </p>
          </div>
          <Link
            href={href}
            className="rounded-lg bg-neon px-3.5 py-2 text-xs font-bold text-black transition hover:bg-neonDeep"
          >
            Book Now
          </Link>
        </div>
        {car.freeCancellation && (
          <p className="mt-2 text-[11px] font-semibold text-emerald-400">Free cancellation</p>
        )}
      </div>
    </div>
  );
}
