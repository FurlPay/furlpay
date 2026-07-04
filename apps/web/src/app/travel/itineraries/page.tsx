import Link from "next/link";
import { Map, ArrowRight, CalendarDays, Wallet } from "lucide-react";
import { Pill } from "@/components/ui";
import { ITINERARIES } from "@/lib/travel/discover";
import { CASHBACK_RATE } from "@/lib/travel/data";

export const metadata = {
  title: "Bookable Itineraries",
  description:
    "Day-by-day trip plans you can actually book — budgets in USD & USDC, 2% cashback, and every stop one click from checkout.",
};

// Bookable itineraries — planners like Wanderlog stop at the plan; every
// FurlPay itinerary links straight into stays/activities checkout.
export default function ItinerariesPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 pb-24 pt-8">
      <div className="mb-3 flex items-center gap-2">
        <Pill tone="accent">Plan → book in one click</Pill>
      </div>
      <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-white">
        <Map className="h-7 w-7 text-neon" /> Bookable itineraries
      </h1>
      <p className="mt-2 max-w-xl text-sm text-textSecondary">
        Day-by-day plans written by people who’ve done the trip — with real budgets in USD & USDC. Other planners
        stop at the plan; here every itinerary books the stay, the flights and the activities.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ITINERARIES.map((it) => {
          const cashback = Math.round(it.budgetUsd * CASHBACK_RATE);
          return (
            <Link
              key={it.slug}
              href={`/travel/itineraries/${it.slug}`}
              className="group overflow-hidden rounded-card border border-white/10 bg-charcoal transition hover:border-white/25 hover:shadow-glow-sm"
            >
              <div className="relative h-40 overflow-hidden">
                <img
                  src={it.photo}
                  alt={it.city}
                  loading="lazy"
                  className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-black/10" />
                <span className="absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-semibold text-white">
                  {it.days} days · {it.style}
                </span>
                <span className="absolute bottom-3 left-3 text-lg font-bold text-white">{it.city}</span>
              </div>
              <div className="p-4">
                <h2 className="text-sm font-bold leading-snug text-white">{it.title}</h2>
                <p className="mt-2 line-clamp-2 text-xs text-textSecondary">{it.summary}</p>
                <div className="mt-3 flex items-center justify-between text-[11px]">
                  <span className="flex items-center gap-1 text-textSecondary">
                    <Wallet className="h-3.5 w-3.5" /> ~${it.budgetUsd} pp
                  </span>
                  <span className="font-semibold text-emerald-400">+{cashback} USDC back</span>
                  <ArrowRight className="h-4 w-4 text-neon transition group-hover:translate-x-1" />
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      <div className="mt-10 rounded-card border border-white/10 bg-gradient-to-br from-violet-600/15 via-charcoal to-fuchsia-600/10 p-6 text-center">
        <p className="text-sm font-semibold text-white">Want a custom plan?</p>
        <p className="mx-auto mt-1 max-w-md text-xs text-textSecondary">
          Ask your AI agent: “Plan and book me 5 days in Tokyo under $1,200.” FurlPay’s MCP + x402 budget guard books
          the whole itinerary within a limit you approve once.
        </p>
        <Link href="/travel/crypto-travel" className="mt-4 inline-flex items-center gap-1 rounded-lg bg-white px-4 py-2 text-xs font-bold text-black transition hover:bg-white/90">
          How agent booking works <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}
