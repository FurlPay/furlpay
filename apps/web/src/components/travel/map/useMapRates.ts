"use client";

import { useEffect, useRef, useState } from "react";
import type { MapPoint } from "@/app/api/travel/hotels/map/route";
import {
  parseSseEvents,
  pricingSubjects,
  rateFromEvent,
  stayKey,
  type MapRate,
  type StayContext,
} from "@/lib/hotels/mapPrices";

// Live rates for the hotels on screen, through /api/travel/hotels/stream-rates.
//
// ASKED ONLY WITH DATES, AND ONLY FOR WHAT IS ON SCREEN: at most 30 hotels per
// view, nearest the centre first, and never one that already holds an unexpired
// answer for this stay. A pan re-asks for the newcomers only.
//
// CANCELLED, NEVER RACED: every new ask aborts the last, so a slow stream for
// the previous view can never paint its prices over the current one. Changing
// the dates throws every rate away — a price is only valid for its own stay.
//
// BATCHED: rates arrive one by one; repainting the GPU source per event would
// rebuild every feature thirty times. Updates are flushed every 250 ms.

export type RatesStatus = "idle" | "loading" | "done" | "error";

const DEBOUNCE_MS = 450;
const FLUSH_MS = 250;

export function useMapRates(
  points: readonly MapPoint[],
  center: { latitude: number; longitude: number } | null,
  stay: StayContext | null
): { rates: ReadonlyMap<string, MapRate>; status: RatesStatus; truncated: boolean } {
  const [rates, setRates] = useState<ReadonlyMap<string, MapRate>>(new Map());
  const [status, setStatus] = useState<RatesStatus>("idle");
  const [truncated, setTruncated] = useState(false);
  const known = useRef(new Map<string, MapRate>());
  const key = stayKey(stay);

  // New stay: every rate belongs to the old one.
  useEffect(() => {
    known.current = new Map();
    setRates(new Map());
    setTruncated(false);
    setStatus("idle");
  }, [key]);

  useEffect(() => {
    if (!stay || !points.length) return;
    const subjects = pricingSubjects(points, center, known.current, Date.now());
    if (!subjects.length) return;

    const ac = new AbortController();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      flushTimer = null;
      if (!ac.signal.aborted) setRates(new Map(known.current));
    };
    const scheduleFlush = () => {
      if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS);
    };

    const start = setTimeout(async () => {
      for (const p of subjects) known.current.set(p.id, { state: "loading" });
      setRates(new Map(known.current));
      setStatus("loading");
      setTruncated(false);
      try {
        const res = await fetch("/api/travel/hotels/stream-rates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ac.signal,
          body: JSON.stringify({
            hotels: subjects.map((p) => ({
              id: p.id.slice(0, 64),
              name: p.name.slice(0, 200),
              latitude: p.latitude,
              longitude: p.longitude,
              ...(p.city ? { city: p.city.slice(0, 120) } : {}),
              ...(p.brand ? { brand: p.brand.slice(0, 120) } : {}),
            })),
            checkIn: stay.checkIn,
            checkOut: stay.checkOut,
            adults: stay.adults,
            rooms: 1,
          }),
        });
        if (!res.ok || !res.body) throw new Error(`stream-rates ${res.status}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parsed = parseSseEvents(buffer);
          buffer = parsed.rest;
          for (const ev of parsed.events) {
            if (ev.event === "rate") {
              const r = rateFromEvent(ev.data);
              if (r) known.current.set(r.hotelId, r.rate);
            } else if (ev.event === "done") {
              setTruncated(Boolean((ev.data as { truncated?: boolean })?.truncated));
            }
          }
          scheduleFlush();
        }
        if (ac.signal.aborted) return;
        // Anything the stream never answered (deadline, dropped connection) is
        // "not checked" — not "no rate", which would be a claim about the hotel.
        for (const p of subjects) {
          if (known.current.get(p.id)?.state === "loading") known.current.set(p.id, { state: "not_checked" });
        }
        flush();
        setStatus("done");
      } catch {
        if (ac.signal.aborted) return;
        for (const p of subjects) {
          if (known.current.get(p.id)?.state === "loading") known.current.delete(p.id);
        }
        flush();
        setStatus("error");
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(start);
      if (flushTimer) clearTimeout(flushTimer);
      ac.abort();
      // A cancelled ask leaves no "loading" behind to block the next one.
      for (const [id, r] of known.current) if (r.state === "loading") known.current.delete(id);
    };
    // `center` is deliberately read, not depended on: the points change on
    // every load anyway, and a centre change alone must not re-ask.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, key]);

  return { rates, status, truncated };
}
