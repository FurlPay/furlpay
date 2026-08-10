"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, MapPin, CalendarDays, Users, Building2, Plane, Car, Ticket } from "lucide-react";

const TABS = [
  { id: "stays", label: "Stays", Icon: Building2 },
  { id: "flights", label: "Flights", Icon: Plane },
  { id: "cars", label: "Car Rentals", Icon: Car },
  { id: "activities", label: "Activities", Icon: Ticket },
] as const;
type TabId = (typeof TABS)[number]["id"];

const TOKENS = ["USDC", "SOL", "BTC", "ETH", "Card"];

export default function TravelHero() {
  const router = useRouter();
  const [tab, setTab] = useState<TabId>("stays");
  const [city, setCity] = useState("");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [guests, setGuests] = useState(2);

  function search() {
    if (tab === "stays") {
      const q = new URLSearchParams({ city, checkIn, checkOut, guests: String(guests) });
      router.push(`/travel/stays?${q.toString()}`);
    } else if (tab === "cars") {
      const q = new URLSearchParams({ city, pickUp: checkIn, dropOff: checkOut });
      router.push(`/travel/car-rentals?${q.toString()}`);
    } else if (tab === "activities") {
      router.push(`/travel/activities?city=${encodeURIComponent(city)}`);
    } else {
      router.push(`/travel/flights`);
    }
  }

  return (
    <div className="rounded-card border border-white/10 bg-gradient-to-br from-sky-500/[0.12] via-charcoal to-teal-500/[0.10] p-4 shadow-glow-sm sm:p-6">
      {/* tabs */}
      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold transition ${
              tab === id ? "bg-white text-black" : "bg-white/[0.06] text-textSecondary hover:bg-white/10"
            }`}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {/* inputs */}
      <div className="grid gap-2.5 sm:grid-cols-4">
        {/* `sm:` prefix is load-bearing: below the breakpoint the grid is a
            single column, and an unprefixed `col-span-2` forces an implicit
            SECOND column. Two content-sized inputs then sat side by side and
            pushed the document to 401px on a 375px phone — the page-level
            horizontal scroll. */}
        <label className="flex min-w-0 items-center gap-2 rounded-xl bg-white/[0.06] px-3 py-3 sm:col-span-2">
          <MapPin className="h-4 w-4 shrink-0 text-textSecondary" />
          <input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder={tab === "flights" ? "From → To" : "Where to?"}
            aria-label={tab === "flights" ? "Route, from and to" : "Destination"}
            className="w-full min-w-0 bg-transparent text-sm text-white placeholder:text-textSecondary focus:outline-none"
          />
        </label>
        <label className="flex min-w-0 items-center gap-2 rounded-xl bg-white/[0.06] px-3 py-3">
          <CalendarDays className="h-4 w-4 shrink-0 text-textSecondary" />
          <input
            type="date"
            value={checkIn}
            onChange={(e) => setCheckIn(e.target.value)}
            aria-label={tab === "flights" ? "Departure date" : "Check-in date"}
            className="w-full min-w-0 bg-transparent text-sm text-white [color-scheme:dark] focus:outline-none"
          />
        </label>
        <label className="flex min-w-0 items-center gap-2 rounded-xl bg-white/[0.06] px-3 py-3">
          <CalendarDays className="h-4 w-4 shrink-0 text-textSecondary" />
          <input
            type="date"
            value={checkOut}
            onChange={(e) => setCheckOut(e.target.value)}
            aria-label={tab === "flights" ? "Return date" : "Check-out date"}
            className="w-full min-w-0 bg-transparent text-sm text-white [color-scheme:dark] focus:outline-none"
          />
        </label>
      </div>

      <div className="mt-2.5 grid gap-2.5 sm:grid-cols-4">
        <label className="flex min-w-0 items-center gap-2 rounded-xl bg-white/[0.06] px-3 py-3">
          <Users className="h-4 w-4 shrink-0 text-textSecondary" />
          <select
            value={guests}
            onChange={(e) => setGuests(Number(e.target.value))}
            aria-label="Number of guests"
            className="w-full min-w-0 bg-transparent text-sm text-white focus:outline-none [&>option]:text-black"
          >
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? "Guest" : "Guests"}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={search}
          className="flex items-center justify-center gap-2 rounded-xl bg-neon px-4 py-3 text-sm font-bold text-black transition hover:bg-neonDeep sm:col-span-3"
        >
          <Search className="h-4 w-4" /> Search — pay with USDC / SOL / BTC
        </button>
      </div>

      {/* payment badges */}
      <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] text-textSecondary">
        <span>Pay with</span>
        {TOKENS.map((t) => (
          <span key={t} className="rounded-full bg-white/[0.06] px-2 py-1 font-semibold text-white/80">
            {t}
          </span>
        ))}
        <span>· 100+ more</span>
      </div>
    </div>
  );
}
