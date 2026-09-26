"use client";

import { useEffect, useState } from "react";
import type { MapCluster, MapPoint } from "@/app/api/travel/hotels/map/route";
import type { PreviewPlace, PreviewResponse } from "@/app/api/travel/hotels/preview/route";
import type { ClusterMember } from "@/lib/hotels/curated";
import type { HotelPriceResponse } from "@/app/api/travel/hotels/price/route";
import type { GooglePlace } from "@/lib/hotels/googlePlaces";
import { photoProxyUrl } from "@/lib/hotels/googlePlaces";
import { LUXURY_MAP_CATEGORIES } from "@/lib/hotels/luxuryTiers";
import {
  ArrowRightIcon,
  CalendarIcon,
  DiningIcon,
  GuestsIcon,
  HotelIcon,
  ResortIcon,
  StarIcon,
  VillaIcon,
} from "./icons";

// ---------------------------------------------------------------------------
// Destination card.
//
// Shown when the user clicks a CLUSTER marker on the hotel map. Replaces the
// old behaviour of zooming straight to the cluster's bounds — the card gives
// the reader a destination-level overview (hero image, stats, top properties
// with live prices, availability check) BEFORE they commit to looking inside.
//
// The design matches the reference: a white card with rounded corners, a
// full-bleed hero with a dark gradient and white text overlay, a rating badge,
// statistics row, three property cards with prices, and an availability CTA.
//
// PRICING IS LIVE. Each property card calls /api/travel/hotels/price on mount.
// Prices are displayed only when the response is `state: "available"` from a
// LIVE Duffel key. Sandbox rates render as "Price on request" because a sandbox
// number rendered as a real rate is indistinguishable from a lie.
// ---------------------------------------------------------------------------

/** Session-lifetime photo cache, same as HotelMapHoverCard. */
const previewCache = new Map<string, PreviewPlace>();

function usePreview(placeIds: string[]) {
  const key = placeIds.join(",");
  const [places, setPlaces] = useState<Map<string, PreviewPlace>>(new Map());
  const [state, setState] = useState<"idle" | "loading" | "ready" | "failed">("idle");

  useEffect(() => {
    if (!placeIds.length) { setState("idle"); return; }

    const known = new Map<string, PreviewPlace>();
    const missing: string[] = [];
    for (const id of placeIds) {
      const hit = previewCache.get(id);
      if (hit) known.set(id, hit);
      else missing.push(id);
    }
    setPlaces(known);

    if (!missing.length) { setState("ready"); return; }

    const ac = new AbortController();
    setState("loading");
    (async () => {
      try {
        const res = await fetch(
          `/api/travel/hotels/preview?placeIds=${encodeURIComponent(missing.join(","))}`,
          { signal: ac.signal },
        );
        if (!res.ok) throw new Error(String(res.status));
        const data: PreviewResponse = await res.json();
        for (const p of data.places) previewCache.set(p.placeId, p);
        for (const id of data.missing) previewCache.set(id, { placeId: id, name: "" });
        const next = new Map(known);
        for (const p of data.places) next.set(p.placeId, p);
        setPlaces(next);
        setState("ready");
      } catch {
        if (ac.signal.aborted) return;
        setState("failed");
      }
    })();
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { places, state };
}

// ---------------------------------------------------------------------------
// Per-property live pricing hook.
// ---------------------------------------------------------------------------

interface LivePrice {
  state: "idle" | "loading" | "available" | "sandbox" | "unavailable" | "error";
  perNight?: number;
  currency?: string;
}

/**
 * Price every property the card shows, in one place.
 *
 * Deliberately lifted out of the individual cards. The stats row wants a
 * "from" figure across the destination, and the only honest source for that is
 * the same set of quotes the cards below are already displaying — a separate
 * estimate would be a second number that can disagree with the first.
 *
 * Each row is keyed by member id, so a card renders its own quote and the
 * aggregate is a fold over the map rather than an independent lookup.
 */
function useLivePrices(
  members: ClusterMember[],
  checkIn: string,
  checkOut: string,
  guests: number,
): Map<string, LivePrice> {
  const [prices, setPrices] = useState<Map<string, LivePrice>>(new Map());
  const key = members.map((m) => m.id).join(",");

  useEffect(() => {
    if (!members.length) { setPrices(new Map()); return; }

    const ac = new AbortController();
    setPrices(new Map(members.map((m) => [m.id, { state: "loading" as const }])));

    const settle = (id: string, next: LivePrice) => {
      if (ac.signal.aborted) return;
      setPrices((prev) => {
        const copy = new Map(prev);
        copy.set(id, next);
        return copy;
      });
    };

    for (const member of members) {
      (async () => {
        try {
          const res = await fetch("/api/travel/hotels/price", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              osmId: member.id,
              name: member.name,
              latitude: member.latitude,
              longitude: member.longitude,
              city: member.city,
              checkIn,
              checkOut,
              adults: guests,
              rooms: 1,
            }),
            signal: ac.signal,
          });
          if (!res.ok) { settle(member.id, { state: "error" }); return; }

          const data: HotelPriceResponse = await res.json();
          // `duffelMode` is the SERVER's answer to "is this a real rate". The
          // client never decides that for itself — see the price route, which
          // surfaces the field for exactly this reason.
          if (data.state === "available" && data.duffelMode === "live") {
            settle(member.id, {
              state: "available",
              perNight: data.perNightAmount,
              currency: data.currency,
            });
          } else if (data.state === "available" && data.duffelMode === "test") {
            settle(member.id, { state: "sandbox" });
          } else {
            settle(member.id, {
              state: data.state === "unavailable" ? "unavailable" : "error",
            });
          }
        } catch {
          if (ac.signal.aborted) return;
          settle(member.id, { state: "error" });
        }
      })();
    }

    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, checkIn, checkOut, guests]);

  return prices;
}

// ---------------------------------------------------------------------------
// Nearby restaurants.
//
// SOURCE: /api/places/discover, which calls Google Places Text Search inside
// the cluster's own bounds. Real venues, real ratings, real photos.
//
// NOT `generateRestaurants()` from lib/travel/discover.ts, despite that being
// the obvious-looking helper. It is a deterministic FABRICATOR: the name,
// rating, review count and even `cryptoAccepted` are derived from a hash of
// the city string. It is fine behind a marketing page; putting it on a live map
// card would show a reader an invented restaurant with an invented 4.7 and an
// invented claim that it takes crypto.
// ---------------------------------------------------------------------------

type RestaurantState =
  | { kind: "loading" }
  /** Google answered. `places` may legitimately be empty. */
  | { kind: "ready"; places: GooglePlace[]; attribution: string }
  /** We could not ask — key missing, viewport too wide, upstream failure.
   *  Deliberately distinct from an empty `ready`, because "no restaurants
   *  here" and "we could not look" are different statements. */
  | { kind: "unavailable"; reason: string };

function useNearbyRestaurants(cluster: MapCluster): RestaurantState {
  const [state, setState] = useState<RestaurantState>({ kind: "loading" });
  const { minLat, minLng, maxLat, maxLng } = cluster.bounds;

  useEffect(() => {
    const ac = new AbortController();
    setState({ kind: "loading" });

    (async () => {
      try {
        const res = await fetch("/api/places/discover", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            viewport: { north: maxLat, south: minLat, east: maxLng, west: minLng },
            kinds: ["restaurants"],
            maxResults: 6,
          }),
          signal: ac.signal,
        });

        if (!res.ok) {
          // The route answers 503 unconfigured and 422 for too wide a viewport,
          // each with a message written for a reader. Surface it rather than
          // inventing one.
          const body = await res.json().catch(() => null);
          setState({
            kind: "unavailable",
            reason: body?.message ?? "Nearby dining is unavailable right now.",
          });
          return;
        }

        const data = await res.json();
        const bucket = data.restaurants;
        if (!bucket || bucket.unavailable) {
          setState({ kind: "unavailable", reason: "Nearby dining could not be loaded." });
          return;
        }

        setState({
          kind: "ready",
          places: (bucket.places ?? []) as GooglePlace[],
          attribution: data.attribution ?? "",
        });
      } catch {
        if (ac.signal.aborted) return;
        setState({ kind: "unavailable", reason: "Nearby dining could not be loaded." });
      }
    })();

    return () => ac.abort();
  }, [minLat, minLng, maxLat, maxLng]);

  return state;
}

/** Google's price enum as the reader's $ symbols. Unspecified stays null —
 *  a place Google declined to band does not get a band invented for it. */
function priceBand(level: string | undefined): string | null {
  switch (level) {
    case "PRICE_LEVEL_INEXPENSIVE": return "$";
    case "PRICE_LEVEL_MODERATE": return "$$";
    case "PRICE_LEVEL_EXPENSIVE": return "$$$";
    case "PRICE_LEVEL_VERY_EXPENSIVE": return "$$$$";
    default: return null;
  }
}

/** "italian_restaurant" -> "Italian". Google's own type, tidied — never guessed
 *  from the venue's name. */
function cuisineLabel(place: GooglePlace): string | null {
  const candidates = [place.primaryType, ...(place.types ?? [])];
  for (const t of candidates) {
    if (!t || t === "restaurant" || t === "food" || t === "point_of_interest") continue;
    if (!t.endsWith("_restaurant")) continue;
    const word = t.replace(/_restaurant$/, "").replace(/_/g, " ");
    return word ? word[0].toUpperCase() + word.slice(1) : null;
  }
  return null;
}

/**
 * The cheapest live per-night rate across the properties on screen.
 *
 * Returns null unless at least one quote came back LIVE — a sandbox rate or a
 * failed lookup contributes nothing, because a "from" price is a promise that
 * someone can actually book at it.
 */
function cheapestLive(prices: Map<string, LivePrice>): LivePrice | null {
  let best: LivePrice | null = null;
  for (const p of prices.values()) {
    if (p.state !== "available" || p.perNight === undefined) continue;
    if (!best || p.perNight < best.perNight!) best = p;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Date helpers.
// ---------------------------------------------------------------------------

function todayISO(): string {
  const d = new Date();
  return d.toISOString().split("T")[0];
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

// ---------------------------------------------------------------------------
// Component.
// ---------------------------------------------------------------------------

export interface DestinationCardProps {
  cluster: MapCluster;
  /** Distance from the top of the map, measured from the real search header
   *  rather than assumed — the header grows when suggestions open. */
  top: number;
  onClose: () => void;
  onViewAll: () => void;
  onOpenProperty: (m: ClusterMember | MapPoint) => void;
  onSearchArea: (checkIn: string, checkOut: string, guests: number) => void;
}

export default function DestinationCard({
  cluster,
  top,
  onClose,
  onViewAll,
  onOpenProperty,
  onSearchArea,
}: DestinationCardProps) {
  const members = cluster.top;
  const [checkIn, setCheckIn] = useState(todayISO());
  const [checkOut, setCheckOut] = useState(addDays(todayISO(), 1));
  const [guests, setGuests] = useState(2);

  // Photos from Google / Commons.
  const needGoogle = members
    .filter((m) => !m.imageLocalPath && !m.imageUrl && m.placeId)
    .map((m) => m.placeId as string);
  const { places } = usePreview(needGoogle);

  const imageFor = (m: ClusterMember): { url?: string; credit?: string } => {
    if (m.imageLocalPath) return { url: m.imageLocalPath, credit: m.imageCredit };
    if (m.imageUrl) return { url: m.imageUrl, credit: m.imageCredit };
    const g = m.placeId ? places.get(m.placeId) : undefined;
    return { url: g?.photoUrl, credit: g?.photoCredit };
  };

  const hero = members.find((m) => imageFor(m).url);
  const heroImage = hero ? imageFor(hero) : { url: undefined, credit: undefined };
  const heroPlace = hero?.placeId ? places.get(hero.placeId) : undefined;
  const rating = heroPlace?.rating;

  // One pricing pass for the whole card. The three property cards below read
  // their own row out of this map, and the "from" stat folds over it.
  const priced = members.slice(0, 3);
  const prices = useLivePrices(priced, checkIn, checkOut, guests);
  const cheapest = cheapestLive(prices);
  const pricesPending =
    prices.size === 0 || [...prices.values()].some((p) => p.state === "loading");

  const restaurants = useNearbyRestaurants(cluster);

  // Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside
      role="dialog"
      aria-label={`${cluster.label} destination overview`}
      className="dc-card pointer-events-auto absolute left-3 z-40 flex w-[400px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-[20px] bg-white shadow-[0_4px_6px_-1px_rgba(15,23,42,0.05),0_10px_15px_-3px_rgba(15,23,42,0.08),0_20px_50px_-5px_rgba(15,23,42,0.12)]"
      style={{ top }}
    >
      {/* --- close button --------------------------------------------------- */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close destination card"
        className="absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/40 text-white/90 backdrop-blur-sm transition hover:bg-black/60"
      >
        ×
      </button>

      {/* --- hero image with destination overlay ----------------------------- */}
      <div className="relative h-[160px] w-full overflow-hidden bg-[#1E293B]">
        {heroImage.url ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={heroImage.url}
              alt={cluster.label}
              className="h-full w-full object-cover"
              loading="lazy"
            />
            <span
              className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent"
              aria-hidden
            />
          </>
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#1E293B] to-[#334155]">
            <HotelIcon className="h-12 w-12 text-white/30" />
          </div>
        )}

        {/* Rating badge.
            This is the Google rating of the ONE property in the hero image, not
            a score for the destination — nothing in the data rates a city. It is
            labelled as such rather than left to read as "Dubai: 5.0". */}
        {rating !== undefined && hero && (
          <span
            className="absolute right-3 top-3 flex items-center gap-1 rounded-lg bg-[#16A34A] px-2 py-1 text-[13px] font-bold text-white shadow-md"
            title={`${hero.name} — ${rating.toFixed(1)} on Google`}
            aria-label={`${hero.name} is rated ${rating.toFixed(1)} on Google`}
          >
            <StarIcon className="h-3 w-3 text-white" />
            {rating.toFixed(1)}
          </span>
        )}

        {/* Destination name overlay */}
        <div className="absolute bottom-0 left-0 right-0 px-4 pb-3">
          <h2 className="text-[20px] font-bold leading-tight text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.5)]">
            {cluster.label}
          </h2>
          {/* NO "+" SUFFIX. The reference mock reads "1,240+ Hotels", but
              `CuratedCluster.count` is documented "How many real properties this
              stands for. Never an estimate", and the family counts sum to it. A
              cluster holding exactly 12 hotels rendered as "12+" claims a
              thirteenth that does not exist. The counts are already exact, so
              they are shown as exact. */}
          <p className="mt-0.5 text-[13px] font-medium text-white/85">
            {cluster.sublabel}
          </p>
        </div>

        {heroImage.credit && (
          <span className="absolute bottom-1 right-2 max-w-[40%] truncate rounded bg-black/40 px-1.5 py-0.5 text-[9px] text-white/80">
            {heroImage.credit}
          </span>
        )}
      </div>

      {/* --- scrollable body ------------------------------------------------- */}
      {/* Height budget follows the card's own offset: hero (160) + the card's
          top inset + a bottom margin. Hardcoding it meant a taller header
          pushed the footer CTA off-screen. */}
      <div
        className="overflow-y-auto"
        style={{ maxHeight: `calc(100vh - ${top + 160 + 24}px)` }}
      >
        {/* --- statistics row ------------------------------------------------ */}
        <div className="grid grid-cols-4 gap-2 border-b border-[#F1F5F9] px-4 py-3.5">
          <StatBox
            icon={<HotelIcon className="h-[18px] w-[18px]" />}
            value={cluster.families.hotels.toLocaleString()}
            label="Hotels"
          />
          <StatBox
            icon={<ResortIcon className="h-[18px] w-[18px]" />}
            value={cluster.families.resorts.toLocaleString()}
            label="Resorts"
          />
          <StatBox
            icon={<VillaIcon className="h-[18px] w-[18px]" />}
            value={cluster.families.villas.toLocaleString()}
            label="Villas"
          />
          {/* THE PRICE STAT IS DERIVED, NOT DECORATIVE.
              The reference mock shows a flat "From $45", which is a design
              placeholder — as a shipped number it would be a price quoted to a
              user that no system produced. This is the cheapest LIVE quote among
              the properties rendered directly below, so the stat and the cards
              can never disagree, and it is absent whenever no live quote came
              back rather than falling back to a plausible-looking figure. */}
          <StatBox
            icon={
              <svg className="h-[18px] w-[18px]" viewBox="0 0 20 20" fill="none" aria-hidden>
                <path
                  d="M10 3v14M6 7l4-4 4 4M6 13l4 4 4-4"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            }
            value={
              pricesPending ? (
                <span className="inline-block h-3 w-10 animate-pulse rounded bg-[#E2E8F0]" />
              ) : cheapest?.perNight !== undefined ? (
                `From $${Math.round(cheapest.perNight).toLocaleString()}`
              ) : (
                "—"
              )
            }
            label={cheapest?.perNight !== undefined ? "Live / night" : "No live rate"}
          />
        </div>

        {/* --- top properties ------------------------------------------------ */}
        <div className="px-4 pb-3 pt-3">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-bold text-[#1E293B]">Top Properties</p>
            {cluster.count > members.length && (
              <button
                type="button"
                onClick={onViewAll}
                className="flex items-center gap-1 text-[12px] font-semibold text-[#2563EB] transition-opacity hover:opacity-75"
              >
                View all <ArrowRightIcon />
              </button>
            )}
          </div>

          <div className="mt-2.5 grid grid-cols-3 gap-2.5">
            {priced.map((m) => (
              <PropertyCardWithPrice
                key={m.id}
                member={m}
                image={imageFor(m)}
                preview={m.placeId ? places.get(m.placeId) : undefined}
                price={prices.get(m.id) ?? { state: "idle" }}
                onOpen={() => onOpenProperty(m)}
              />
            ))}
          </div>
        </div>

        {/* --- top restaurants ------------------------------------------------ */}
        <div className="border-t border-[#F1F5F9] px-4 pb-3 pt-3">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-bold text-[#1E293B]">Top Restaurants</p>
            {restaurants.kind === "ready" && restaurants.places.length > 3 && (
              <span className="text-[11px] text-[#94A3B8]">
                {restaurants.places.length} nearby
              </span>
            )}
          </div>

          {restaurants.kind === "loading" ? (
            <div className="mt-2.5 grid grid-cols-3 gap-2.5" aria-busy>
              {[0, 1, 2].map((i) => (
                <div key={i}>
                  <div className="h-[72px] animate-pulse rounded-xl bg-[#F1F5F9]" />
                  <div className="mt-1.5 h-2.5 w-3/4 animate-pulse rounded bg-[#F1F5F9]" />
                </div>
              ))}
            </div>
          ) : restaurants.kind === "unavailable" ? (
            // Says WHY, and does not pretend the area has no restaurants.
            <p className="mt-2 text-[11.5px] leading-snug text-[#94A3B8]">
              {restaurants.reason}
            </p>
          ) : restaurants.places.length === 0 ? (
            <p className="mt-2 text-[11.5px] text-[#94A3B8]">
              Google returned no restaurants inside this area.
            </p>
          ) : (
            <>
              <div className="mt-2.5 grid grid-cols-3 gap-2.5">
                {restaurants.places.slice(0, 3).map((r) => (
                  <RestaurantCard key={r.placeId} place={r} />
                ))}
              </div>
              {/* Google requires attribution wherever Places content renders. */}
              {restaurants.attribution && (
                <p className="mt-2 text-[9px] leading-none text-[#CBD5E1]">
                  {restaurants.attribution}
                </p>
              )}
            </>
          )}
        </div>

        {/* --- availability check -------------------------------------------- */}
        <div className="border-t border-[#F1F5F9] px-4 pb-4 pt-3">
          <p className="text-[13px] font-bold text-[#1E293B]">Availability Check</p>
          <div className="mt-2.5 flex items-end gap-2">
            <label className="flex-1">
              <span className="text-[10.5px] font-medium text-[#94A3B8]">Check in</span>
              <div className="mt-1 flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-2.5 py-2 text-[12px] text-[#0F172A]">
                <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-[#94A3B8]" />
                <input
                  type="date"
                  value={checkIn}
                  min={todayISO()}
                  onChange={(e) => {
                    setCheckIn(e.target.value);
                    if (e.target.value >= checkOut) setCheckOut(addDays(e.target.value, 1));
                  }}
                  className="w-full border-none bg-transparent text-[12px] outline-none"
                />
              </div>
            </label>
            <label className="flex-1">
              <span className="text-[10.5px] font-medium text-[#94A3B8]">Check out</span>
              <div className="mt-1 flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-2.5 py-2 text-[12px] text-[#0F172A]">
                <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-[#94A3B8]" />
                <input
                  type="date"
                  value={checkOut}
                  min={addDays(checkIn, 1)}
                  onChange={(e) => setCheckOut(e.target.value)}
                  className="w-full border-none bg-transparent text-[12px] outline-none"
                />
              </div>
            </label>
            <label className="w-[72px] shrink-0">
              <span className="text-[10.5px] font-medium text-[#94A3B8]">Guests</span>
              <div className="mt-1 flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-2.5 py-2 text-[12px] text-[#0F172A]">
                <GuestsIcon className="h-3.5 w-3.5 shrink-0 text-[#94A3B8]" />
                <select
                  value={guests}
                  onChange={(e) => setGuests(Number(e.target.value))}
                  className="w-full border-none bg-transparent text-[12px] outline-none"
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
            </label>
          </div>

          <button
            type="button"
            onClick={() => onSearchArea(checkIn, checkOut, guests)}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[#2563EB] px-4 py-2.5 text-[13.5px] font-semibold text-white shadow-sm transition-colors hover:bg-[#1D4ED8] active:bg-[#1E40AF]"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" aria-hidden>
              <circle cx="9" cy="9" r="6.25" stroke="currentColor" strokeWidth="1.8" />
              <path d="m13.6 13.6 3.4 3.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            Search this area
          </button>
        </div>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Stat box — the four icons above the properties.
// ---------------------------------------------------------------------------

function StatBox({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: React.ReactNode;
  label: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[#334155]">{icon}</span>
      <span className="text-[15px] font-bold leading-none text-[#0F172A]">{value}</span>
      <span className="text-[11px] leading-none text-[#94A3B8]">{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Property mini-card with live pricing.
// ---------------------------------------------------------------------------

function PropertyCardWithPrice({
  member,
  image,
  preview,
  price,
  onOpen,
}: {
  member: ClusterMember;
  image: { url?: string; credit?: string };
  preview?: PreviewPlace;
  price: LivePrice;
  onOpen: () => void;
}) {
  const category = LUXURY_MAP_CATEGORIES.find((c) => member.categories.includes(c.id));
  const typeLabel = category?.label ?? prettyType(member.propertyType);

  // Star rating or Google rating.
  const score = preview?.rating ?? (member.stars ? member.stars : undefined);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group min-w-0 text-left transition-transform duration-200 hover:-translate-y-0.5"
    >
      <div className="h-[100px] overflow-hidden rounded-xl bg-[#F1F5F9]">
        {image.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image.url}
            alt={member.name}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
            loading="lazy"
          />
        ) : (
          <span
            className="flex h-full w-full items-center justify-center"
            style={{
              background: category ? `${category.color}14` : undefined,
              color: category?.color ?? "#94A3B8",
            }}
            aria-hidden
          >
            <HotelIcon className="h-6 w-6" />
          </span>
        )}
      </div>

      <p className="mt-1.5 truncate text-[11.5px] font-semibold leading-tight text-[#0F172A]">
        {member.name}
      </p>

      <p className="mt-0.5 flex items-center gap-1 truncate text-[10.5px] text-[#64748B]">
        {score !== undefined && (
          <>
            <StarIcon className="h-3 w-3 shrink-0 text-[#F4B400]" />
            <span className="font-semibold text-[#0F172A]">{score.toFixed(1)}</span>
          </>
        )}
        {typeLabel && (
          <span className="truncate rounded bg-[#F1F5F9] px-1 py-0.5 text-[9.5px] font-medium text-[#64748B]">
            {typeLabel}
          </span>
        )}
      </p>

      {/* Price line.
          Only a LIVE quote renders as a price. Every other state collapses to
          "Price on request" — a sandbox rate looks exactly like a real one on
          screen, so showing it would be indistinguishable from quoting a number
          nobody can book. The `title` keeps the states separable for anyone
          debugging, without putting the distinction in front of the reader. */}
      <div className="mt-1 text-[12px]">
        {price.state === "loading" || price.state === "idle" ? (
          <span className="inline-block h-3 w-12 animate-pulse rounded bg-[#E2E8F0]" />
        ) : price.state === "available" && price.perNight !== undefined ? (
          <span className="font-bold text-[#0F172A]">
            ${Math.round(price.perNight).toLocaleString()}
            <span className="font-normal text-[#94A3B8]"> / night</span>
          </span>
        ) : (
          <span
            className="text-[10.5px] font-medium text-[#94A3B8]"
            title={
              price.state === "sandbox"
                ? "A sandbox rate was returned; only live rates are shown as prices."
                : "No live rate was available for these dates."
            }
          >
            Price on request
          </span>
        )}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Restaurant mini-card. Every field comes from Google or is omitted.
// ---------------------------------------------------------------------------

function RestaurantCard({ place }: { place: GooglePlace }) {
  const photo = place.photos?.[0];
  const band = priceBand(place.priceLevel);
  const cuisine = cuisineLabel(place);

  return (
    <a
      href={place.googleMapsUri ?? place.websiteUri ?? "#"}
      target="_blank"
      rel="noopener noreferrer"
      className="group min-w-0 text-left transition-transform duration-200 hover:-translate-y-0.5"
    >
      <div className="h-[72px] overflow-hidden rounded-xl bg-[#F1F5F9]">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoProxyUrl(photo.name, 320)}
            alt={place.name}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
            loading="lazy"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-[#CBD5E1]" aria-hidden>
            <DiningIcon className="h-5 w-5" />
          </span>
        )}
      </div>

      <p className="mt-1.5 truncate text-[11.5px] font-semibold leading-tight text-[#0F172A]">
        {place.name}
      </p>

      <p className="mt-0.5 flex items-center gap-1 truncate text-[10.5px] text-[#64748B]">
        {place.rating !== undefined && (
          <>
            <StarIcon className="h-3 w-3 shrink-0 text-[#F4B400]" />
            <span className="font-semibold text-[#0F172A]">{place.rating.toFixed(1)}</span>
          </>
        )}
        {/* Only rendered when Google actually banded the venue. */}
        {band && <span className="shrink-0 font-medium text-[#64748B]">{band}</span>}
      </p>

      {cuisine && (
        <span className="mt-0.5 inline-block truncate rounded bg-[#F1F5F9] px-1 py-0.5 text-[9.5px] font-medium text-[#64748B]">
          {cuisine}
        </span>
      )}
    </a>
  );
}

function prettyType(t: string | undefined): string {
  if (!t) return "";
  const v = t.replace(/_/g, " ").trim();
  return v ? v[0].toUpperCase() + v.slice(1) : "";
}
