"use client";

import { useMemo, useState } from "react";
import { trackClient } from "@/lib/analytics/client";
import Link from "next/link";
import { ChevronLeft, Plane, ArrowRight, Search, Bell, Radio } from "lucide-react";
import { sendJSON } from "@/lib/api";
import { Spinner } from "@/components/ui";
import FlightCard from "@/components/travel/FlightCard";
import type { Flight } from "@/lib/travel/data";

const CABINS: Flight["cabin"][] = ["Economy", "Premium", "Business", "First"];

export default function FlightsPage() {
  const [from, setFrom] = useState("LHR");
  const [to, setTo] = useState("JFK");
  // Default two weeks out — live fare search needs a real date, and an empty
  // one silently drops the search to sample data.
  const [date, setDate] = useState(() => new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10));
  const [cabin, setCabin] = useState<Flight["cabin"]>("Economy");
  const [results, setResults] = useState<Flight[] | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function search() {
    trackClient("travel_search", { metadata: { source: "flights" } });
    setLoading(true);
    try {
      const d = await sendJSON<{ results: Flight[]; source?: string }>("/api/travel/search", {
        type: "flights", from, to, date, cabin,
      });
      setResults(d.results);
      setSource(d.source ?? null);
    } finally {
      setLoading(false);
    }
  }

  // Cheapest is always first (results arrive price-sorted); fastest gets its
  // own badge when it's a different itinerary.
  const fastestId = useMemo(() => {
    if (!results?.length) return undefined;
    return [...results].sort((a, b) => a.durationMin - b.durationMin)[0].id;
  }, [results]);

  return (
    <div className="mx-auto max-w-3xl px-5 pb-24 pt-6">
      <Link href="/travel" className="mb-3 inline-flex items-center gap-1 text-sm text-textSecondary hover:text-white">
        <ChevronLeft className="h-4 w-4" /> Travel
      </Link>
      <h1 className="flex items-center gap-2 text-2xl font-bold text-white">
        <Plane className="h-6 w-6 text-neon" /> Flights
      </h1>

      {/* Search form */}
      <div className="mt-4 rounded-card border border-white/10 bg-charcoal p-4">
        <div className="grid gap-2.5 sm:grid-cols-[1fr_auto_1fr]">
          <input
            value={from}
            onChange={(e) => setFrom(e.target.value.toUpperCase())}
            placeholder="From (IATA)"
            maxLength={3}
            className="rounded-xl bg-white/[0.06] px-3 py-3 text-sm uppercase text-white placeholder:text-textSecondary focus:outline-none"
          />
          <div className="flex items-center justify-center">
            <ArrowRight className="h-4 w-4 text-textSecondary" />
          </div>
          <input
            value={to}
            onChange={(e) => setTo(e.target.value.toUpperCase())}
            placeholder="To (IATA)"
            maxLength={3}
            className="rounded-xl bg-white/[0.06] px-3 py-3 text-sm uppercase text-white placeholder:text-textSecondary focus:outline-none"
          />
        </div>
        <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-xl bg-white/[0.06] px-3 py-3 text-sm text-white [color-scheme:dark] focus:outline-none"
          />
          <select
            value={cabin}
            onChange={(e) => setCabin(e.target.value as Flight["cabin"])}
            className="rounded-xl bg-white/[0.06] px-3 py-3 text-sm text-white focus:outline-none [&>option]:text-black"
          >
            {CABINS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={search}
          className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-xl bg-neon py-3 text-sm font-bold text-black transition hover:bg-neonDeep"
        >
          <Search className="h-4 w-4" /> Search flights
        </button>
      </div>

      {/* Results */}
      <div className="mt-5 space-y-3">
        {loading ? (
          <Spinner />
        ) : results === null ? (
          <p className="py-10 text-center text-sm text-textSecondary">Search a route to see flights — pay with USDC, SOL or BTC.</p>
        ) : results.length === 0 ? (
          <p className="py-10 text-center text-sm text-textSecondary">No flights found.</p>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                  source === "duffel" ? "bg-emerald-400/10 text-emerald-400" : "bg-white/[0.06] text-textSecondary"
                }`}
              >
                <Radio className="h-3 w-3" />
                {source === "duffel" ? "Live fares · Duffel" : "Sample fares — live feed unavailable for this route"}
              </span>
              <Link
                href="/travel/alerts"
                className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-neon hover:underline"
              >
                <Bell className="h-3.5 w-3.5" /> Track this route&apos;s price
              </Link>
            </div>
            {results.map((f, i) => (
              <FlightCard
                key={f.id}
                flight={f}
                badge={i === 0 ? "Cheapest" : f.id === fastestId ? "Fastest" : undefined}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
