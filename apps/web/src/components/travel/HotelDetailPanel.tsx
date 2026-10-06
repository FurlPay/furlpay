"use client";

import { useEffect, useRef, useState } from "react";
import type { HotelDetailResponse } from "@/app/api/travel/hotels/detail/route";
import SaveButton, { useSavedIds } from "./map/SaveButton";

// ---------------------------------------------------------------------------
// Hotel detail panel.
//
// WHY THIS IS BESIDE THE MAP AND NOT ON IT. Google's Places policy allows
// Places content to be shown on a Google map, or off a map entirely with Google
// attribution. It does not allow Places content rendered as markers on a
// non-Google map. So the pins stay OSM — Google never touches the map surface —
// and everything Google knows lives in this panel, which is not a map.
//
// The "Powered by Google" line is not decoration. It is the condition under
// which this content may be displayed at all, so it renders whenever a place
// does, and is not conditional on anything.
//
// FETCHED ON OPEN, NEVER ON PAINT. One panel open is one billed Places call.
// The map draws thousands of markers from OSM for free; this fires only when
// somebody actually opens a hotel.
// ---------------------------------------------------------------------------

export interface DetailTarget {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  city?: string;
  country?: string;
  stars?: number;
  /**
   * Google's place ID, when the resolver established one.
   *
   * This is what fixes the panel for renamed properties. Looking the hotel up
   * by NAME fails exactly where the name is the unreliable part: Google lists
   * "Sofitel Legend Old Cataract Aswan" as "Old Cataract, Aswan", so the search
   * came back empty and the panel reported "No matching place found" for a
   * property whose ID was in the dataset the whole time.
   */
  placeId?: string;
}

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; data: HotelDetailResponse }
  | { kind: "empty" }
  | { kind: "error"; message: string };

export default function HotelDetailPanel({
  target,
  onClose,
}: {
  target: DetailTarget | null;
  onClose: () => void;
}) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [photoIndex, setPhotoIndex] = useState(0);
  const savedIds = useSavedIds();
  const inflight = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!target) {
      setState({ kind: "idle" });
      return;
    }

    // A user clicking down a row of markers must not leave several requests
    // racing to write the panel; the last one wins and the rest are cancelled.
    inflight.current?.abort();
    const ac = new AbortController();
    inflight.current = ac;

    setState({ kind: "loading" });
    setPhotoIndex(0);

    // The ID identifies the property outright; the name and coordinate ride
    // along so the route can still fall back to a search if the ID is retired.
    const params = new URLSearchParams({
      q: target.name,
      lat: String(target.latitude),
      lng: String(target.longitude),
    });
    if (target.placeId) params.set("placeId", target.placeId);

    (async () => {
      try {
        const res = await fetch(`/api/travel/hotels/detail?${params}`, { signal: ac.signal });
        if (res.status === 503) {
          setState({ kind: "error", message: "Hotel detail is not configured" });
          return;
        }
        if (!res.ok) throw new Error(`detail ${res.status}`);
        const data: HotelDetailResponse = await res.json();
        if (!data.place) {
          setState({ kind: "empty" });
          return;
        }
        setState({ kind: "ready", data });
      } catch (e) {
        // Same reasoning as the map fetch: an abort mid-body-read surfaces as a
        // SyntaxError, so the signal is the reliable test.
        if (ac.signal.aborted || (e as Error).name === "AbortError") return;
        setState({ kind: "error", message: "Could not load hotel details" });
      }
    })();

    return () => ac.abort();
  }, [target]);

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [target, onClose]);

  if (!target) return null;

  const place = state.kind === "ready" ? state.data.place : null;
  const photos = place?.photos ?? [];

  return (
    <aside
      role="dialog"
      aria-label={`Details for ${target.name}`}
      // Desktop: a column DOCKED beside the map (in flow, not over it) — the
      // Places content must stay off the map surface. Phones: a bottom sheet.
      className="fixed inset-x-0 bottom-0 z-50 flex max-h-[82dvh] w-full flex-col rounded-t-[22px] border-t border-white/[0.10] bg-[#090D0E] shadow-[0_-20px_60px_rgba(0,0,0,0.5)] lg:static lg:z-auto lg:max-h-none lg:w-[400px] lg:shrink-0 lg:rounded-none lg:border-l lg:border-t-0 lg:shadow-none"
      style={{ animation: "hmSlide 200ms ease-out" }}
    >
      <header className="flex items-start gap-2 border-b border-white/10 p-4">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15.5px] font-bold text-white">
            {place?.name ?? target.name}
          </h2>
          <p className="mt-0.5 truncate text-[12.5px] text-white/55">
            {place?.formattedAddress ??
              [target.city, target.country].filter(Boolean).join(", ") ??
              ""}
          </p>
        </div>
        <SaveButton
          size="sm"
          saved={savedIds.has(target.id)}
          place={{
            id: target.id,
            // The panel's RESOLVED name when it has one: `target.name` can be
            // the dataset's older label for a renamed property, and a saved
            // entry keeping that would be unfindable later.
            name: place?.name ?? target.name,
            latitude: target.latitude,
            longitude: target.longitude,
            city: target.city ?? "",
            country: target.country ?? "",
          }}
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="shrink-0 rounded-lg px-2 py-1 text-[18px] leading-none text-white/50 transition hover:bg-white/10 hover:text-white"
        >
          ×
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        {state.kind === "loading" && (
          <div className="space-y-3 p-4">
            <div className="h-[190px] w-full animate-pulse rounded-xl bg-white/[0.06]" />
            <div className="h-4 w-2/3 animate-pulse rounded bg-white/[0.06]" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-white/[0.06]" />
          </div>
        )}

        {state.kind === "empty" && (
          <p className="p-4 text-[13px] leading-relaxed text-white/60">
            No matching place found. The hotel is on the map because OpenStreetMap has it;
            Google simply has no listing under this name here.
          </p>
        )}

        {state.kind === "error" && (
          <p className="p-4 text-[13px] leading-relaxed text-amber-400/90">{state.message}</p>
        )}

        {place && (
          <>
            {photos.length > 0 ? (
              <div className="relative">
                {/* Plain <img>: these are proxied, short-lived Google URLs that
                    must not be optimised into Next's persistent image cache. */}
                <img
                  src={photos[photoIndex]?.url}
                  alt=""
                  className="h-[210px] w-full bg-white/5 object-cover"
                />
                {photos.length > 1 && (
                  <>
                    <button
                      type="button"
                      aria-label="Previous photo"
                      onClick={() =>
                        setPhotoIndex((i) => (i - 1 + photos.length) % photos.length)
                      }
                      className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 px-2.5 py-1.5 text-white/90 transition hover:bg-black/80"
                    >
                      ‹
                    </button>
                    <button
                      type="button"
                      aria-label="Next photo"
                      onClick={() => setPhotoIndex((i) => (i + 1) % photos.length)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 px-2.5 py-1.5 text-white/90 transition hover:bg-black/80"
                    >
                      ›
                    </button>
                    <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1.5">
                      {photos.map((_, i) => (
                        <span
                          key={i}
                          className={`h-1.5 w-1.5 rounded-full ${
                            i === photoIndex ? "bg-white" : "bg-white/40"
                          }`}
                        />
                      ))}
                    </div>
                  </>
                )}
                {photos[photoIndex]?.credit && (
                  <p className="absolute bottom-1.5 right-2 text-[10px] text-white/70 drop-shadow">
                    © {photos[photoIndex].credit}
                  </p>
                )}
              </div>
            ) : null}

            <div className="space-y-4 p-4">
              {place.rating !== undefined && (
                <div className="flex items-baseline gap-2">
                  <span className="text-[20px] font-bold text-white">
                    {place.rating.toFixed(1)}
                  </span>
                  <span className="text-[13px] text-amber-400">
                    {"★".repeat(Math.round(place.rating))}
                  </span>
                  {place.userRatingCount !== undefined && (
                    <span className="text-[12.5px] text-white/50">
                      {place.userRatingCount.toLocaleString()} reviews
                    </span>
                  )}
                </div>
              )}

              {place.editorialSummary && (
                <p className="text-[13.5px] leading-relaxed text-white/75">
                  {place.editorialSummary}
                </p>
              )}

              {place.types.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {place.types.slice(0, 6).map((t) => (
                    <span
                      key={t}
                      className="rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[11.5px] capitalize text-white/70"
                    >
                      {t.replace(/_/g, " ")}
                    </span>
                  ))}
                </div>
              )}

              {/* Absence of a price is stated, not implied by a blank space.
                  Google has no nightly rates; leaving this out would invite the
                  reader to assume we simply failed to load one. */}
              <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                <p className="text-[12.5px] font-semibold text-white/85">Nightly rate</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-white/55">
                  Not available — Google Places does not publish hotel rates. Live pricing
                  needs a booking supplier.
                </p>
              </div>

              <div className="space-y-1.5 text-[12.5px]">
                {place.websiteUri && (
                  <a
                    href={place.websiteUri}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="block truncate text-sky-400 hover:underline"
                  >
                    {new URL(place.websiteUri).hostname.replace(/^www\./, "")}
                  </a>
                )}
                {place.phone && <p className="text-white/65">{place.phone}</p>}
                {place.businessStatus && place.businessStatus !== "OPERATIONAL" && (
                  <p className="text-amber-400/90">
                    {place.businessStatus.replace(/_/g, " ").toLowerCase()}
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* The one primary action. This map holds no rates, so the next step is
          the live stays search for the hotel's city — the existing booking
          path — rather than a price this panel would have to invent. */}
      {target.city && (
        <div className="border-t border-white/[0.08] p-4">
          <a
            href={`/travel/stays?city=${encodeURIComponent(target.city)}`}
            className="flex h-[46px] w-full items-center justify-center gap-2 rounded-[11px] bg-[#00E6A7] text-[14px] font-bold text-[#030505] transition hover:bg-[#00F0B0] active:scale-[0.985] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            Check rates &amp; book in {target.city}
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </a>
          <p className="mt-2 text-center text-[11px] text-white/45">Live rates come from our booking supplier at search time.</p>
        </div>
      )}

      {/* Required whenever Places content is displayed off a Google map. */}
      {place && (
        <footer className="flex items-center justify-between border-t border-white/10 px-4 py-2.5">
          <span className="text-[11px] text-white/45">
            {state.kind === "ready" ? state.data.attribution : "Powered by Google"}
          </span>
          {place.googleMapsUri && (
            <a
              href={place.googleMapsUri}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-white/45 hover:text-white/70 hover:underline"
            >
              View on Google Maps
            </a>
          )}
        </footer>
      )}
    </aside>
  );
}
