// Content for the /travel homepage. Everything here is editorial (which
// destinations to feature, which photo goes where, which tags describe a
// place) — never a price, count or availability claim. Prices come from
// DESTINATIONS / ITINERARIES / the search APIs at render time, and anything
// those cannot back is not shown.
//
// Photos are self-hosted under /public/travel/home (Unsplash licence, free for
// commercial use); credits live in /public/travel/home/CREDITS.md.

import { DESTINATIONS, type Destination } from "@/lib/travel/data";

const IMG = (name: string) => `/travel/home/${name}.jpg`;

export const HOME_IMAGES = {
  hero: IMG("hero-santorini"),
  planner: IMG("planner-aurora"),
  plannerCollage: [IMG("collage-beach"), IMG("collage-pagoda"), IMG("collage-rome")],
} as const;

/** Vibe filter → destination slugs. Tags are editorial descriptions of the
 *  place, the same kind of statement as a destination's tagline. */
export const VIBES = [
  "For you",
  "Beach",
  "Mountains",
  "City",
  "Food",
  "Luxury",
  "Adventure",
  "Wellness",
  "Family",
  "Nightlife",
  "Culture",
  "Remote work",
] as const;
export type Vibe = (typeof VIBES)[number];

const DESTINATION_VIBES: Record<string, Vibe[]> = {
  bali: ["Beach", "Wellness", "Adventure", "Remote work"],
  tokyo: ["City", "Food", "Nightlife", "Culture"],
  paris: ["City", "Culture", "Food", "Luxury"],
  "new-york": ["City", "Nightlife", "Food", "Culture"],
  dubai: ["City", "Luxury", "Family", "Adventure"],
  singapore: ["City", "Food", "Family", "Luxury"],
  london: ["City", "Culture", "Nightlife"],
  maldives: ["Beach", "Luxury", "Wellness"],
  "swiss-alps": ["Mountains", "Adventure", "Family"],
  kyoto: ["Culture", "Food", "Wellness"],
  "costa-rica": ["Adventure", "Beach", "Wellness", "Family"],
  rome: ["Culture", "Food", "City"],
  petra: ["Culture", "Adventure"],
  reykjavik: ["Adventure", "Mountains"],
  cancun: ["Beach", "Family", "Nightlife"],
  patagonia: ["Mountains", "Adventure"],
  kerala: ["Wellness", "Beach", "Family"],
};

/** Card subtitle words per destination — what the reference shows as
 *  "Beaches • Villas • Wellness". */
const DESTINATION_HIGHLIGHTS: Record<string, string[]> = {
  bali: ["Beaches", "Villas", "Wellness"],
  tokyo: ["Food", "Nightlife", "Culture"],
  paris: ["Art", "History", "Luxury"],
  "new-york": ["City", "Shopping", "Museums"],
  dubai: ["Luxury", "Shopping", "Desert"],
  singapore: ["Food", "City", "Nature"],
};

const DESTINATION_PHOTOS: Record<string, string> = {
  bali: IMG("dest-bali"),
  tokyo: IMG("dest-tokyo"),
  paris: IMG("dest-paris"),
  "new-york": IMG("dest-new-york"),
  dubai: IMG("dest-dubai"),
  singapore: IMG("dest-singapore"),
};

/** "For you" — the six cities the reference leads with. */
const FEATURED_SLUGS = ["bali", "tokyo", "paris", "new-york", "dubai", "singapore"];

export interface HomeDestination {
  slug: string;
  name: string;
  country: string;
  photo: string;
  highlights: string[];
  avgHotelUsd: number;
}

function toHome(d: Destination): HomeDestination {
  return {
    slug: d.slug,
    name: d.name,
    country: d.country,
    photo: DESTINATION_PHOTOS[d.slug] ?? d.photo,
    highlights: DESTINATION_HIGHLIGHTS[d.slug] ?? (DESTINATION_VIBES[d.slug] ?? []).slice(0, 3),
    avgHotelUsd: d.avgHotelUsd,
  };
}

export function destinationsForVibe(vibe: Vibe): HomeDestination[] {
  if (vibe === "For you") {
    return FEATURED_SLUGS.map((s) => DESTINATIONS.find((d) => d.slug === s)).filter((d): d is Destination => !!d).map(toHome);
  }
  return DESTINATIONS.filter((d) => DESTINATION_VIBES[d.slug]?.includes(vibe)).map(toHome);
}

/** Featured stays — neighbourhoods to search, with NO price or discount: the
 *  deals API has no live rate to discount from (see /api/travel/deals). */
export interface FeaturedStay {
  title: string;
  area: string;
  city: string;
  photo: string;
  destinationSlug: string;
}

export const FEATURED_STAYS: FeaturedStay[] = [
  { title: "Bali · Cliffside resorts", area: "Uluwatu, Indonesia", city: "Bali", photo: IMG("stay-bali"), destinationSlug: "bali" },
  { title: "Tokyo · City hotels", area: "Shinjuku, Japan", city: "Tokyo", photo: IMG("stay-tokyo"), destinationSlug: "tokyo" },
  { title: "Dubai · Luxury stays", area: "Downtown, UAE", city: "Dubai", photo: IMG("stay-dubai"), destinationSlug: "dubai" },
  { title: "Paris · Boutique hotels", area: "Le Marais, France", city: "Paris", photo: IMG("stay-paris"), destinationSlug: "paris" },
];

/** Popular experiences — each opens the activities search for its city. */
export interface Experience {
  title: string;
  place: string;
  city: string;
  photo: string;
}

export const EXPERIENCES: Experience[] = [
  { title: "Mt. Fuji Day Tour", place: "Tokyo, Japan", city: "Tokyo", photo: IMG("exp-fuji") },
  { title: "Santorini Catamaran Cruise", place: "Santorini, Greece", city: "Santorini", photo: IMG("exp-santorini") },
  { title: "New York City Pass", place: "New York, USA", city: "New York", photo: IMG("exp-new-york") },
  { title: "Dubai Desert Safari", place: "Dubai, UAE", city: "Dubai", photo: IMG("exp-dubai-desert") },
  { title: "Bali Temple Tour", place: "Bali, Indonesia", city: "Bali", photo: IMG("exp-bali-temple") },
  { title: "Singapore City Tour", place: "Singapore", city: "Singapore", photo: IMG("exp-singapore") },
];

/** Hero trip card photos per itinerary destination (falls back to the
 *  itinerary's own photo). */
export const ITINERARY_PHOTOS: Record<string, string> = {
  tokyo: IMG("trip-japan"),
};

/** "Try:" chips under the search form. A chip either runs a structured
 *  search or hands a natural-language request to the AI planner. */
export type TryChip =
  | { label: string; kind: "search"; tab: "stays" | "flights" | "activities"; where: string }
  | { label: string; kind: "planner"; query: string };

export const TRY_CHIPS: TryChip[] = [
  { label: "4-star hotel in Tokyo under $150", kind: "planner", query: "4-star hotel in Tokyo under $150/night" },
  { label: "Cheap flights to Singapore", kind: "search", tab: "flights", where: "Singapore" },
  { label: "Beach destinations in November", kind: "planner", query: "beach destinations in November" },
  { label: "Family trip to Europe", kind: "planner", query: "family trip to Europe" },
  { label: "Weekend getaway from SF", kind: "planner", query: "weekend getaway from San Francisco" },
];
