"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Loader2, RotateCcw, Sparkles } from "lucide-react";
import type { TripMatch, TripMatchSignal } from "@/lib/travel/tripmatch";
import { HOME_IMAGES } from "@/lib/travel/home";
import { PLAN_EVENT } from "./planEvents";

const CHECKLIST = ["Personalized itineraries", "Real-time prices", "Crypto payment options", "Book everything in one go"];
const PLACEHOLDER = "Plan a 7-day Japan trip under $3,000 with great food and nightlife…";

type State =
  | { kind: "idle" }
  | { kind: "loading"; query: string }
  | { kind: "error"; query: string }
  | { kind: "done"; query: string; signals: TripMatchSignal[]; matches: TripMatch[] };

/** "Tell FurlPay what you want." Runs the request through the trip matcher
 *  (/api/travel/trip-match), which parses budget / vibe / month / visa signals
 *  and ranks destinations against them, then links each match on to its
 *  destination guide and live stay search. */
export default function AiTripPlanner() {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const section = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const run = useCallback(async (raw: string) => {
    const text = raw.trim();
    if (text.length < 3) {
      input.current?.focus();
      return;
    }
    setState({ kind: "loading", query: text });
    try {
      const res = await fetch("/api/travel/trip-match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: text }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const d = (await res.json()) as { signals?: TripMatchSignal[]; matches?: TripMatch[] };
      setState({ kind: "done", query: text, signals: d.signals ?? [], matches: d.matches ?? [] });
    } catch {
      setState({ kind: "error", query: text });
    }
  }, []);

  // Requests handed over from the search panel and its "Try:" chips.
  useEffect(() => {
    const onPlan = (e: Event) => {
      const q = (e as CustomEvent<string>).detail ?? "";
      section.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      setQuery(q);
      if (q.trim().length >= 3) void run(q);
      else input.current?.focus({ preventScroll: true });
    };
    window.addEventListener(PLAN_EVENT, onPlan);
    return () => window.removeEventListener(PLAN_EVENT, onPlan);
  }, [run]);

  return (
    <section
      id="ai-planner"
      ref={section}
      aria-labelledby="ai-planner-title"
      className="relative scroll-mt-24 overflow-hidden rounded-[20px] border border-white/[0.08] bg-[#070B0C]"
    >
      <img src={HOME_IMAGES.planner} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover opacity-55" />
      <div className="absolute inset-0 bg-gradient-to-r from-[#050808] via-[#050808]/85 to-[#050808]/40" />

      <div className="relative grid gap-8 p-6 sm:p-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:items-center">
        <div>
          <p className="flex items-center gap-2 text-[14px] font-semibold text-white">
            <Sparkles className="h-5 w-5 text-neon" aria-hidden /> AI Trip Planner
          </p>
          <h2 id="ai-planner-title" className="mt-3 text-[26px] font-bold leading-tight tracking-tight text-white sm:text-[30px]">
            Tell FurlPay what you want. We’ll plan it.
          </h2>
          <p className="mt-2 max-w-[560px] text-[14px] leading-relaxed text-white/70">
            Get personalized itineraries, flights, hotels, activities and more — with real-time prices, crypto payments and
            instant booking.
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(query);
            }}
            className="mt-5 flex max-w-[600px] items-center gap-2 rounded-xl border border-white/10 bg-black/40 py-1.5 pl-4 pr-1.5 transition focus-within:border-neon/50 focus-within:shadow-[0_0_24px_-8px_rgba(0,229,153,0.6)]"
          >
            <input
              ref={input}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={PLACEHOLDER}
              aria-label="Describe your trip"
              maxLength={300}
              className="min-w-0 flex-1 bg-transparent py-2 text-[13px] text-white placeholder:text-white/40 focus:outline-none"
            />
            <button
              type="submit"
              disabled={state.kind === "loading"}
              aria-label="Plan my trip"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neon text-black transition hover:brightness-110 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:opacity-70"
            >
              {state.kind === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            </button>
          </form>
        </div>

        <div className="hidden items-center justify-end gap-6 md:flex">
          <div className="relative h-[150px] w-[230px] shrink-0" aria-hidden>
            {HOME_IMAGES.plannerCollage.map((src, i) => (
              <img
                key={src}
                src={src}
                alt=""
                loading="lazy"
                className="absolute top-0 h-[130px] w-[96px] rounded-lg border-2 border-white/80 object-cover shadow-xl transition duration-300 hover:-translate-y-1"
                style={{ left: i * 66, transform: `rotate(${(i - 1) * 6}deg) translateY(${i === 1 ? -10 : 6}px)`, zIndex: i === 1 ? 2 : 1 }}
              />
            ))}
          </div>
          <ul className="shrink-0 space-y-3 rounded-xl border border-white/[0.08] bg-black/30 p-4">
            {CHECKLIST.map((c) => (
              <li key={c} className="flex items-center gap-2.5 text-[12px] text-white/80">
                <CheckCircle2 className="h-4 w-4 text-neon" aria-hidden /> {c}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div aria-live="polite" className="relative">
        {state.kind === "loading" && (
          <div className="grid gap-3 px-6 pb-6 sm:grid-cols-2 sm:px-8 lg:grid-cols-4">
            {[0, 1, 2, 3].map((n) => (
              <div key={n} className="h-[150px] animate-pulse rounded-xl bg-white/[0.05]" />
            ))}
          </div>
        )}
        {state.kind === "error" && (
          <div className="mx-6 mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/25 bg-red-500/[0.06] px-4 py-3 sm:mx-8">
            <p className="text-[13px] text-red-200">The planner couldn’t be reached. Your request wasn’t lost.</p>
            <button type="button" onClick={() => run(state.query)} className="flex items-center gap-1.5 text-[13px] font-semibold text-white hover:text-neon">
              <RotateCcw className="h-3.5 w-3.5" /> Try again
            </button>
          </div>
        )}
        {state.kind === "done" && (
          <div className="px-6 pb-6 sm:px-8">
            {state.signals.length > 0 && (
              <p className="mb-3 flex flex-wrap items-center gap-2 text-[12px] text-white/55">
                Understood:
                {state.signals.map((s) => (
                  <span key={s.label} className="rounded-full border border-neon/30 bg-neon/10 px-2.5 py-0.5 text-neon">
                    {s.label}
                  </span>
                ))}
              </p>
            )}
            {state.matches.length === 0 ? (
              <p className="rounded-xl border border-white/[0.08] bg-black/30 px-4 py-3 text-[13px] text-white/70">
                No destination fits all of that yet. Try fewer constraints, or{" "}
                <Link href="/travel/destinations" className="text-neon hover:underline">browse every destination</Link>.
              </p>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {state.matches.map((m) => (
                  <li key={m.destination.slug} className="group overflow-hidden rounded-xl border border-white/[0.08] bg-black/40 transition hover:border-neon/40">
                    <div className="relative h-24 overflow-hidden">
                      <img src={m.destination.photo} alt="" loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
                      <p className="absolute bottom-2 left-3 text-[14px] font-semibold text-white">
                        {m.destination.name}, <span className="font-normal text-white/70">{m.destination.country}</span>
                      </p>
                    </div>
                    <div className="space-y-2 p-3">
                      <p className="line-clamp-2 text-[12px] text-white/65">{m.destination.tagline}</p>
                      <p className="text-[11px] text-white/50">
                        Hotels avg <span className="font-semibold text-white">${m.destination.avgHotelUsd}</span>/night · best {m.destination.bestTime}
                      </p>
                      {m.hits.length > 0 && (
                        <p className="flex flex-wrap gap-1">
                          {m.hits.map((h) => (
                            <span key={h} className="flex items-center gap-1 rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-white/75">
                              <CheckCircle2 className="h-3 w-3 text-neon" aria-hidden /> {h}
                            </span>
                          ))}
                        </p>
                      )}
                      <div className="flex gap-2 pt-1">
                        <Link href={`/travel/destinations/${m.destination.slug}`} className="flex-1 rounded-lg border border-white/10 py-1.5 text-center text-[12px] font-semibold text-white transition hover:border-white/30">
                          Guide
                        </Link>
                        <Link href={`/travel/stays?city=${encodeURIComponent(m.destination.name)}`} className="flex-1 rounded-lg bg-neon py-1.5 text-center text-[12px] font-bold text-black transition hover:brightness-110">
                          See stays
                        </Link>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
