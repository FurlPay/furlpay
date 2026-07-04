"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import {
  ChevronLeft,
  MapPin,
  Search,
  Sparkles,
  Building2,
  MountainSnow,
  UtensilsCrossed,
  Landmark,
  Waves,
  Moon,
  Bus,
  Flower2,
  type LucideIcon,
} from "lucide-react";
import { sendJSON } from "@/lib/api";
import { Spinner } from "@/components/ui";
import ActivityCard from "@/components/travel/ActivityCard";
import SkeletonCards from "@/components/travel/SkeletonCards";
import { ACTIVITY_CATEGORIES, type Activity, type ActivityCategory } from "@/lib/travel/data";

const CATEGORY_ICONS: Record<ActivityCategory, LucideIcon> = {
  "City Tours": Building2,
  "Adventure & Outdoor": MountainSnow,
  "Food & Drink": UtensilsCrossed,
  "Cultural Experiences": Landmark,
  "Water Sports": Waves,
  Nightlife: Moon,
  "Day Trips": Bus,
  "Wellness & Spa": Flower2,
};

function ActivitiesResults() {
  const params = useSearchParams();
  const router = useRouter();
  const city = params.get("city") ?? "";

  const [searchCity, setSearchCity] = useState(city);
  const [loading, setLoading] = useState(true);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [category, setCategory] = useState<ActivityCategory | "All">("All");

  useEffect(() => {
    setLoading(true);
    sendJSON<{ results: Activity[] }>("/api/travel/search", { type: "activities", city })
      .then((d) => setActivities(d.results))
      .catch(() => setActivities([]))
      .finally(() => setLoading(false));
  }, [city]);

  const filtered = useMemo(
    () => (category === "All" ? activities : activities.filter((a) => a.category === category)),
    [activities, category],
  );

  function search() {
    router.push(`/travel/activities?city=${encodeURIComponent(searchCity)}`);
  }

  return (
    <div className="mx-auto max-w-6xl px-5 pb-24 pt-6">
      <Link href="/travel" className="mb-3 inline-flex items-center gap-1 text-sm text-textSecondary hover:text-white">
        <ChevronLeft className="h-4 w-4" /> Travel
      </Link>
      <h1 className="text-2xl font-bold text-white">
        Activities & experiences {city && `in ${city}`}
        <span className="ml-2 text-sm font-normal text-textSecondary">
          {loading ? "" : `${filtered.length} experiences`}
        </span>
      </h1>

      {/* Search bar */}
      <div className="mt-4 flex gap-2.5 rounded-card border border-white/10 bg-gradient-to-br from-violet-500/[0.10] via-charcoal to-fuchsia-500/[0.08] p-4">
        <label className="flex flex-1 items-center gap-2 rounded-xl bg-white/[0.06] px-3 py-3">
          <MapPin className="h-4 w-4 shrink-0 text-textSecondary" />
          <input
            value={searchCity}
            onChange={(e) => setSearchCity(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            placeholder="Where do you want to explore?"
            className="w-full bg-transparent text-sm text-white placeholder:text-textSecondary focus:outline-none"
          />
        </label>
        <button
          onClick={search}
          className="flex items-center justify-center gap-2 rounded-xl bg-neon px-5 py-3 text-sm font-bold text-black transition hover:bg-neonDeep"
        >
          <Search className="h-4 w-4" /> Search
        </button>
      </div>

      {/* Category chips */}
      <div className="mt-5 flex flex-wrap gap-2">
        <button
          onClick={() => setCategory("All")}
          className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold transition ${
            category === "All" ? "bg-white text-black" : "bg-white/[0.06] text-textSecondary hover:bg-white/10"
          }`}
        >
          <Sparkles className="h-3.5 w-3.5" /> All
        </button>
        {ACTIVITY_CATEGORIES.map((c) => {
          const Icon = CATEGORY_ICONS[c];
          return (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold transition ${
                category === c ? "bg-white text-black" : "bg-white/[0.06] text-textSecondary hover:bg-white/10"
              }`}
            >
              <Icon className="h-3.5 w-3.5" /> {c}
            </button>
          );
        })}
      </div>

      {/* Results */}
      <div className="mt-6">
        {loading ? (
          <SkeletonCards count={6} imageH="h-32" />
        ) : filtered.length === 0 ? (
          <p className="py-16 text-center text-sm text-textSecondary">No experiences in this category yet.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((a) => (
              <ActivityCard key={a.id} activity={a} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ActivitiesPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <ActivitiesResults />
    </Suspense>
  );
}
