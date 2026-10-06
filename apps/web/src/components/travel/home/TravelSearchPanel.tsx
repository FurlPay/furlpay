"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeftRight,
  BedDouble,
  CalendarDays,
  Car,
  Compass,
  MapPin,
  Plane,
  Search,
  Sparkles,
  Ticket,
  UtensilsCrossed,
} from "lucide-react";
import VoiceInputButton from "@/components/VoiceInputButton";
import { searchAirports } from "@/lib/travel/airports";
import { TRY_CHIPS } from "@/lib/travel/home";
import TravelersPicker, { type Travelers } from "./TravelersPicker";
import { requestPlan } from "./planEvents";

const TABS = [
  { id: "stays", label: "Stays", Icon: BedDouble },
  { id: "flights", label: "Flights", Icon: Plane },
  { id: "cars", label: "Cars", Icon: Car },
  { id: "activities", label: "Activities", Icon: Ticket },
  { id: "restaurants", label: "Restaurants", Icon: UtensilsCrossed },
] as const;
type TabId = (typeof TABS)[number]["id"];

const today = () => new Date().toISOString().slice(0, 10);

/** A free-text "where" that reads like a request rather than a place goes to
 *  the AI planner ("ask anything"). */
function looksLikeRequest(s: string): boolean {
  const t = s.trim();
  return t.split(/\s+/).length >= 4 || /\$|\bunder\b|\bcheap|\bbest\b|\bwith\b/i.test(t);
}

/** City name or IATA code → IATA code, via the bundled airport table. */
function toIata(s: string): string | null {
  const t = s.trim();
  if (/^[A-Za-z]{3}$/.test(t)) return t.toUpperCase();
  return searchAirports(t, 1)[0]?.iata ?? null;
}

export default function TravelSearchPanel() {
  const router = useRouter();
  const [tab, setTab] = useState<TabId>("stays");
  const [where, setWhere] = useState("");
  const [from, setFrom] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [travelers, setTravelers] = useState<Travelers>({ adults: 2, children: 0, rooms: 1 });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const whereRef = useRef<HTMLInputElement>(null);

  // /travel?focus=search (the header search icon on other pages).
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("focus") === "search") whereRef.current?.focus();
  }, []);

  const flights = tab === "flights";
  const labels = {
    where: flights ? "Flying to" : tab === "restaurants" ? "Which city?" : "Where are you going?",
    start: flights ? "Depart" : tab === "cars" ? "Pick-up" : "Check in",
    end: flights ? "Return" : tab === "cars" ? "Drop-off" : "Check out",
  };
  const showDates = tab !== "restaurants";

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    const city = where.trim();

    if (tab === "stays" && city && looksLikeRequest(city)) {
      requestPlan(city);
      return;
    }
    if (!city) {
      setError(flights ? "Where are you flying to?" : "Enter a destination to search.");
      whereRef.current?.focus();
      return;
    }
    if (start && end && end <= start) {
      setError(`${labels.end} must be after ${labels.start.toLowerCase()}.`);
      return;
    }

    let url: string;
    if (flights) {
      const to = toIata(city);
      const origin = from.trim() ? toIata(from) : null;
      if (!to) {
        setError(`We couldn't find an airport for "${city}". Try a city name or a 3-letter code.`);
        return;
      }
      if (from.trim() && !origin) {
        setError(`We couldn't find an airport for "${from}".`);
        return;
      }
      const q = new URLSearchParams({ to, ...(origin ? { from: origin } : {}), ...(start ? { date: start } : {}) });
      url = `/travel/flights?${q}`;
    } else if (tab === "stays") {
      const q = new URLSearchParams({ city, guests: String(travelers.adults + travelers.children), rooms: String(travelers.rooms) });
      if (start) q.set("checkIn", start);
      if (end) q.set("checkOut", end);
      url = `/travel/stays?${q}`;
    } else if (tab === "cars") {
      const q = new URLSearchParams({ city });
      if (start) q.set("pickUp", start);
      if (end) q.set("dropOff", end);
      url = `/travel/car-rentals?${q}`;
    } else {
      url = `/travel/${tab}?city=${encodeURIComponent(city)}`;
    }
    setSubmitting(true);
    router.push(url);
  }

  return (
    <section
      id="search"
      aria-label="Search travel"
      className="relative rounded-[20px] border border-neon/25 bg-[rgba(10,15,15,0.88)] p-4 shadow-[0_0_60px_-24px_rgba(0,229,153,0.45)] backdrop-blur-xl sm:p-5"
    >
      {/* tabs */}
      <div className="flex items-center gap-2">
        <div role="tablist" aria-label="What are you booking?" className="no-scrollbar -mx-1 flex flex-1 gap-2 overflow-x-auto px-1">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              role="tab"
              type="button"
              aria-selected={tab === id}
              onClick={() => {
                setTab(id);
                setError(null);
              }}
              className={`flex h-9 shrink-0 items-center gap-2 rounded-[10px] border px-3.5 text-[13px] font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-neon ${
                tab === id
                  ? "border-neon bg-neon text-black"
                  : "border-white/[0.08] bg-white/[0.03] text-white/80 hover:border-white/20 hover:text-white"
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden /> {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => requestPlan(where.trim())}
          className="hidden h-9 shrink-0 items-center gap-2 rounded-[10px] border border-white/[0.08] bg-white/[0.03] px-3.5 text-[13px] font-semibold text-white/85 transition hover:border-neon/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-neon sm:flex"
        >
          <Sparkles className="h-4 w-4 text-violet-300" aria-hidden /> AI Planner
          <span className="rounded-full bg-neon px-1.5 py-0.5 text-[9px] font-bold uppercase text-black">New</span>
        </button>
      </div>

      {/* form */}
      <form onSubmit={submit} noValidate className="mt-4 flex flex-col gap-3 lg:flex-row">
        <div className="grid flex-1 grid-cols-2 overflow-visible rounded-xl border border-white/[0.08] bg-black/30 lg:grid-cols-[minmax(0,2.1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.05fr)] lg:divide-x lg:divide-white/[0.08]">
          <Field label={labels.where} className="col-span-2 lg:col-span-1">
            {flights && (
              <span className="flex items-center gap-1.5">
                <input
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  placeholder="From (optional)"
                  aria-label="Flying from"
                  className="w-24 min-w-0 bg-transparent text-[13px] text-white placeholder:text-white/40 focus:outline-none sm:w-28"
                />
                <ArrowLeftRight className="h-3.5 w-3.5 shrink-0 text-white/40" aria-hidden />
              </span>
            )}
            {!flights && <MapPin className="h-4 w-4 shrink-0 text-white/60" aria-hidden />}
            <input
              id="travel-where"
              ref={whereRef}
              value={where}
              onChange={(e) => setWhere(e.target.value)}
              placeholder={flights ? "City or airport code" : tab === "stays" ? "Search destinations, hotels, or ask anything…" : "City"}
              aria-label={labels.where}
              aria-invalid={!!error && !where.trim()}
              aria-describedby={error ? "travel-search-error" : undefined}
              autoComplete="off"
              className="w-full min-w-0 bg-transparent text-[13px] text-white placeholder:text-white/40 focus:outline-none"
            />
            <VoiceInputButton onResult={setWhere} label="Say your destination" />
          </Field>
          {showDates && (
            <>
              <Field label={labels.start}>
                <CalendarDays className="h-4 w-4 shrink-0 text-white/60" aria-hidden />
                <input
                  type="date"
                  value={start}
                  min={today()}
                  onChange={(e) => {
                    setStart(e.target.value);
                    if (end && e.target.value && end <= e.target.value) setEnd("");
                  }}
                  aria-label={labels.start}
                  className="w-full min-w-0 bg-transparent text-[13px] text-white [color-scheme:dark] focus:outline-none"
                />
              </Field>
              <Field label={labels.end} className="border-l lg:border-l-0">
                <CalendarDays className="h-4 w-4 shrink-0 text-white/60" aria-hidden />
                <input
                  type="date"
                  value={end}
                  min={start || today()}
                  onChange={(e) => setEnd(e.target.value)}
                  aria-label={labels.end}
                  className="w-full min-w-0 bg-transparent text-[13px] text-white [color-scheme:dark] focus:outline-none"
                />
              </Field>
            </>
          )}
          <div className={`col-span-2 border-t border-white/[0.08] lg:col-span-1 lg:border-t-0 ${showDates ? "" : "lg:col-span-3"}`}>
            <TravelersPicker value={travelers} onChange={setTravelers} />
          </div>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="group flex min-h-[64px] shrink-0 flex-col items-center justify-center rounded-xl bg-neon px-10 text-black shadow-[0_0_32px_-8px_rgba(0,229,153,0.7)] transition hover:brightness-110 active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:opacity-70 lg:w-[180px]"
        >
          <span className="flex items-center gap-2 text-[16px] font-bold">
            <Search className="h-5 w-5" aria-hidden /> {submitting ? "Searching…" : "Search"}
          </span>
          <span className="text-[11px] font-medium text-black/65">Pay with crypto</span>
        </button>
      </form>

      {error && (
        <p id="travel-search-error" role="alert" className="mt-2 text-[12px] text-red-400">
          {error}
        </p>
      )}

      {/* try chips */}
      <div className="mt-4 flex items-center gap-2">
        <span className="shrink-0 text-[12px] text-white/50">Try:</span>
        <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">
          {TRY_CHIPS.map((c) => (
            <button
              key={c.label}
              type="button"
              onClick={() => {
                if (c.kind === "planner") requestPlan(c.query);
                else {
                  setTab(c.tab);
                  setWhere(c.where);
                  setError(null);
                  whereRef.current?.focus();
                }
              }}
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 text-[12px] text-white/80 transition hover:border-neon/40 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-neon"
            >
              {c.kind === "planner" ? <Sparkles className="h-3.5 w-3.5 text-neon" aria-hidden /> : <Compass className="h-3.5 w-3.5 text-neon" aria-hidden />}
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function Field({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <label className={`flex min-w-0 flex-col justify-center gap-1.5 border-t border-white/[0.08] px-4 py-3 first:border-t-0 lg:border-t-0 ${className}`}>
      <span className="text-[11px] font-medium text-white/55">{label}</span>
      <span className="relative flex min-w-0 items-center gap-2">{children}</span>
    </label>
  );
}
