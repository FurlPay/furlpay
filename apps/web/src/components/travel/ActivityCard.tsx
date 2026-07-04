"use client";

import Link from "next/link";
import { Star, Clock, Zap, Users } from "lucide-react";
import { Pill } from "@/components/ui";
import { CITY_PHOTOS, type Activity } from "@/lib/travel/data";

export default function ActivityCard({ activity }: { activity: Activity }) {
  const href = `/travel/checkout?ref=${activity.id}&name=${encodeURIComponent(activity.title)}&amount=${activity.priceUsd}&nights=1`;
  const photo = CITY_PHOTOS[activity.city];
  return (
    <div className="group overflow-hidden rounded-card border border-white/10 bg-charcoal transition hover:border-white/20">
      <div className={`relative h-32 overflow-hidden bg-gradient-to-br ${activity.image}`}>
        {photo && (
          <>
            <img
              src={photo}
              alt={activity.title}
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/45 to-transparent" />
          </>
        )}
        <div className="absolute left-3 top-3 flex gap-1.5">
          <Pill tone="gain">2% back in USDC</Pill>
        </div>
        <span className="absolute right-3 top-3 rounded-full bg-black/50 px-2 py-1 text-[11px] font-semibold text-white">
          {activity.category}
        </span>
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold text-white">{activity.title}</h3>
          <span className="flex shrink-0 items-center gap-0.5 rounded-md bg-white/[0.06] px-1.5 py-0.5 text-xs font-semibold text-white">
            <Star className="h-3 w-3 fill-neon text-neon" /> {activity.rating}
          </span>
        </div>

        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-textSecondary">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" /> {activity.durationHours} {activity.durationHours === 1 ? "hour" : "hours"}
          </span>
          <span>({activity.reviews.toLocaleString()} reviews)</span>
          {activity.smallGroup && (
            <span className="flex items-center gap-1"><Users className="h-3 w-3" /> Small group</span>
          )}
        </div>

        <div className="mt-3 flex items-end justify-between">
          <div>
            <p className="text-lg font-bold text-white">
              ${activity.priceUsd}
              <span className="text-xs font-normal text-textSecondary"> /person</span>
            </p>
            <p className="text-[11px] text-textSecondary">≈ {activity.priceUsd.toLocaleString()} USDC</p>
          </div>
          <Link
            href={href}
            className="rounded-lg bg-neon px-3.5 py-2 text-xs font-bold text-black transition hover:bg-neonDeep"
          >
            Book Now
          </Link>
        </div>
        {activity.instantConfirmation && (
          <p className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-emerald-400">
            <Zap className="h-3 w-3" /> Instant confirmation
          </p>
        )}
      </div>
    </div>
  );
}
