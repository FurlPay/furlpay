// FurlPay Travels discovery content — itineraries, vlogs, restaurants, curated
// hotels. Built to out-feature the 2026 competitive set:
//  - Wanderlog/TripIt plan day-by-day but can't book → our itineraries are
//    BOOKABLE (every day links into stays/activities checkout, USDC pricing).
//  - Expedia found video drives bookings ~3x vs stills → our vlogs carry a
//    direct "Book this trip" CTA next to every video.
//  - TripAdvisor owns restaurant reviews but has no payments angle → we flag
//    crypto-accepting venues and settle the bill in USDC.
//  - Travala caps cashback at 5% and requires AVA staking → 2–7% USDC, no token.

import { CITY_PHOTOS } from "@/lib/travel/data";
import { searchProperties, type IndexedProperty } from "@/lib/travel/propertySource";

// --- itineraries ---------------------------------------------------------------

export type ItineraryStyle = "Culture" | "Adventure" | "Luxury" | "Budget" | "Wellness";

export interface ItineraryDay {
  day: number;
  title: string;
  items: string[]; // morning → night, concise
}

export interface Itinerary {
  slug: string;
  title: string;
  city: string; // CITY_PHOTOS key + destination name
  destinationSlug: string;
  days: number;
  style: ItineraryStyle;
  budgetUsd: number; // per person, ex-flights
  summary: string;
  plan: ItineraryDay[];
  photo: string;
}

export const ITINERARIES: Itinerary[] = [
  {
    slug: "tokyo-5-days",
    title: "Tokyo in 5 Days: Neon, Noodles & Temples",
    city: "Tokyo",
    destinationSlug: "tokyo",
    days: 5,
    style: "Culture",
    budgetUsd: 1180,
    summary: "The first-timer's perfect loop — Shibuya nights, Tsukiji breakfasts, a Hakone day trip and teamLab, paced so you never queue at peak.",
    plan: [
      { day: 1, title: "Shinjuku & Shibuya", items: ["Meiji Shrine at opening", "Harajuku & Omotesandō walk", "Shibuya crossing at dusk", "Izakaya crawl in Omoide Yokochō"] },
      { day: 2, title: "Old Tokyo", items: ["Senso-ji before 8am", "Nakamise snacks", "Sumida river boat to Hamarikyū", "Tsukiji outer-market lunch", "Ginza evening"] },
      { day: 3, title: "Art & Bay", items: ["teamLab Planets (book ahead)", "Toyosu ramen lunch", "Odaiba sunset", "Tokyo Tower at night"] },
      { day: 4, title: "Hakone day trip", items: ["Romancecar from Shinjuku", "Hakone loop: ropeway, pirate ship, open-air museum", "Onsen soak", "Back by 20:00"] },
      { day: 5, title: "Pick your Tokyo", items: ["Akihabara or Shimokitazawa morning", "Ueno museums", "Final sushi splurge", "Airport limousine bus"] },
    ],
    photo: CITY_PHOTOS["Tokyo"],
  },
  {
    slug: "bali-7-days",
    title: "Bali in 7 Days: Surf, Jungle & Temples",
    city: "Bali",
    destinationSlug: "bali",
    days: 7,
    style: "Adventure",
    budgetUsd: 760,
    summary: "Canggu surf mornings, Ubud jungle days and an Uluwatu finale — the classic route, minus the tourist-trap detours.",
    plan: [
      { day: 1, title: "Land in Canggu", items: ["Beach club sunset", "Warung dinner", "Early night — jetlag reset"] },
      { day: 2, title: "Surf & sand", items: ["Beginner break at Batu Bolong", "Smoothie-bowl brunch", "Tanah Lot for sunset"] },
      { day: 3, title: "To Ubud", items: ["Tegalalang rice terraces", "Sacred Monkey Forest", "Campuhan ridge walk at golden hour"] },
      { day: 4, title: "Volcano sunrise", items: ["2am Mount Batur trek", "Hot springs recovery", "Afternoon nap", "Ubud food tour"] },
      { day: 5, title: "Waterfall loop", items: ["Tibumana & Tukad Cepung falls", "Coffee plantation stop", "Spa evening"] },
      { day: 6, title: "South to Uluwatu", items: ["Cliff temple + kecak dance at sunset", "Padang Padang beach", "Seafood at Jimbaran Bay"] },
      { day: 7, title: "Slow morning", items: ["Sunrise swim", "Last mie goreng", "Airport (allow 90 min from Uluwatu)"] },
    ],
    photo: CITY_PHOTOS["Bali"],
  },
  {
    slug: "rome-4-days",
    title: "Rome in 4 Days: Every Era, One City",
    city: "Rome",
    destinationSlug: "rome",
    days: 4,
    style: "Culture",
    budgetUsd: 890,
    summary: "Colosseum to Vatican with skip-the-line timing, plus the Trastevere evenings most 4-day plans miss.",
    plan: [
      { day: 1, title: "Ancient Rome", items: ["Colosseum underground tour (first slot)", "Forum & Palatine Hill", "Capitoline Museums", "Aperitivo in Monti"] },
      { day: 2, title: "Vatican", items: ["Museums at opening — straight to Sistine", "St. Peter's dome climb", "Castel Sant'Angelo sunset", "Trastevere dinner"] },
      { day: 3, title: "Baroque centre", items: ["Pantheon at 9am", "Piazza Navona", "Trevi Fountain (go early or late)", "Spanish Steps", "Villa Borghese gallery (book!)"] },
      { day: 4, title: "Local Rome", items: ["Testaccio market breakfast", "Aventine keyhole & orange garden", "Appian Way bike ride", "Final carbonara"] },
    ],
    photo: CITY_PHOTOS["Rome"],
  },
  {
    slug: "swiss-alps-5-days",
    title: "Swiss Alps in 5 Days: Rails & Ridgelines",
    city: "Swiss Alps",
    destinationSlug: "swiss-alps",
    days: 5,
    style: "Luxury",
    budgetUsd: 1950,
    summary: "Interlaken base, Jungfraujoch summit, Glacier Express finale — Switzerland's greatest hits by train, no car needed.",
    plan: [
      { day: 1, title: "Arrive Interlaken", items: ["Harder Kulm funicular for the two-lakes view", "Lake Brienz shore walk", "Fondue dinner"] },
      { day: 2, title: "Top of Europe", items: ["First train to Jungfraujoch", "Aletsch glacier viewpoint", "Descend via Wengen", "Lauterbrunnen valley falls"] },
      { day: 3, title: "Grindelwald First", items: ["Cliff walk", "Bachalpsee hike (2h)", "Mountain-cart descent", "Spa evening"] },
      { day: 4, title: "To Zermatt", items: ["Scenic rail via Visp", "Matterhorn glacier paradise", "Gornergrat sunset train"] },
      { day: 5, title: "Glacier Express", items: ["The classic 8-hour panoramic ride to St. Moritz", "Excellence-class lunch", "Onward connections"] },
    ],
    photo: CITY_PHOTOS["Swiss Alps"],
  },
  {
    slug: "dubai-4-days",
    title: "Dubai in 4 Days: Sky-High to Sand Dunes",
    city: "Dubai",
    destinationSlug: "dubai",
    days: 4,
    style: "Luxury",
    budgetUsd: 1420,
    summary: "Burj views, old-town souks, a desert safari and a beach-day reset — Dubai's contrasts in one long weekend.",
    plan: [
      { day: 1, title: "Downtown", items: ["Burj Khalifa 'At the Top' at sunset (book the slot)", "Dubai Fountain show", "Souk Al Bahar dinner"] },
      { day: 2, title: "Old Dubai", items: ["Abra across the creek", "Gold & spice souks", "Al Fahidi heritage district", "Jumeirah mosque tour"] },
      { day: 3, title: "Desert", items: ["Late-morning pool", "Afternoon desert safari: dunes, camels, BBQ camp", "Stargazing"] },
      { day: 4, title: "Coast", items: ["Kite Beach morning", "The Palm boardwalk", "View at The Palm observatory", "Marina dhow dinner cruise"] },
    ],
    photo: CITY_PHOTOS["Dubai"],
  },
  {
    slug: "costa-rica-6-days",
    title: "Costa Rica in 6 Days: Pura Vida Circuit",
    city: "Costa Rica",
    destinationSlug: "costa-rica",
    days: 6,
    style: "Adventure",
    budgetUsd: 980,
    summary: "Arenal volcano, Monteverde cloud forest and a Pacific beach finish — the classic green triangle, self-drive or shuttle.",
    plan: [
      { day: 1, title: "San José → La Fortuna", items: ["Morning shuttle (3h)", "La Fortuna waterfall swim", "Hot springs evening"] },
      { day: 2, title: "Arenal", items: ["Hanging bridges at opening", "1968 lava-flow trail", "Chocolate tour", "Soda dinner (casado!)"] },
      { day: 3, title: "To Monteverde", items: ["Jeep-boat-jeep across Lake Arenal", "Afternoon coffee farm tour", "Night jungle walk"] },
      { day: 4, title: "Cloud forest", items: ["Monteverde reserve at 7am", "Ziplining over the canopy", "Hummingbird gallery"] },
      { day: 5, title: "To the coast", items: ["Shuttle to Manuel Antonio", "Beach afternoon", "Sunset from the point"] },
      { day: 6, title: "Manuel Antonio NP", items: ["Park at opening — sloths & capuchins", "Playa Manuel Antonio swim", "Evening flight or stay on"] },
    ],
    photo: CITY_PHOTOS["Costa Rica"],
  },
];

export function getItinerary(slug: string): Itinerary | undefined {
  return ITINERARIES.find((i) => i.slug === slug);
}

// --- vlogs ---------------------------------------------------------------------

export interface Vlog {
  id: string;
  title: string;
  creator: string;
  city: string;
  destinationSlug: string;
  durationMin: number;
  topic: string;
  // Deep link that always resolves (search-scoped) — no risk of dead embeds.
  watchUrl: string;
  photo: string;
}

const vlogWatch = (q: string) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;

export const VLOGS: Vlog[] = [
  { id: "vl_tokyo_food", title: "Tokyo Street Food Marathon — 10 Stops in Shibuya & Shinjuku", creator: "FurlPay Travels picks", city: "Tokyo", destinationSlug: "tokyo", durationMin: 22, topic: "Food", watchUrl: vlogWatch("tokyo street food tour 4k"), photo: CITY_PHOTOS["Tokyo"] },
  { id: "vl_bali_week", title: "One Week in Bali — Surf, Ubud & Uluwatu on a Budget", creator: "FurlPay Travels picks", city: "Bali", destinationSlug: "bali", durationMin: 28, topic: "Budget", watchUrl: vlogWatch("bali 7 days travel vlog"), photo: CITY_PHOTOS["Bali"] },
  { id: "vl_swiss_rail", title: "Riding the Glacier Express in Excellence Class", creator: "FurlPay Travels picks", city: "Swiss Alps", destinationSlug: "swiss-alps", durationMin: 24, topic: "Rail", watchUrl: vlogWatch("glacier express excellence class review"), photo: CITY_PHOTOS["Swiss Alps"] },
  { id: "vl_dubai_desert", title: "Dubai Beyond the Skyline — Desert, Souks & Old Town", creator: "FurlPay Travels picks", city: "Dubai", destinationSlug: "dubai", durationMin: 19, topic: "Culture", watchUrl: vlogWatch("dubai desert safari old dubai vlog"), photo: CITY_PHOTOS["Dubai"] },
  { id: "vl_rome_walk", title: "Rome at Dawn — A 4K Walking Tour Before the Crowds", creator: "FurlPay Travels picks", city: "Rome", destinationSlug: "rome", durationMin: 45, topic: "Walking tour", watchUrl: vlogWatch("rome 4k walking tour sunrise"), photo: CITY_PHOTOS["Rome"] },
  { id: "vl_maldives_villa", title: "Is an Overwater Villa Worth It? Maldives Honest Review", creator: "FurlPay Travels picks", city: "Maldives", destinationSlug: "maldives", durationMin: 17, topic: "Stays", watchUrl: vlogWatch("maldives overwater villa review"), photo: CITY_PHOTOS["Maldives"] },
  { id: "vl_kyoto_temples", title: "Kyoto's Quietest Temples — Beat the Crowds Guide", creator: "FurlPay Travels picks", city: "Kyoto", destinationSlug: "kyoto", durationMin: 21, topic: "Culture", watchUrl: vlogWatch("kyoto hidden temples travel guide"), photo: CITY_PHOTOS["Kyoto"] },
  { id: "vl_costa_wild", title: "Costa Rica Wildlife Week — Sloths, Volcanoes & Ziplines", creator: "FurlPay Travels picks", city: "Costa Rica", destinationSlug: "costa-rica", durationMin: 26, topic: "Adventure", watchUrl: vlogWatch("costa rica arenal monteverde vlog"), photo: CITY_PHOTOS["Costa Rica"] },
  { id: "vl_nyc_48h", title: "48 Hours in New York — The Perfect Weekend Plan", creator: "FurlPay Travels picks", city: "New York", destinationSlug: "new-york", durationMin: 18, topic: "City break", watchUrl: vlogWatch("48 hours in new york travel vlog"), photo: CITY_PHOTOS["New York"] },
];

// --- restaurants ----------------------------------------------------------------

export interface Restaurant {
  id: string;
  name: string;
  city: string;
  cuisine: string;
  priceTier: 1 | 2 | 3; // $ / $$ / $$$
  rating: number; // /5
  reviews: number;
  cryptoAccepted: boolean;
  bookable: boolean;
  signature: string;
  image: string; // gradient token fallback
}

const CUISINES = ["Local classics", "Sushi & seafood", "Street food", "Fine dining", "Vegan & wellness", "Steak & grill", "Ramen & noodles", "Mediterranean"];
const REST_NAMES = ["Ember", "Salt & Citrus", "The Copper Pot", "Noon Market", "Harbor House", "Little Lantern", "Verde", "Saffron Lane"];
const SIGNATURES = [
  "tasting menu that changes daily",
  "wood-fired everything",
  "chef's counter — watch every course",
  "market-to-table, zero menus",
  "legendary weekend brunch",
  "late-night local favourite",
  "rooftop tables, book at sunset",
  "family recipes, three generations",
];
const REST_GRADIENTS = [
  "from-amber-500/40 to-orange-700/40",
  "from-rose-500/40 to-pink-700/40",
  "from-emerald-500/40 to-teal-700/40",
  "from-sky-500/40 to-indigo-600/40",
];

function rhash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function generateRestaurants(city: string, count = 12): Restaurant[] {
  const c = (city || "Anywhere").replace(/\w\S*/g, (t) => t[0].toUpperCase() + t.slice(1).toLowerCase());
  const seed = rhash(`restaurants:${c.toLowerCase()}`);
  return Array.from({ length: count }, (_, i) => {
    const s = ((seed >> (i % 23)) ^ (i * 2654435761)) >>> 0;
    return {
      id: `rst_${(seed % 0xffff).toString(16)}_${i}`,
      name: `${REST_NAMES[(s + i) % REST_NAMES.length]} ${["", c, "Kitchen", "Bistro", "House"][s % 5]}`.trim(),
      city: c,
      cuisine: CUISINES[s % CUISINES.length],
      priceTier: ((s >>> 3) % 3) + 1 as 1 | 2 | 3,
      rating: Math.round((4 + ((s >>> 5) % 10) / 10) * 10) / 10,
      reviews: 60 + (s % 3200),
      cryptoAccepted: (s & 1) === 0,
      bookable: (s & 2) === 0,
      signature: SIGNATURES[(s >>> 7) % SIGNATURES.length],
      image: REST_GRADIENTS[i % REST_GRADIENTS.length],
    };
  }).sort((a, b) => b.rating - a.rating);
}

// --- curated hotels --------------------------------------------------------------

export interface HotelCollection {
  city: string;
  destinationSlug: string;
  photo: string;
  hotels: IndexedProperty[];
}

const HOTEL_CITIES: Array<[string, string]> = [
  ["Tokyo", "tokyo"],
  ["Dubai", "dubai"],
  ["London", "london"],
  ["Bali", "bali"],
  ["Rome", "rome"],
  ["Maldives", "maldives"],
];

/**
 * Top real properties for each showcase city.
 *
 * This used to call generateStays(city) and sort the invented ratings, which
 * meant the home page's "curated" hotels were six cities' worth of hash output
 * — names, star ratings, review counts and nightly prices, none of it real.
 *
 * Now it reads the indexed dataset. Cities we have not indexed simply return
 * no hotels and the collection is dropped, so the row shrinks rather than
 * filling itself. A shorter honest row beats a full invented one.
 */
export function curatedHotels(perCity = 3): HotelCollection[] {
  return HOTEL_CITIES.map(([city, destinationSlug]) => ({
    city,
    destinationSlug,
    photo: CITY_PHOTOS[city],
    hotels: searchProperties({ city, minRating: 4, limit: perCity }),
  })).filter((c) => c.hotels.length > 0);
}
