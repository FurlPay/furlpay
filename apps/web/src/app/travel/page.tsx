import { DESTINATIONS, TRAVEL_PAY_TOKENS, CASHBACK_RATE } from "@/lib/travel/data";
import { ITINERARIES } from "@/lib/travel/discover";
import { ITINERARY_PHOTOS } from "@/lib/travel/home";
import HomeHero, { type HeroMetric } from "@/components/travel/home/HomeHero";
import TravelSearchPanel from "@/components/travel/home/TravelSearchPanel";
import AiTripPlanner from "@/components/travel/home/AiTripPlanner";
import ExploreByVibe from "@/components/travel/home/ExploreByVibe";
import FeaturedStays from "@/components/travel/home/FeaturedStays";
import WhyBook from "@/components/travel/home/WhyBook";
import PopularExperiences from "@/components/travel/home/PopularExperiences";
import type { HeroTrip } from "@/components/travel/home/HeroTripCard";

// FurlPay Travels homepage. Server component: the data below is computed here
// and only the interactive sections ship as client islands.
//
// Hero metrics are counted from what this code serves, not borrowed from a
// supplier's catalogue (see TRAVEL_STATS in lib/travel/data.ts for why the
// "2.1M+ hotels / 600+ airlines" style of figure was removed).
export default function TravelHubPage() {
  const metrics: HeroMetric[] = [
    { icon: "stays", value: `${DESTINATIONS.length} destinations`, label: "guides, stays & activities" },
    { icon: "flights", value: "Live flight search", label: "powered by Duffel" },
    { icon: "pay", value: TRAVEL_PAY_TOKENS.join(" · "), label: "100+ tokens & cards" },
    { icon: "cashback", value: `${Math.round(CASHBACK_RATE * 100)}% cashback`, label: "launching with rewards" },
  ];

  const trips: HeroTrip[] = ITINERARIES.map((it) => ({
    slug: it.slug,
    title: it.title,
    city: it.city,
    days: it.days,
    budgetUsd: it.budgetUsd,
    stops: it.plan.reduce((n, d) => n + d.items.length, 0),
    photo: ITINERARY_PHOTOS[it.destinationSlug] ?? it.photo,
  }));

  return (
    <>
      <HomeHero metrics={metrics} trips={trips}>
        <TravelSearchPanel />
      </HomeHero>

      <div className="mx-auto flex max-w-[1400px] flex-col gap-14 px-4 pb-20 pt-6 sm:px-6 lg:px-10">
        <AiTripPlanner />
        <ExploreByVibe />
        <FeaturedStays />
        <WhyBook destinationCount={DESTINATIONS.length} />
        <PopularExperiences />
      </div>
    </>
  );
}
