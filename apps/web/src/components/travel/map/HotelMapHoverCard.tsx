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

/** The destination card carries a stats row and three properties, so it needs
 *  the width. */
const CARD_W = 440;
/** A single property has one image and four lines of text. At 440 it read as a
 *  panel that had lost its page; this is a preview that sits ON the map. */
const CARD_W_PROPERTY = 320;
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
  const [state, setState] = useState<PreviewState>("idle");

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

/** How the on-demand photography lookup is currently getting on. Named so the
 *  preview component can be handed it rather than re-deriving it. */
export type PreviewState =
  | "idle" | "loading" | "ready" | "rate-limited" | "unconfigured" | "failed";

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
  height: number,
  width: number
): { left: number; top: number; maxHeight: number; side: "left" | "right"; width: number } {
  const vw = typeof window === "undefined" ? 1440 : window.innerWidth;
  const vh = typeof window === "undefined" ? 900 : window.innerHeight;

  // On a narrow screen the card must not be wider than the screen. Clamped
  // before anything is positioned, so the flip below reasons about the width
  // the card will actually have.
  const w = Math.min(width, vw - CARD_MARGIN * 2);

  const side: "left" | "right" = anchor.x + w + 56 > vw ? "left" : "right";
  let left = side === "right" ? anchor.x + 28 : anchor.x - w - 28;
  // Flipping handles the common case; this catches the rest — a marker close to
  // BOTH edges on a phone, where neither side has room and the card would
  // otherwise hang off the screen.
  left = Math.max(CARD_MARGIN, Math.min(left, vw - CARD_MARGIN - w));

  // The card may never be taller than the space between the header and the
  // bottom margin; past that it scrolls internally rather than off-screen.
  const available = vh - HEADER_CLEARANCE - CARD_MARGIN;
  const effective = Math.min(height, available);

  let top = anchor.y - effective / 2;
  top = Math.max(HEADER_CLEARANCE, Math.min(top, vh - CARD_MARGIN - effective));

  return { left, top, maxHeight: available, side, width: w };
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
            // THE PICTURE THE POINT ALREADY CARRIES. Omitting these made a
            // single-property card ask Google for a photograph the dataset was
            // already holding: imageFor() found no local file, no Commons URL,
            // and fell through to the Places lookup. That is a billable call
            // per hover for the 150 properties whose photograph ships with the
            // app, and it left the hero reading "Loading photography…" whenever
            // that call was slow, rate-limited or unconfigured.
            imageLocalPath: target.point.imageLocalPath,
            imageUrl: target.point.imageUrl,
            imageThumbUrl: target.point.imageThumbUrl,
            imageCredit: target.point.imageCredit,
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

  const pos = place(anchor, height, target.kind === "cluster" ? CARD_W : CARD_W_PROPERTY);
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
        width: pos.width,
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

      {target.kind === "cluster" ? (
        <>
        {/* --- header ------------------------------------------------------- */}
        {/* A faint wash behind the header separates the destination's identity
            from the photograph below it without drawing a rule. */}
        <div className="flex items-center gap-3 rounded-t-[19px] bg-gradient-to-b from-[#F0F4FF] to-white px-4 pb-3 pt-4">
          <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full bg-[#F1F5F9] ring-2 ring-white shadow-sm">
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
            <span className="flex shrink-0 items-center gap-1 rounded-full border border-[#D4DEFF] bg-white px-2.5 py-1 text-[13px] font-bold text-[#0F172A] shadow-sm">
              <StarIcon className="h-3.5 w-3.5 shrink-0 text-[#F4B400]" /> {rating.toFixed(1)}
            </span>
          )}
          {/* A CLUSTER is not savable: "save this region" is not something the
              wishlist can hold. The properties inside it are each savable from
              their own card, and a single property saves from its preview. */}
        </div>

        {/* --- hero --------------------------------------------------------- */}
        <div className="relative mx-4 h-[160px] overflow-hidden rounded-2xl bg-[#F1F5F9]">
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
          <div className="mt-4 grid grid-cols-4 gap-2 border-b border-[#F1F5F9] px-4 pb-4">
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

        {/* --- top properties ------------------------------------------------ */}
        <div className="px-4 pb-4 pt-3">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-bold text-[#1E293B]">
              Top Properties
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
        </>
      ) : (
        <PropertyPreview
          point={target.point}
          image={heroImage}
          state={state}
          saved={savedIds.has(target.point.id)}
          onOpen={() => onOpenProperty(target.point)}
        />
      )}
    </div>
  );
}

/**
 * The single-property preview.
 *
 * WHY THIS IS NOT THE CLUSTER LAYOUT WITH ONE ITEM IN IT. It used to be, and it
 * read badly: the name appeared in the header and then again on the mini-card
 * below it, the photograph sat inset in a box under both, and a card describing
 * ONE hotel stood as tall as one describing a whole region. Reading the same
 * name twice is the tell that a layout is being reused rather than designed.
 *
 * The order here is the order the question actually gets asked: what does it
 * look like, what is it called, how good is it, where is it. The image leads at
 * full bleed because on a map a photograph identifies a property faster than
 * its name does.
 */
function PropertyPreview({
  point, image, state, saved, onOpen,
}: {
  point: MapPoint;
  image: { url?: string; credit?: string };
  state: PreviewState;
  saved: boolean;
  onOpen: () => void;
}) {
  const location = [point.city, point.country].filter(Boolean).join(", ");
  // TWO DIFFERENT MEASUREMENTS, never blended. `stars` is an official
  // classification a source recorded; `rating` is what visitors scored it. A
  // curated property usually has the first, a Google-discovered one the second,
  // and the suffix below says which is on screen so a 4.3 average is never
  // mistaken for a 4-star classification.
  const stars = typeof point.stars === "number" ? point.stars : undefined;
  const rating = typeof point.rating === "number" ? point.rating : undefined;
  const score = stars ?? rating;
  const scoreNote = stars !== undefined
    ? "Star classification"
    : rating !== undefined
      ? `Google rating${point.ratingCount ? ` · ${point.ratingCount.toLocaleString()} reviews` : ""}`
      : null;
  // A FurlPay collection names the property better than a raw source type, so
  // it wins when there is one.
  const typeLabel =
    LUXURY_MAP_CATEGORIES.find((c) => (point.categories ?? []).includes(c.id))?.label ??
    prettyType(point.hotelType);

  return (
    <>
      {/* --- hero, full bleed --------------------------------------------- */}
      {/* rounded-t-[19px] rather than 20: the hero sits INSIDE a 20px card with
          a 1px border, so matching the outer radius exactly leaves a hairline of
          border showing through at the corners. */}
      <div className="relative h-[180px] overflow-hidden rounded-t-[19px] bg-[#F1F5F9]">
        {image.url ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image.url}
              alt={point.name}
              className="h-full w-full object-cover"
              loading="lazy"
            />
            {/* Attribution travels with the picture: a licence condition for
                Commons, a policy requirement for Google. */}
            {/* A scrim rather than a heavier chip: the credit has to stay
                readable over a bright photograph without putting a black box on
                top of the thing the reader is looking at. */}
            <span
              className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-black/35 to-transparent"
              aria-hidden
            />
            {image.credit && (
              <span className="absolute bottom-1.5 right-2 max-w-[70%] truncate rounded px-1.5 py-0.5 text-[9.5px] font-medium text-white/95">
                {image.credit}
              </span>
            )}
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 text-[#94A3B8]">
            <HotelIcon className="h-7 w-7" />
            <span className="px-4 text-center text-[11.5px]">
              {state === "loading"
                ? "Loading photography…"
                : state === "rate-limited"
                  ? "Too many previews — pausing briefly"
                  : state === "failed"
                    ? "Photography could not be loaded"
                    : "No photograph available"}
            </span>
          </div>
        )}

        {/* Saving is the one action worth having on a preview, and it sits on
            the image rather than competing with the name for a line. */}
        <div className="absolute right-2 top-2">
          <SaveButton
            size="sm"
            saved={saved}
            place={{
              id: point.id,
              name: point.name,
              latitude: point.latitude,
              longitude: point.longitude,
              city: point.city,
              country: point.country,
            }}
            className="border-white/60 bg-white/90 text-[#64748B] shadow-sm backdrop-blur hover:bg-white hover:text-[#0F172A]"
          />
        </div>
      </div>

      {/* --- information --------------------------------------------------- */}
      <div className="px-4 pb-3.5 pt-3">
        {/* Two lines then ellipsis. Hotel names run long, and a preview that
            grows to fit one starts covering the map it is describing. */}
        <p className="line-clamp-2 text-[15px] font-semibold leading-snug tracking-[-0.01em] text-[#0F172A]">
          {point.name}
        </p>

        <div className="mt-2 flex items-center gap-2 text-[12.5px]">
          {score !== undefined && (
            <span className="flex shrink-0 items-center gap-1" title={scoreNote ?? undefined}>
              <StarIcon className="h-4 w-4 shrink-0 text-[#F4B400]" />
              <span className="font-semibold text-[#0F172A]">{score.toFixed(1)}</span>
              {/* The review count is the tell that this is an average rather
                  than a classification, so it rides beside the number. */}
              {stars === undefined && point.ratingCount ? (
                <span className="text-[11px] text-[#94A3B8]">
                  ({point.ratingCount.toLocaleString()})
                </span>
              ) : null}
            </span>
          )}
          {score !== undefined && typeLabel ? <span className="text-[#CBD5E1]">·</span> : null}
          {typeLabel ? <span className="truncate text-[#64748B]">{typeLabel}</span> : null}
        </div>

        {location ? (
          <p className="mt-1 truncate text-[12px] text-[#94A3B8]">{location}</p>
        ) : null}

        {/* NO PRICE SLOT, deliberately. Duffel runs in test mode on this
            deployment, so any rate here would be a sandbox figure — and a wrong
            price is the single thing that would make the whole surface
            untrustworthy. Omitted rather than filled with a placeholder. */}

        <div className="mt-2.5 flex items-center justify-between border-t border-[#F1F5F9] pt-2.5">
          <span
            className="truncate text-[11.5px] font-medium text-[#94A3B8]"
            title={
              point.precision === "exact"
                ? "Position verified against Google Places"
                : "Position could not be confirmed; the curated coordinate stands"
            }
          >
            {point.source === "osm"
              ? "OpenStreetMap"
              : point.source === "google"
                ? "Powered by Google"
                : // A registry pin can come from Overture, OSM, a tourism
                  // registry or a direct booking engine, and the row records
                  // which. Naming one of them here would be a guess, so the
                  // label states what is actually known: it is in the global
                  // registry and FurlPay has not curated it.
                  point.source === "registry"
                  ? "Global registry"
                  : point.precision === "exact"
                  ? "Position confirmed"
                  : "Approximate position"}
          </span>
          <button
            type="button"
            onClick={onOpen}
            className="flex shrink-0 items-center gap-1 rounded-full bg-[#ECF7F1] px-2.5 py-1 text-[12px] font-semibold text-[#1B7A4E] transition-colors hover:bg-[#DCEFE5]"
          >
            View details
            <ArrowRightIcon />
          </button>
        </div>
      </div>
    </>
  );
}

/** "resort_hotel" -> "Resort hotel". Used only when a property carries no
 *  FurlPay collection to name it by. */
function prettyType(t: string | undefined): string {
  if (!t) return "";
  const v = t.replace(/_/g, " ").trim();
  return v ? v[0].toUpperCase() + v.slice(1) : "";
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
        className={`overflow-hidden rounded-xl bg-[#F1F5F9] ${wide ? "h-[140px]" : "h-[120px]"}`}
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
