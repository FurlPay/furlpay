"use client";

import { useEffect, useRef, useState } from "react";
import type { MapCluster, MapPoint } from "@/app/api/travel/hotels/map/route";
import type { PreviewPlace, PreviewResponse } from "@/app/api/travel/hotels/preview/route";
import type { ClusterMember } from "@/lib/hotels/curated";
import { LUXURY_MAP_CATEGORIES } from "@/lib/hotels/luxuryTiers";
import SaveButton, { useSavedIds } from "./SaveButton";
import {
  ArrowRightIcon,
  CategoryIcon,
  HotelIcon,
  ResortIcon,
  StarIcon,
  VerifiedIcon,
  VillaIcon,
} from "./icons";

// ---------------------------------------------------------------------------
// The hover card.
//
// Anchored to its marker with a pointer, flips at the viewport edges, and stays
// open while the cursor travels into it. That last part is what makes the card
// usable rather than a tooltip you can never reach — see the grace delay in
// HotelMap.tsx, which owns the open/close timing.
//
// WHAT IS REAL HERE, AND WHAT IS DELIBERATELY ABSENT.
//
// Real, from the dataset: the place name, the property count, the split across
// hotels/resorts/villas, how many positions are confirmed, and the names, star
// ratings and categories of the top properties. The three family numbers always
// sum to the count, because familyOf() is a complete partition.
//
// Real, from Google, fetched once per card and held in memory for the session:
// the hero photograph, the thumbnails and the ratings.
//
// ABSENT: nightly prices. Duffel is in test mode on this deployment, so a rate
// it returns is a sandbox figure. A price is the single most consequential
// number on a travel surface and a sandbox one rendered in the same style as a
// real one is indistinguishable from a lie. The layout keeps the slot; it fills
// when a live key is configured and the price route reports a real quote.
// ---------------------------------------------------------------------------

/** Where the card sits relative to its marker. */
export interface Anchor {
  x: number;
  y: number;
}

const CARD_W = 440;
const CARD_MARGIN = 16;
/**
 * Height used before the card has been measured once.
 *
 * ONLY A FIRST GUESS. The real height varies — a single property renders one
 * wide image, a cluster renders three thumbnails, and the category row is
 * conditional — so this used to be a fixed 560 that drove both the viewport
 * clamp and the pointer position. When it was wrong the arrow stopped aiming at
 * its marker, and on a viewport under ~680px the card ran off the bottom of the
 * window with no way to scroll it. A ResizeObserver replaces the guess with the
 * measurement on the first frame.
 */
const CARD_FALLBACK_H = 520;
/** Clears the floating header, which the card must never open underneath. */
const HEADER_CLEARANCE = 104;

export type HoverTarget =
  | { kind: "cluster"; cluster: MapCluster }
  | { kind: "property"; point: MapPoint };

/**
 * Session-lifetime memo of Places lookups.
 *
 * In memory only, and deliberately so: the Places policy permits storing the
 * place ID and not the content behind it. Keeping a photo URL alive for as long
 * as the tab is open is display; writing it to storage would not be. A reload
 * re-fetches, which is the correct cost.
 */
const previewCache = new Map<string, PreviewPlace>();

function usePreview(placeIds: string[]) {
  const key = placeIds.join(",");
  const [places, setPlaces] = useState<Map<string, PreviewPlace>>(new Map());
  // Four distinct outcomes, because they call for four different messages.
  // These were one `unavailable` state rendering "Photography not configured",
  // which told a user who had simply hovered too fast that their deployment was
  // misconfigured.
  const [state, setState] = useState<
    "idle" | "loading" | "ready" | "rate-limited" | "unconfigured" | "failed"
  >("idle");

  useEffect(() => {
    if (!placeIds.length) {
      setState("idle");
      return;
    }

    const known = new Map<string, PreviewPlace>();
    const missing: string[] = [];
    for (const id of placeIds) {
      const hit = previewCache.get(id);
      if (hit) known.set(id, hit);
      else missing.push(id);
    }
    setPlaces(known);

    if (!missing.length) {
      setState("ready");
      return;
    }

    const ac = new AbortController();
    setState("loading");
    (async () => {
      try {
        const res = await fetch(
          `/api/travel/hotels/preview?placeIds=${encodeURIComponent(missing.join(","))}`,
          { signal: ac.signal }
        );
        if (res.status === 429) {
          setState("rate-limited");
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        const data: PreviewResponse = await res.json();
        for (const p of data.places) previewCache.set(p.placeId, p);
        // Remember the misses too, so a property Google has nothing for is not
        // re-requested on every single hover.
        for (const id of data.missing) {
          previewCache.set(id, { placeId: id, name: "" });
        }
        const next = new Map(known);
        for (const p of data.places) next.set(p.placeId, p);
        setPlaces(next);
        setState(data.configured ? "ready" : "unconfigured");
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

/**
 * Place the card so it never leaves the viewport, flipping across the marker
 * rather than sliding, so the pointer keeps aiming at the thing it describes.
 *
 * `height` is the MEASURED height once one frame has rendered. Everything that
 * used to be computed from a constant — the vertical clamp, the maximum height,
 * and where the arrow sits — now comes from what the card actually is.
 */
function place(
  anchor: Anchor,
  height: number
): { left: number; top: number; maxHeight: number; side: "left" | "right" } {
  const vw = typeof window === "undefined" ? 1440 : window.innerWidth;
  const vh = typeof window === "undefined" ? 900 : window.innerHeight;

  const side: "left" | "right" = anchor.x + CARD_W + 56 > vw ? "left" : "right";
  const left = side === "right" ? anchor.x + 28 : anchor.x - CARD_W - 28;

  // The card may never be taller than the space between the header and the
  // bottom margin; past that it scrolls internally rather than off-screen.
  const available = vh - HEADER_CLEARANCE - CARD_MARGIN;
  const effective = Math.min(height, available);

  let top = anchor.y - effective / 2;
  top = Math.max(HEADER_CLEARANCE, Math.min(top, vh - CARD_MARGIN - effective));

  return { left, top, maxHeight: available, side };
}

export default function HotelMapHoverCard({
  target,
  anchor,
  onEnter,
  onLeave,
  onOpenProperty,
  onViewAll,
}: {
  target: HoverTarget;
  anchor: Anchor;
  onEnter: () => void;
  onLeave: () => void;
  onOpenProperty: (m: ClusterMember | MapPoint) => void;
  onViewAll: () => void;
}) {
  const savedIds = useSavedIds();
  const members: ClusterMember[] =
    target.kind === "cluster"
      ? target.cluster.top
      : [
          {
            id: target.point.id,
            name: target.point.name,
            city: target.point.city,
            country: target.point.country,
            propertyType: target.point.hotelType,
            stars: target.point.stars,
            categories: target.point.categories ?? [],
            precision: target.point.precision ?? "approximate",
            placeId: target.point.placeId,
            latitude: target.point.latitude,
            longitude: target.point.longitude,
          },
        ];

  // STORED IMAGERY FIRST, GOOGLE ONLY FOR THE GAPS.
  //
  // A Commons picture is already in the dataset, costs nothing and needs no
  // key, so it is used wherever it exists. Google is asked only about the
  // properties Wikidata had nothing for — which turns a four-call card into a
  // one- or two-call card, and into a zero-call card for the well-documented
  // properties people look at most.
  const needGoogle = members
    .filter((m) => !m.imageLocalPath && !m.imageUrl && m.placeId)
    .map((m) => m.placeId as string);
  const { places, state } = usePreview(needGoogle);

  /** The best picture for a member, whatever source it came from. */
  const imageFor = (m: ClusterMember): { url?: string; credit?: string } => {
    // Local file, then Commons, then Google. Each step is slower and less
    // reliable than the one before it.
    if (m.imageLocalPath) return { url: m.imageLocalPath, credit: m.imageCredit };
    if (m.imageUrl) return { url: m.imageUrl, credit: m.imageCredit };
    const g = m.placeId ? places.get(m.placeId) : undefined;
    return { url: g?.photoUrl, credit: g?.photoCredit };
  };

  const hero = members.find((m) => imageFor(m).url);
  const heroImage = hero ? imageFor(hero) : { url: undefined, credit: undefined };
  const heroPlace = hero?.placeId ? places.get(hero.placeId) : undefined;

  // Measure the card, then position from the measurement. `height` starts at
  // the fallback and is corrected on the first frame, so a wrong guess costs one
  // repaint rather than a permanently misaimed arrow.
  const cardRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(CARD_FALLBACK_H);
  useEffect(() => {
    const el = cardRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const h = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
      if (h > 0) setHeight(h);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pos = place(anchor, height);
  // The arrow tracks the marker within the card's real bounds, so it keeps
  // pointing at the thing the card describes even when the card was clamped.
  const pointerTop = Math.max(28, Math.min(Math.min(height, pos.maxHeight) - 40, anchor.y - pos.top));

  const title = target.kind === "cluster" ? target.cluster.label : target.point.name;
  const subtitle =
    target.kind === "cluster"
      ? target.cluster.sublabel
      : [target.point.city, target.point.country].filter(Boolean).join(", ");

  const rating = heroPlace?.rating;

  return (
    <div
      ref={cardRef}
      className="hm-card pointer-events-auto absolute z-40"
      style={{
        left: pos.left,
        top: pos.top,
        width: CARD_W,
        maxHeight: pos.maxHeight,
        overflowY: "auto",
      }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      role="dialog"
      aria-label={title}
    >
      <span
        className={`hm-card__pointer ${pos.side === "right" ? "hm-card__pointer--left" : "hm-card__pointer--right"}`}
        style={{ top: pointerTop }}
        aria-hidden
      />

      {/* --- header ------------------------------------------------------- */}
      <div className="flex items-center gap-3 px-4 pb-3 pt-4">
        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full bg-[#F1F5F9] ring-1 ring-[#E2E8F0]">
          {heroImage.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={heroImage.url} alt="" className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-[#94A3B8]">
              <HotelIcon />
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[17px] font-bold leading-tight text-[#0F172A]">{title}</p>
          <p className="mt-0.5 truncate text-[13px] text-[#64748B]">{subtitle}</p>
        </div>
        {/* The rating pill renders only when Google actually has a rating.
            There is no default and no placeholder star. */}
        {rating !== undefined && (
          <span className="flex shrink-0 items-center gap-1 rounded-full border border-[#E2E8F0] bg-white px-2.5 py-1 text-[13px] font-bold text-[#0F172A]">
            <StarIcon className="h-3.5 w-3.5 shrink-0 text-[#F4B400]" /> {rating.toFixed(1)}
          </span>
        )}
        {/* A single property can be saved from here — the fastest path there
            is, since hovering a marker is already how you look at one. A
            CLUSTER cannot: "save this region" is not a thing the wishlist can
            hold, and the individual properties are each savable from their own
            card below. */}
        {target.kind === "property" && (
          <SaveButton
            size="sm"
            saved={savedIds.has(target.point.id)}
            place={{
              id: target.point.id,
              name: target.point.name,
              latitude: target.point.latitude,
              longitude: target.point.longitude,
              city: target.point.city,
              country: target.point.country,
            }}
            className="border-[#E2E8F0] bg-white text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#0F172A]"
          />
        )}
      </div>

      {/* --- hero --------------------------------------------------------- */}
      <div className="relative mx-4 h-[150px] overflow-hidden rounded-xl bg-[#F1F5F9]">
        {heroImage.url ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={heroImage.url}
              alt={hero?.name ?? title}
              className="h-full w-full object-cover"
              loading="lazy"
            />
            {/* Attribution travels with the picture. For Commons it is the
                licence condition; for Google it is the policy requirement. */}
            {heroImage.credit && (
              <span className="absolute bottom-1 right-1.5 max-w-[70%] truncate rounded bg-black/45 px-1.5 py-0.5 text-[9.5px] text-white/90">
                {heroImage.credit}
              </span>
            )}
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-[12.5px] text-[#94A3B8]">
            {state === "loading"
              ? "Loading photography…"
              : state === "rate-limited"
                ? "Too many previews — pausing briefly"
                : state === "unconfigured"
                  ? "Photography not configured"
                  : state === "failed"
                    ? "Photography could not be loaded"
                    : "No photograph available"}
          </div>
        )}
      </div>

      {/* --- statistics ---------------------------------------------------- */}
      {target.kind === "cluster" ? (
        <div className="mt-3.5 grid grid-cols-4 gap-1 border-b border-[#F1F5F9] px-4 pb-3.5">
          <Stat icon={<HotelIcon />} value={target.cluster.families.hotels} label="Hotels" />
          <Stat icon={<ResortIcon />} value={target.cluster.families.resorts} label="Resorts" />
          <Stat icon={<VillaIcon />} value={target.cluster.families.villas} label="Villas" />
          {/* The fourth column is "confirmed", not an average nightly rate. The
              dataset holds no prices, and this is the number it does hold that
              a traveller has a reason to care about. */}
          <Stat
            icon={<VerifiedIcon />}
            value={target.cluster.confirmed}
            label="Confirmed"
            title="Positions verified against Google Places"
          />
        </div>
      ) : (
        <div className="mt-3.5 flex flex-wrap gap-1.5 border-b border-[#F1F5F9] px-4 pb-3.5">
          {(target.point.categories ?? []).map((id) => {
            const c = LUXURY_MAP_CATEGORIES.find((x) => x.id === id);
            if (!c) return null;
            return (
              <span
                key={id}
                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold"
                style={{ background: `${c.color}1A`, color: c.color }}
              >
                <CategoryIcon id={id} className="h-3.5 w-3.5 shrink-0" />
                {c.label}
              </span>
            );
          })}
        </div>
      )}

      {/* --- top properties ------------------------------------------------ */}
      <div className="px-4 pb-4 pt-3">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-bold text-[#1E293B]">
            {target.kind === "cluster" ? "Top Properties" : "Property"}
          </p>
          {target.kind === "cluster" && target.cluster.count > members.length && (
            <button
              type="button"
              onClick={onViewAll}
              className="flex items-center gap-1 text-[12px] font-semibold text-[#1B7A4E] transition-opacity hover:opacity-75"
            >
              View all
              <ArrowRightIcon />
            </button>
          )}
        </div>

        <div className={`mt-2.5 grid gap-2.5 ${members.length === 1 ? "grid-cols-1" : "grid-cols-3"}`}>
          {members.map((m) => (
            <PropertyCard
              key={m.id}
              member={m}
              image={imageFor(m)}
              preview={m.placeId ? places.get(m.placeId) : undefined}
              wide={members.length === 1}
              onOpen={() => onOpenProperty(m)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({
  icon, value, label, title,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
  title?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1" title={title}>
      <span className="text-[#334155]">{icon}</span>
      <span className="text-[15px] font-bold leading-none text-[#0F172A]">{value}</span>
      <span className="text-[11px] leading-none text-[#94A3B8]">{label}</span>
    </div>
  );
}

function PropertyCard({
  member, image, preview, wide, onOpen,
}: {
  member: ClusterMember;
  image: { url?: string; credit?: string };
  preview?: PreviewPlace;
  wide: boolean;
  onOpen: () => void;
}) {
  const category = LUXURY_MAP_CATEGORIES.find((c) => member.categories.includes(c.id));

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group min-w-0 text-left transition-transform duration-200 hover:-translate-y-0.5"
    >
      <div
        className={`overflow-hidden rounded-lg bg-[#F1F5F9] ${wide ? "h-[140px]" : "h-[115px]"}`}
      >
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
            {category ? (
              <CategoryIcon id={category.id} className="h-6 w-6" />
            ) : (
              <HotelIcon className="h-6 w-6" />
            )}
          </span>
        )}
      </div>

      <p className="mt-1.5 truncate text-[12px] font-semibold text-[#0F172A]">{member.name}</p>

      <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-[#64748B]">
        {/* Google's rating when it exists, otherwise the recorded star class.
            Two different measurements, so they are never blended into one. */}
        {preview?.rating !== undefined ? (
          <>
            <StarIcon className="h-3.5 w-3.5 shrink-0 text-[#F4B400]" />
            <span className="font-semibold text-[#0F172A]">{preview.rating.toFixed(1)}</span>
          </>
        ) : member.stars ? (
          <>
            <StarIcon className="h-3.5 w-3.5 shrink-0 text-[#F4B400]" />
            <span className="font-semibold text-[#0F172A]">{member.stars}.0</span>
          </>
        ) : null}
        <span className="truncate">{member.propertyType}</span>
      </p>

      {/* The price slot. Deliberately not a number: this deployment's Duffel key
          is a test key, so any rate it returns is a sandbox figure. */}
      <p className="mt-1 truncate text-[11px] font-medium text-[#94A3B8]">
        {member.precision === "exact" ? "Position confirmed" : "Approximate position"}
      </p>
    </button>
  );
}
