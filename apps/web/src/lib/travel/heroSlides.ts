// Background photography for the /travel hero. Editorial only: a place and a
// photo, never a price or availability claim (those come from ITINERARIES).
//
// Every photo is self-hosted under /public/travel/hero, from Unsplash
// (free for commercial use under the Unsplash License); the source of each is
// in /public/travel/hero/CREDITS.md. Two crops per photo: a 1920×1200
// landscape for md+ and a 900×1400 portrait for phones, each cut on its own
// focal point so the subject survives both.

export interface HeroSlide {
  id: string;
  place: string;
  country: string;
  /** DESTINATIONS / ITINERARIES slug, when this place has a bookable trip. */
  destinationSlug?: string;
  desktop: string;
  mobile: string;
  /** Read only by assistive tech when the location label is announced. */
  alt: string;
}

const photo = (id: string) => ({ desktop: `/travel/hero/${id}-desktop.webp`, mobile: `/travel/hero/${id}-mobile.webp` });

export const HERO_SLIDES: readonly HeroSlide[] = [
  { id: "santorini", place: "Santorini", country: "Greece", alt: "Whitewashed houses of Oia above the Aegean at dusk", ...photo("santorini") },
  { id: "tokyo", place: "Tokyo", country: "Japan", destinationSlug: "tokyo", alt: "Neon-lit shopping street and crossing in Tokyo", ...photo("tokyo") },
  { id: "bali", place: "Bali", country: "Indonesia", destinationSlug: "bali", alt: "Pura Ulun Danu Bratan temple on Lake Bratan", ...photo("bali") },
  { id: "swiss-alps", place: "Zermatt", country: "Switzerland", destinationSlug: "swiss-alps", alt: "The Matterhorn above alpine meadows", ...photo("swiss-alps") },
  { id: "dubai", place: "Dubai", country: "UAE", destinationSlug: "dubai", alt: "Downtown Dubai skyline with the Burj Khalifa", ...photo("dubai") },
  { id: "maldives", place: "Maldives", country: "Indian Ocean", alt: "Overwater villas on a turquoise Maldivian reef", ...photo("maldives") },
  { id: "kyoto", place: "Kyoto", country: "Japan", alt: "Yasaka Pagoda silhouetted against a pink evening sky", ...photo("kyoto") },
  { id: "paris", place: "Paris", country: "France", alt: "The Eiffel Tower over the Seine at dusk", ...photo("paris") },
  { id: "new-york", place: "New York City", country: "USA", alt: "Midtown Manhattan skyline with the Empire State Building", ...photo("new-york") },
  { id: "venice", place: "Venice", country: "Italy", alt: "Gondolas on the Grand Canal at sunset", ...photo("venice") },
  { id: "cappadocia", place: "Cappadocia", country: "Türkiye", alt: "Hot-air balloons over Cappadocia at sunrise", ...photo("cappadocia") },
  { id: "phuket", place: "Phi Phi Islands", country: "Thailand", alt: "Longtail boats moored on a beach in the Phi Phi Islands", ...photo("phuket") },
  { id: "fuji", place: "Mount Fuji", country: "Japan", alt: "Mount Fuji framed by cherry blossoms", ...photo("fuji") },
  { id: "rome", place: "Rome", country: "Italy", destinationSlug: "rome", alt: "The Colosseum at blue hour", ...photo("rome") },
];

/** How long each background stays before cross-fading to the next. */
export const HERO_BACKDROP_INTERVAL_MS = 6000;
/** How long each trip card stays before sliding to the next. */
export const HERO_CAROUSEL_INTERVAL_MS = 5000;
/** Phones get the portrait crop; keep in step with the <source> media query. */
export const HERO_MOBILE_QUERY = "(max-width: 767px)";

/** Index of the first slide for a destination, or -1. */
export function slideForDestination(destinationSlug: string): number {
  return HERO_SLIDES.findIndex((s) => s.destinationSlug === destinationSlug);
}
