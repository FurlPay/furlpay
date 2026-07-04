"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { UtensilsCrossed, MapPin, Search, Star, Coins, CalendarCheck } from "lucide-react";
import { getJSON } from "@/lib/api";
import { Pill } from "@/components/ui";
import SkeletonCards from "@/components/travel/SkeletonCards";
import { CITY_PHOTOS } from "@/lib/travel/data";
import type { Restaurant } from "@/lib/travel/discover";

function RestaurantsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const city = params.get("city") ?? "Tokyo";

  const [searchCity, setSearchCity] = useState(city);
  const [loading, setLoading] = useState(true);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [cryptoOnly, setCryptoOnly] = useState(false);

  useEffect(() => {
    setLoading(true);
    getJSON<{ restaurants: Restaurant[] }>(`/api/travel/restaurants?city=${encodeURIComponent(city)}`)
      .then((d) => setRestaurants(d.restaurants))
      .catch(() => setRestaurants([]))
      .finally(() => setLoading(false));
  }, [city]);

  const filtered = useMemo(
    () => (cryptoOnly ? restaurants.filter((r) => r.cryptoAccepted) : restaurants),
    [restaurants, cryptoOnly],
  );
  const photo = CITY_PHOTOS[city];

  function search() {
    router.push(`/travel/restaurants?city=${encodeURIComponent(searchCity)}`);
  }

  return (
    <div className="mx-auto max-w-6xl px-5 pb-24 pt-8">
      <div className="mb-3 flex items-center gap-2">
        <Pill tone="accent">Pay the bill in USDC</Pill>
      </div>
      <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-white">
        <UtensilsCrossed className="h-7 w-7 text-neon" /> Restaurants in {city}
      </h1>
      <p className="mt-2 max-w-xl text-sm text-textSecondary">
        Where to eat, with the flag review sites don’t have: which venues take crypto — and for everywhere else,
        generate a one-time FurlPay Visa card and settle the bill from your USDC balance.
      </p>

      {/* Search */}
      <div className="mt-5 flex flex-wrap gap-2.5 rounded-card border border-white/10 bg-gradient-to-br from-amber-500/[0.10] via-charcoal to-rose-500/[0.08] p-4">
        <label className="flex min-w-[220px] flex-1 items-center gap-2 rounded-xl bg-white/[0.06] px-3 py-3">
          <MapPin className="h-4 w-4 shrink-0 text-textSecondary" />
          <input
            value={searchCity}
            onChange={(e) => setSearchCity(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            placeholder="Which city are you eating in?"
            className="w-full bg-transparent text-sm text-white placeholder:text-textSecondary focus:outline-none"
          />
        </label>
        <button
          onClick={search}
          className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-neon px-5 text-sm font-bold text-black transition hover:bg-neonDeep"
        >
          <Search className="h-4 w-4" /> Search
        </button>
        <label className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl bg-white/[0.06] px-4 text-xs font-semibold text-white">
          <input type="checkbox" checked={cryptoOnly} onChange={(e) => setCryptoOnly(e.target.checked)} className="accent-neon" />
          <Coins className="h-3.5 w-3.5 text-neon" /> Crypto-accepted only
        </label>
      </div>

      {/* Results */}
      <div className="mt-6">
        {loading ? (
          <SkeletonCards count={6} imageH="h-28" />
        ) : filtered.length === 0 ? (
          <p className="py-16 text-center text-sm text-textSecondary">No restaurants match — try another city.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((r) => (
              <div key={r.id} className="group overflow-hidden rounded-card border border-white/10 bg-charcoal transition hover:border-white/20">
                <div className={`relative h-28 overflow-hidden bg-gradient-to-br ${r.image}`}>
                  {photo && (
                    <>
                      <img src={photo} alt={r.city} loading="lazy" className="absolute inset-0 h-full w-full object-cover opacity-70 transition duration-500 group-hover:scale-105" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-black/10" />
                    </>
                  )}
                  <span className="absolute left-3 top-3 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white">
                    {r.cuisine}
                  </span>
                  {r.cryptoAccepted && (
                    <span className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-neon px-2 py-0.5 text-[10px] font-bold text-black">
                      <Coins className="h-3 w-3" /> USDC
                    </span>
                  )}
                </div>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="text-sm font-bold text-white">{r.name}</h2>
                    <span className="flex shrink-0 items-center gap-0.5 rounded-md bg-white/[0.06] px-1.5 py-0.5 text-xs font-semibold text-white">
                      <Star className="h-3 w-3 fill-neon text-neon" /> {r.rating}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-textSecondary">
                    {"$".repeat(r.priceTier)} · {r.reviews.toLocaleString()} reviews · {r.signature}
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    {r.bookable ? (
                      <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400">
                        <CalendarCheck className="h-3.5 w-3.5" /> Table booking available
                      </span>
                    ) : (
                      <span className="text-[11px] text-textSecondary">Walk-ins welcome</span>
                    )}
                    {!r.cryptoAccepted && (
                      <Link href="/cards" className="ml-auto text-[11px] font-semibold text-neon hover:underline">
                        Pay via VCN →
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function RestaurantsPage() {
  return (
    <Suspense fallback={<SkeletonCards count={6} imageH="h-28" />}>
      <RestaurantsInner />
    </Suspense>
  );
}
