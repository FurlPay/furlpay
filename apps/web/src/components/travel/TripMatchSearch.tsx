"use client";

import { useState } from "react";
import Link from "next/link";
import { Sparkles, Search, ArrowRight } from "lucide-react";
import VoiceInputButton from "@/components/VoiceInputButton";
import type { TripMatch, TripMatchSignal } from "@/lib/travel/tripmatch";

// Furl AI Trip Match — describe the trip in plain language, get ranked
// destinations back with the parsed signals shown as chips.

const EXAMPLES = [
  "beach under $100/night, visa-free, good for remote work",
  "city break with great food in October",
  "quiet mountains for a family trip",
  "crypto-friendly nightlife under $200/night",
];

export default function TripMatchSearch() {
  const [query, setQuery] = useState("");
  const [signals, setSignals] = useState<TripMatchSignal[]>([]);
  const [matches, setMatches] = useState<TripMatch[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(q: string) {
    const text = q.trim();
    if (text.length < 3 || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/travel/trip-match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: text }),
      });
      const d = await res.json();
      setSignals(d.signals ?? []);
      setMatches(d.matches ?? []);
    } catch {
      setMatches([]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-12 rounded-card border border-white/10 bg-gradient-to-br from-neon/[0.07] via-charcoal to-charcoal p-6">
      <div className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-neon" />
        <h2 className="text-xl font-bold text-white">Furl AI Trip Match</h2>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-textSecondary">
        Skip the filters. Describe the trip — budget, vibe, month, visa needs — and get destinations that
        actually fit.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(query);
        }}
        className="mt-4 flex gap-2"
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-textMuted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='Try "beach under $100 a night, visa-free, good wifi"'
            aria-label="Describe your trip"
            className="w-full rounded-lg border border-white/10 bg-black/40 py-2.5 pl-9 pr-11 text-sm text-white outline-none placeholder:text-textMuted focus:border-neon/60"
          />
          {/* A whole sentence is far easier to say than to thumb-type, so this
              field benefits from dictation more than the city one does. It only
              fills the input; matching still runs on submit. */}
          <span className="absolute right-2 top-1/2 -translate-y-1/2">
            <VoiceInputButton onResult={setQuery} label="Describe your trip by voice" />
          </span>
        </div>
        <button
          type="submit"
          disabled={busy || query.trim().length < 3}
          className="rounded-lg bg-neon px-4 py-2 text-sm font-bold text-black transition hover:bg-neon/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Matching…" : "Match"}
        </button>
      </form>

      {matches === null && (
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => {
                setQuery(ex);
                run(ex);
              }}
              className="rounded-full border border-white/10 px-3 py-1 text-[11px] text-textSecondary transition hover:border-neon/40 hover:text-white"
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      {matches !== null && signals.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-wide text-textMuted">Understood:</span>
          {signals.map((s) => (
            <span key={s.label} className="rounded-full bg-neon/10 px-2.5 py-0.5 text-[11px] font-semibold text-neon">
              {s.label}
            </span>
          ))}
        </div>
      )}

      {matches !== null && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {matches.map((m) => (
            <Link
              key={m.destination.slug}
              href={`/travel/destinations/${m.destination.slug}`}
              className="group overflow-hidden rounded-card border border-white/10 bg-black/30 transition hover:border-white/25 hover:shadow-glow-sm"
            >
              <div className="relative h-24 overflow-hidden">
                <img
                  src={m.destination.photo}
                  alt={m.destination.name}
                  loading="lazy"
                  className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                <p className="absolute bottom-2 left-3 text-sm font-bold text-white">
                  {m.destination.name}
                  <span className="ml-1 text-[10px] font-normal text-white/70">{m.destination.country}</span>
                </p>
              </div>
              <div className="p-3">
                <div className="flex flex-wrap gap-1">
                  {m.hits.slice(0, 3).map((h) => (
                    <span key={h} className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-textSecondary">
                      {h}
                    </span>
                  ))}
                </div>
                <p className="mt-2 flex items-center justify-between text-[11px] text-textSecondary">
                  <span>
                    hotels ~<span className="font-semibold text-white">${m.destination.avgHotelUsd}</span>/nt
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 text-neon transition group-hover:translate-x-0.5" />
                </p>
              </div>
            </Link>
          ))}
          {matches.length === 0 && (
            <p className="col-span-full rounded-card border border-dashed border-white/10 p-6 text-center text-sm text-textSecondary">
              No strong matches — try adding a vibe (beach, city, mountains), a budget, or a month.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
