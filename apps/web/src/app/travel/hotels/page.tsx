import Link from "next/link";
import { BedDouble, ArrowRight, Search } from "lucide-react";
import { Pill } from "@/components/ui";
import PropertyCard from "@/components/travel/PropertyCard";
import { curatedHotels } from "@/lib/travel/discover";

export const metadata = {
  title: "Hotels",
  description:
    "Curated 4–5★ hotel collections across the world's best destinations — bookable with USDC, SOL, BTC or 100+ cryptos, 2%+ cashback.",
};

// Curated hotels — editor-picked 4–5★ collections per destination, each card
// one click from checkout. For the full inventory use /travel/stays search.
export default function HotelsPage() {
  const collections = curatedHotels(3);

  return (
    <div className="mx-auto max-w-6xl px-5 pb-24 pt-8">
      <div className="mb-3 flex items-center gap-2">
        <Pill tone="accent">Editor’s picks</Pill>
      </div>
      <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-white">
        <BedDouble className="h-7 w-7 text-neon" /> Hotels worth the trip
      </h1>
      <p className="mt-2 max-w-xl text-sm text-textSecondary">
        The top-rated 4–5★ stays in each destination we cover, refreshed from live inventory. Every rate shows USD
        and USDC, locks for 15 minutes at checkout, and pays 2%+ cashback.
      </p>
      <Link
        href="/travel/stays"
        className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-white/15 px-4 text-sm font-semibold text-white transition hover:bg-white/[0.06]"
      >
        <Search className="h-4 w-4" /> Search all 2.2M+ stays
      </Link>

      {collections.map((col) => (
        <section key={col.city} className="mt-12">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-bold text-white">Top stays in {col.city}</h2>
            <Link
              href={`/travel/stays?city=${encodeURIComponent(col.city)}`}
              className="flex items-center gap-1 text-sm text-neon hover:underline"
            >
              All {col.city} hotels <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {col.hotels.map((h) => (
              <PropertyCard key={h.id} stay={h} nights={3} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
