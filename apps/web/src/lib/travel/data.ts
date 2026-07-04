// FurlPay Travels — server-side travel data + booking logic.
//
// Mirrors the @furlpay/travel-mcp composition (Travala search + FurlPay pay) for
// the web app. Runs on deterministic demo inventory; a live build swaps
// generate* for the Travala Travel MCP and authorize* for the FurlPay API.

export type StayType = "Hotel" | "Resort" | "Villa" | "Apartment" | "Hostel";
export type BookingSource = "travala" | "legacy";

export interface Stay {
  id: string;
  name: string;
  brand: string;
  city: string;
  country: string;
  type: StayType;
  stars: number;
  rating: number; // /5
  reviews: number;
  nightlyUsd: number;
  image: string; // gradient token (no external assets)
  amenities: string[];
  roomsLeft: number;
  freeCancellation: boolean;
  eco: boolean;
}

export interface Deal {
  id: string;
  city: string;
  country: string;
  name: string;
  stars: number;
  nightlyUsd: number;
  discountPct: number;
  payToken: "USDC" | "SOL" | "BTC";
  image: string;
  photo: string; // hotlinked Unsplash CDN image
}

export interface DestinationCategory {
  slug: string;
  title: string;
  blurb: string;
  tag: string;
  examples: string[];
  gradient: string; // tailwind gradient classes
  photo: string; // hotlinked Unsplash CDN image
}

// Free-to-hotlink photography from the Unsplash CDN (validated 200s).
const unsplash = (id: string, w = 1200) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=70`;

export const CITY_PHOTOS: Record<string, string> = {
  Tokyo: unsplash("photo-1540959733332-eab4deabeeaf"),
  Bali: unsplash("photo-1537996194471-e657df975ab4"),
  London: unsplash("photo-1513635269975-59663e0ac1ad"),
  Dubai: unsplash("photo-1512453979798-5ea266f8880c"),
  Maldives: unsplash("photo-1514282401047-d79a71a590e8"),
  "Swiss Alps": unsplash("photo-1531210483974-4f8c1f33fd35"),
  Kyoto: unsplash("photo-1493976040374-85c8e12f0c0e"),
  Rome: unsplash("photo-1552832230-c0197dd311b5"),
  "Reykjavík": unsplash("photo-1504893524553-b855bce32c67"),
  "New York": unsplash("photo-1496442226666-8d4d0e62e6e9"),
  "Cancún": unsplash("photo-1552074284-5e88ef1aef18"),
  Patagonia: unsplash("photo-1478827536114-da961b7f86d2"),
  Kerala: unsplash("photo-1602216056096-3b40cc0c9944"),
  Petra: unsplash("photo-1579606032821-4e6161c81bd3"),
  "Costa Rica": unsplash("photo-1536708880921-03a9306ec47d"),
  Lisbon: unsplash("photo-1585208798174-6cedd86e019a"),
  "Cape Town": unsplash("photo-1580060839134-75a5edca2e99"),
};

// FX for display only (mid-market, mock — a live build pulls quotes).
export const RATES = { USDC: 1, SOL: 1 / 175, BTC: 1 / 96000, ETH: 1 / 3400 } as const;
export type PayToken = keyof typeof RATES;

export const CASHBACK_RATE = 0.02;

export const TRAVEL_STATS = [
  { value: "2.2M+", label: "Stays & Flights" },
  { value: "230+", label: "Countries" },
  { value: "100+", label: "Cryptos Accepted" },
  { value: "2%", label: "Cashback / Booking" },
];

export const REWARD_TIERS = [
  { tier: "Explorer", req: "Free — any user", cashback: "2%", perks: "Basic support" },
  { tier: "Voyager", req: "$500+ lifetime", cashback: "3%", perks: "Priority support, free cancellation" },
  { tier: "Globetrotter", req: "$2,000+ lifetime", cashback: "5%", perks: "Room upgrades, lounge offers" },
  { tier: "Elite", req: "$10,000+ lifetime", cashback: "7%", perks: "Concierge, VIP perks, exclusive deals" },
];

export const DESTINATION_CATEGORIES: DestinationCategory[] = [
  {
    slug: "beach",
    title: "Beach Getaways",
    blurb: "Turquoise water, white sand.",
    tag: "2% Cashback",
    examples: ["Bali", "Maldives", "Miami", "Cancún"],
    gradient: "from-sky-500/30 via-cyan-400/20 to-teal-300/20",
    photo: CITY_PHOTOS["Maldives"],
  },
  {
    slug: "mountains",
    title: "Mountain Escapes",
    blurb: "Snow peaks, alpine lodges.",
    tag: "USDC accepted",
    examples: ["Swiss Alps", "Aspen", "Himalayas", "Patagonia"],
    gradient: "from-slate-400/30 via-indigo-400/20 to-blue-300/20",
    photo: CITY_PHOTOS["Swiss Alps"],
  },
  {
    slug: "cities",
    title: "Metropolitan Cities",
    blurb: "Skylines, neon nights.",
    tag: "x402 compatible",
    examples: ["Tokyo", "London", "New York", "Dubai"],
    gradient: "from-fuchsia-500/30 via-purple-500/20 to-violet-400/20",
    photo: CITY_PHOTOS["Tokyo"],
  },
  {
    slug: "eco-retreats",
    title: "Eco & Wellness",
    blurb: "Lush jungle, spa pools.",
    tag: "Solana payments",
    examples: ["Costa Rica", "Kerala", "Kyoto", "Iceland"],
    gradient: "from-emerald-500/30 via-green-400/20 to-lime-300/20",
    photo: CITY_PHOTOS["Costa Rica"],
  },
  {
    slug: "historical",
    title: "Historical Wonders",
    blurb: "Ancient ruins, architecture.",
    tag: "AI Agent booking",
    examples: ["Rome", "Petra", "Giza", "Machu Picchu"],
    gradient: "from-amber-500/30 via-orange-400/20 to-yellow-300/20",
    photo: CITY_PHOTOS["Rome"],
  },
];

const BRANDS = ["Marriott", "Hilton", "IHG", "Accor", "Hyatt", "Aman", "Four Seasons"];
const AMENITIES = ["WiFi", "Pool", "Gym", "Spa", "Parking", "Kitchen", "Breakfast", "Beach access"];
const GRADIENTS = [
  "from-sky-500/40 to-indigo-600/40",
  "from-fuchsia-500/40 to-purple-700/40",
  "from-emerald-500/40 to-teal-700/40",
  "from-amber-500/40 to-orange-700/40",
  "from-rose-500/40 to-pink-700/40",
];
const TYPES: StayType[] = ["Hotel", "Resort", "Villa", "Apartment", "Hostel"];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
const round2 = (n: number) => Math.round(n * 100) / 100;
const titleCase = (s: string) => s.replace(/\w\S*/g, (t) => t[0].toUpperCase() + t.slice(1).toLowerCase());

export function nights(checkIn?: string, checkOut?: string): number {
  const a = checkIn ? Date.parse(checkIn) : NaN;
  const b = checkOut ? Date.parse(checkOut) : NaN;
  if (isNaN(a) || isNaN(b) || b <= a) return 3;
  return Math.max(1, Math.round((b - a) / 86_400_000));
}

export function generateStays(
  city: string,
  opts: { maxNightlyUsd?: number; minStars?: number; type?: StayType; count?: number } = {},
): Stay[] {
  const c = titleCase(city || "Anywhere");
  const seed = hash(c.toLowerCase());
  const count = opts.count ?? 12;
  let stays: Stay[] = Array.from({ length: count }, (_, i) => {
    const s = ((seed >> (i % 24)) ^ (i * 2654435761)) >>> 0;
    const brand = BRANDS[(seed + i) % BRANDS.length];
    const nightly = round2(70 + (s % 380)); // ~$70–$450
    const stars = 3 + ((s >>> 3) % 3);
    return {
      id: `stay_${(seed % 0xffff).toString(16)}_${i}`,
      name: `${brand} ${c} ${["Central", "Riverside", "Bay", "Old Town", "Harbour", "Gardens"][i % 6]}`,
      brand,
      city: c,
      country: "—",
      type: TYPES[s % TYPES.length],
      stars,
      rating: round2(3.8 + ((s >>> 5) % 12) / 10),
      reviews: 120 + (s % 4200),
      nightlyUsd: nightly,
      image: GRADIENTS[i % GRADIENTS.length],
      amenities: AMENITIES.filter((_, k) => (s >>> k) & 1).slice(0, 5),
      roomsLeft: 1 + (s % 8),
      freeCancellation: (s & 1) === 0,
      eco: (s & 2) === 0,
    };
  });
  if (opts.minStars) stays = stays.filter((x) => x.stars >= opts.minStars!);
  if (opts.type) stays = stays.filter((x) => x.type === opts.type);
  if (opts.maxNightlyUsd) stays = stays.filter((x) => x.nightlyUsd <= opts.maxNightlyUsd!);
  return stays;
}

export interface Flight {
  id: string;
  carrier: string;
  carrierCode: string;
  from: string;
  to: string;
  date: string;
  departTime: string;
  arriveTime: string;
  durationMin: number;
  stops: number;
  cabin: "Economy" | "Premium" | "Business" | "First";
  priceUsd: number;
  baggage: string;
}

const CARRIERS: Array<[string, string]> = [
  ["British Airways", "BA"], ["Lufthansa", "LH"], ["Air France", "AF"], ["Emirates", "EK"],
  ["Qatar Airways", "QR"], ["Delta", "DL"], ["Singapore Airlines", "SQ"],
];

function hhmm(minsFromMidnight: number): string {
  const h = Math.floor(minsFromMidnight / 60) % 24;
  const m = minsFromMidnight % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function generateFlights(
  from: string,
  to: string,
  date: string,
  cabin: Flight["cabin"] = "Economy",
): Flight[] {
  const seed = hash(`${from}-${to}-${cabin}`.toUpperCase());
  const cabinMult = { Economy: 1, Premium: 1.6, Business: 3.2, First: 5.5 }[cabin];
  return Array.from({ length: 6 }, (_, i) => {
    const s = ((seed >> (i % 20)) ^ (i * 2246822519)) >>> 0;
    const [carrier, code] = CARRIERS[(seed + i) % CARRIERS.length];
    const depart = 300 + (s % 900); // 05:00–20:00
    const duration = 90 + (s % 780); // 1.5h–14.5h
    const stops = s % 5 === 0 ? 1 : 0;
    return {
      id: `flt_${(seed % 0xffff).toString(16)}_${i}`,
      carrier,
      carrierCode: code,
      from: (from || "LHR").toUpperCase().slice(0, 3),
      to: (to || "JFK").toUpperCase().slice(0, 3),
      date: date || new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
      departTime: hhmm(depart),
      arriveTime: hhmm(depart + duration),
      durationMin: duration,
      stops,
      cabin,
      priceUsd: round2((160 + (s % 640)) * cabinMult),
      baggage: stops === 0 ? "1 carry-on + 1 checked" : "1 carry-on",
    };
  }).sort((a, b) => a.priceUsd - b.priceUsd);
}

export function featuredDeals(): Deal[] {
  const seed = hash("furlpay-deals");
  const cities: Array<[string, string]> = [
    ["Bali", "Indonesia"], ["Tokyo", "Japan"], ["London", "UK"], ["Dubai", "UAE"],
    ["Lisbon", "Portugal"], ["Cancún", "Mexico"], ["Reykjavík", "Iceland"], ["Cape Town", "South Africa"],
  ];
  const tokens: Deal["payToken"][] = ["USDC", "SOL", "BTC"];
  return cities.map(([city, country], i) => {
    const s = ((seed >> i) ^ (i * 40503)) >>> 0;
    return {
      id: `deal_${i}`,
      city,
      country,
      name: `${BRANDS[(s) % BRANDS.length]} ${city}`,
      stars: 4 + (s % 2),
      nightlyUsd: round2(75 + (s % 120)),
      discountPct: 15 + (s % 30),
      payToken: tokens[i % tokens.length],
      image: GRADIENTS[i % GRADIENTS.length],
      photo: CITY_PHOTOS[city] ?? unsplash("photo-1436491865332-7a61a109cc05"),
    };
  });
}

// --- payment authorization (x402 for Travala route, single-use VCN for legacy) ---

export const MCC = { LODGING: "7011", AIRLINES: "4511", CAR_RENTAL: "7512" } as const;
const REBATE_RATE = 0.1;
const DEVELOPER_SHARE = 0.7;
const rid = (p: string) => p + Math.random().toString(36).slice(2, 10);

export interface Authorization {
  route: BookingSource;
  amountUsd: number;
  x402?: { proof: string; network: string; token: string };
  card?: { last4: string; mcc: string[]; singleUse: boolean; limitUsd: number };
  cashbackUsd: number;
  rebate?: { totalUsd: number; developerUsd: number; treasuryUsd: number };
  simulated: boolean;
}

export function authorizeBooking(amountUsd: number, source: BookingSource, mcc = MCC.LODGING): Authorization {
  const cashbackUsd = round2(amountUsd * CASHBACK_RATE);
  if (source === "travala") {
    const total = round2(amountUsd * REBATE_RATE);
    const developerUsd = round2(total * DEVELOPER_SHARE);
    return {
      route: "travala",
      amountUsd,
      x402: { proof: rid("x402_sim_"), network: "base", token: "USDC" },
      cashbackUsd,
      rebate: { totalUsd: total, developerUsd, treasuryUsd: round2(total - developerUsd) },
      simulated: true,
    };
  }
  return {
    route: "legacy",
    amountUsd,
    card: { last4: String(1000 + Math.floor(Math.random() * 9000)).slice(-4), mcc: [mcc], singleUse: true, limitUsd: amountUsd },
    cashbackUsd,
    simulated: true,
  };
}

export function toToken(usdAmount: number, token: PayToken): number {
  return round2(usdAmount * RATES[token] * (token === "BTC" || token === "ETH" ? 100 : 1)) / (token === "BTC" || token === "ETH" ? 100 : 1);
}

// --- car rentals ------------------------------------------------------------

export type CarCategory = "Economy" | "Compact" | "SUV" | "Luxury" | "Van";

export interface CarRental {
  id: string;
  make: string;
  model: string;
  category: CarCategory;
  seats: number;
  doors: number;
  transmission: "Automatic" | "Manual";
  fuel: "Petrol" | "Hybrid" | "Electric" | "Diesel";
  dailyUsd: number;
  supplier: string;
  supplierRating: number; // /10
  freeCancellation: boolean;
  unlimitedMileage: boolean;
  insurance: "Basic" | "Full cover" | "Zero excess";
  image: string; // gradient token
}

const CAR_MODELS: Array<[string, string, CarCategory, number, number]> = [
  ["Toyota", "Yaris", "Economy", 5, 4],
  ["Fiat", "500", "Economy", 4, 2],
  ["VW", "Golf", "Compact", 5, 4],
  ["Škoda", "Octavia", "Compact", 5, 4],
  ["Toyota", "RAV4", "SUV", 5, 4],
  ["Kia", "Sportage", "SUV", 5, 4],
  ["Tesla", "Model 3", "Luxury", 5, 4],
  ["BMW", "5 Series", "Luxury", 5, 4],
  ["Mercedes", "V-Class", "Van", 8, 4],
];
const SUPPLIERS = ["Hertz", "Avis", "Enterprise", "Sixt", "Europcar", "Budget"];
const FUELS: CarRental["fuel"][] = ["Petrol", "Hybrid", "Electric", "Diesel"];
const INSURANCE: CarRental["insurance"][] = ["Basic", "Full cover", "Zero excess"];
const CATEGORY_BASE: Record<CarCategory, number> = { Economy: 28, Compact: 38, SUV: 62, Luxury: 110, Van: 95 };

export function generateCars(
  city: string,
  opts: { category?: CarCategory; maxDailyUsd?: number; count?: number } = {},
): CarRental[] {
  const c = titleCase(city || "Anywhere");
  const seed = hash(`cars:${c.toLowerCase()}`);
  const count = opts.count ?? 12;
  let cars: CarRental[] = Array.from({ length: count }, (_, i) => {
    const s = ((seed >> (i % 22)) ^ (i * 2654435761)) >>> 0;
    const [make, model, category, seats, doors] = CAR_MODELS[(seed + i) % CAR_MODELS.length];
    const fuel = make === "Tesla" ? "Electric" : FUELS[s % FUELS.length];
    return {
      id: `car_${(seed % 0xffff).toString(16)}_${i}`,
      make,
      model,
      category,
      seats,
      doors,
      transmission: category === "Luxury" || fuel === "Electric" || (s & 1) === 0 ? "Automatic" : "Manual",
      fuel,
      dailyUsd: round2(CATEGORY_BASE[category] + (s % 45)),
      supplier: SUPPLIERS[(s >>> 4) % SUPPLIERS.length],
      supplierRating: round2(7.6 + ((s >>> 6) % 22) / 10),
      freeCancellation: (s & 2) === 0,
      unlimitedMileage: (s & 4) === 0,
      insurance: INSURANCE[(s >>> 8) % INSURANCE.length],
      image: GRADIENTS[i % GRADIENTS.length],
    };
  });
  if (opts.category) cars = cars.filter((x) => x.category === opts.category);
  if (opts.maxDailyUsd) cars = cars.filter((x) => x.dailyUsd <= opts.maxDailyUsd!);
  return cars.sort((a, b) => a.dailyUsd - b.dailyUsd);
}

// --- activities & experiences ------------------------------------------------

export const ACTIVITY_CATEGORIES = [
  "City Tours",
  "Adventure & Outdoor",
  "Food & Drink",
  "Cultural Experiences",
  "Water Sports",
  "Nightlife",
  "Day Trips",
  "Wellness & Spa",
] as const;
export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];

export interface Activity {
  id: string;
  title: string;
  city: string;
  category: ActivityCategory;
  durationHours: number;
  rating: number; // /5
  reviews: number;
  priceUsd: number;
  instantConfirmation: boolean;
  smallGroup: boolean;
  image: string; // gradient token
}

const ACTIVITY_TEMPLATES: Record<ActivityCategory, string[]> = {
  "City Tours": ["Old Town Walking Tour", "Hop-on Hop-off Bus", "Night Skyline Tour"],
  "Adventure & Outdoor": ["Sunrise Hike & Viewpoints", "Zipline Canopy Adventure", "E-bike Countryside Ride"],
  "Food & Drink": ["Street Food Crawl", "Market Tour & Cooking Class", "Wine & Tapas Evening"],
  "Cultural Experiences": ["Temple & Heritage Tour", "Artisan Workshop Visit", "Local Life Experience"],
  "Water Sports": ["Snorkeling Catamaran Cruise", "Kayak Sunset Paddle", "Scuba Discovery Dive"],
  Nightlife: ["Rooftop Bar Crawl", "Live Jazz & Cocktails", "VIP Club Night"],
  "Day Trips": ["Countryside Day Escape", "Island Hopping Day Trip", "National Park Excursion"],
  "Wellness & Spa": ["Traditional Spa Ritual", "Hot Springs Day Pass", "Sunrise Yoga Session"],
};

export function generateActivities(
  city: string,
  opts: { category?: ActivityCategory; maxPriceUsd?: number; count?: number } = {},
): Activity[] {
  const c = titleCase(city || "Anywhere");
  const seed = hash(`activities:${c.toLowerCase()}`);
  const cats = opts.category ? [opts.category] : [...ACTIVITY_CATEGORIES];
  const perCat = opts.category ? (opts.count ?? 6) : 2;
  let out: Activity[] = [];
  cats.forEach((cat, ci) => {
    const names = ACTIVITY_TEMPLATES[cat];
    for (let i = 0; i < perCat; i++) {
      const s = ((seed >> ((ci * 3 + i) % 24)) ^ ((ci * 7 + i) * 2246822519)) >>> 0;
      out.push({
        id: `act_${(seed % 0xffff).toString(16)}_${ci}_${i}`,
        title: `${c} ${names[(s + i) % names.length]}`,
        city: c,
        category: cat,
        durationHours: 1 + (s % 8),
        rating: round2(4.2 + ((s >>> 5) % 8) / 10),
        reviews: 40 + (s % 2600),
        priceUsd: round2(19 + (s % 160)),
        instantConfirmation: (s & 1) === 0,
        smallGroup: (s & 2) === 0,
        image: GRADIENTS[(ci + i) % GRADIENTS.length],
      });
    }
  });
  if (opts.maxPriceUsd) out = out.filter((a) => a.priceUsd <= opts.maxPriceUsd!);
  return out.sort((a, b) => b.rating - a.rating);
}

// --- destinations -------------------------------------------------------------

export interface Destination {
  slug: string;
  name: string;
  country: string;
  category: string; // DESTINATION_CATEGORIES slug
  tagline: string;
  gradient: string;
  heroEmoji: string;
  photo: string; // hotlinked Unsplash CDN image
  bestTime: string;
  avgHotelUsd: number;
  avgFlightUsd: number;
  visa: string;
  currency: string;
  overview: string;
  tips: string[];
  // avg high °C, Jan → Dec
  weather: number[];
}

// Photos are attached from CITY_PHOTOS by name so entries stay compact.
const RAW_DESTINATIONS: Array<Omit<Destination, "photo">> = [
  {
    slug: "tokyo", name: "Tokyo", country: "Japan", category: "cities",
    tagline: "Neon nights, ancient shrines and the world's best food city.",
    gradient: "from-fuchsia-500/40 to-purple-700/40", heroEmoji: "🗼",
    bestTime: "Mar–May · Oct–Nov", avgHotelUsd: 140, avgFlightUsd: 720,
    visa: "Visa-free ≤90 days (most passports)", currency: "JPY · ¥",
    overview: "Tokyo blends hyper-modern districts like Shibuya and Shinjuku with quiet temple neighbourhoods. Trains run to the second, konbini never close, and cash is no longer king — tap-to-pay and crypto-linked cards work almost everywhere.",
    tips: ["Get a Suica card in Apple Wallet on arrival", "Book teamLab & Ghibli tickets weeks ahead", "Stand left on Tokyo escalators", "Konbini ATMs accept foreign cards 24/7"],
    weather: [10, 10, 14, 19, 23, 26, 30, 31, 27, 22, 17, 12],
  },
  {
    slug: "bali", name: "Bali", country: "Indonesia", category: "beach",
    tagline: "Volcanic beaches, jungle villas and surf that never sleeps.",
    gradient: "from-sky-500/40 to-indigo-600/40", heroEmoji: "🌴",
    bestTime: "Apr–Oct (dry season)", avgHotelUsd: 85, avgFlightUsd: 640,
    visa: "Visa on arrival $35 (30 days)", currency: "IDR · Rp",
    overview: "From Uluwatu's cliff temples to Ubud's rice terraces, Bali packs surf, wellness and nightlife into one island. Digital-nomad friendly — villas, coworking and crypto-friendly cafés are everywhere.",
    tips: ["Rent a scooter only with an international permit", "Nusa Penida is a must day-trip", "Carry small IDR notes for warungs", "Book Ubud stays away from the main road"],
    weather: [31, 31, 31, 32, 31, 30, 29, 29, 30, 31, 31, 31],
  },
  {
    slug: "london", name: "London", country: "United Kingdom", category: "cities",
    tagline: "Museums, markets and 2,000 years of history on the Thames.",
    gradient: "from-slate-400/40 to-indigo-500/40", heroEmoji: "🎡",
    bestTime: "May–Sep", avgHotelUsd: 210, avgFlightUsd: 480,
    visa: "ETA required (most passports)", currency: "GBP · £",
    overview: "World-class free museums, West End theatre and food halls from Borough to Camden. Contactless is universal — your FurlPay virtual card works on the Tube out of the box.",
    tips: ["Tap the same card for daily Tube fare capping", "Most major museums are free", "Book West End rush tickets via TodayTix", "Sunday roast reservations fill fast"],
    weather: [8, 8, 11, 14, 18, 21, 23, 23, 20, 15, 11, 9],
  },
  {
    slug: "dubai", name: "Dubai", country: "UAE", category: "cities",
    tagline: "Desert skyline, seven-star service and crypto-native commerce.",
    gradient: "from-amber-500/40 to-orange-700/40", heroEmoji: "🏙️",
    bestTime: "Nov–Mar", avgHotelUsd: 180, avgFlightUsd: 560,
    visa: "Visa-free / on arrival (most passports)", currency: "AED · د.إ",
    overview: "Dubai is one of the most crypto-forward cities on earth — from VARA-licensed exchanges to hotels that settle in USDC. Beaches, dunes and the Burj by night.",
    tips: ["Friday brunch is an institution — book ahead", "Metro Gold class is worth the small premium", "Desert safaris are cooler (literally) after 4pm", "Many merchants accept stablecoin payments"],
    weather: [24, 25, 28, 33, 37, 39, 41, 41, 39, 35, 30, 26],
  },
  {
    slug: "maldives", name: "Maldives", country: "Maldives", category: "beach",
    tagline: "Overwater villas on the bluest water on the planet.",
    gradient: "from-sky-500/40 to-cyan-600/40", heroEmoji: "🏝️",
    bestTime: "Nov–Apr", avgHotelUsd: 420, avgFlightUsd: 780,
    visa: "Free visa on arrival (30 days)", currency: "MVR / USD",
    overview: "One island, one resort — pick yours well. Seaplane transfers, house reefs and bioluminescent beaches. Many resorts now quote and settle in USDC for zero FX drama.",
    tips: ["Split stays: one water villa + one beach villa", "Seaplanes stop at ~3pm — plan arrival flights", "All-inclusive usually beats à la carte here", "Reef-safe sunscreen only"],
    weather: [30, 30, 31, 31, 31, 30, 30, 30, 30, 30, 30, 30],
  },
  {
    slug: "swiss-alps", name: "Swiss Alps", country: "Switzerland", category: "mountains",
    tagline: "Postcard peaks, glacier trains and impossibly punctual lifts.",
    gradient: "from-slate-400/40 to-blue-500/40", heroEmoji: "🏔️",
    bestTime: "Dec–Mar (ski) · Jun–Sep (hike)", avgHotelUsd: 260, avgFlightUsd: 520,
    visa: "Schengen rules apply", currency: "CHF · Fr",
    overview: "Zermatt, Grindelwald, St. Moritz — pick a base and let the rail network do the rest. The Glacier Express and Jungfraujoch are bucket-list rides in any season.",
    tips: ["Swiss Travel Pass pays for itself in 3 days", "Book mountain huts months ahead in summer", "Grocery prices >> restaurant lunch deals", "Lifts run on the minute — don't be late"],
    weather: [-2, -1, 3, 7, 12, 15, 17, 17, 13, 9, 3, -1],
  },
  {
    slug: "kyoto", name: "Kyoto", country: "Japan", category: "eco-retreats",
    tagline: "Zen gardens, bamboo groves and 1,600 temples at dawn.",
    gradient: "from-emerald-500/40 to-teal-700/40", heroEmoji: "⛩️",
    bestTime: "Mar–Apr (sakura) · Nov (momiji)", avgHotelUsd: 120, avgFlightUsd: 700,
    visa: "Visa-free ≤90 days (most passports)", currency: "JPY · ¥",
    overview: "Japan's old capital rewards early risers: Fushimi Inari at 6am, Arashiyama bamboo before the crowds, then kaiseki dinners and machiya-stay nights.",
    tips: ["Temples at sunrise, museums at midday", "Stay in a machiya townhouse at least once", "The bus network beats trains inside Kyoto", "Gion is residential — photograph respectfully"],
    weather: [9, 10, 14, 20, 25, 28, 32, 33, 29, 23, 17, 11],
  },
  {
    slug: "costa-rica", name: "Costa Rica", country: "Costa Rica", category: "eco-retreats",
    tagline: "Cloud forests, sloths and Pacific surf — pura vida.",
    gradient: "from-emerald-500/40 to-lime-600/40", heroEmoji: "🦥",
    bestTime: "Dec–Apr (dry)", avgHotelUsd: 110, avgFlightUsd: 520,
    visa: "Visa-free ≤180 days (most passports)", currency: "CRC · ₡",
    overview: "A quarter of the country is protected rainforest. Zipline in Monteverde, surf in Santa Teresa, soak in Arenal hot springs — all within a few hours' drive.",
    tips: ["4x4 rental is worth it in green season", "Book Monteverde night walks on arrival", "USD widely accepted; colones for sodas", "Sunscreen + rain shell, every day"],
    weather: [27, 28, 29, 29, 28, 27, 27, 27, 27, 26, 26, 26],
  },
  {
    slug: "rome", name: "Rome", country: "Italy", category: "historical",
    tagline: "The Eternal City — every corner is a museum.",
    gradient: "from-amber-500/40 to-yellow-600/40", heroEmoji: "🏛️",
    bestTime: "Apr–Jun · Sep–Oct", avgHotelUsd: 165, avgFlightUsd: 450,
    visa: "Schengen rules apply", currency: "EUR · €",
    overview: "Colosseum, Forum, Vatican — then carbonara in Trastevere and gelato by the Pantheon. Walk everything; the centro storico is smaller than it looks.",
    tips: ["Book Colosseum underground tickets early", "Vatican on Tue/Thu mornings is quietest", "House wine is good wine", "Tap water fountains (nasoni) are everywhere"],
    weather: [12, 13, 16, 19, 24, 28, 31, 31, 27, 22, 16, 13],
  },
  {
    slug: "petra", name: "Petra", country: "Jordan", category: "historical",
    tagline: "The rose-red city, half as old as time.",
    gradient: "from-rose-500/40 to-orange-700/40", heroEmoji: "🐪",
    bestTime: "Mar–May · Sep–Nov", avgHotelUsd: 95, avgFlightUsd: 610,
    visa: "Jordan Pass covers visa + entry", currency: "JOD · د.ا",
    overview: "Walk the Siq at dawn and watch the Treasury glow. Stay two days: the Monastery hike and Petra by Night are worth the extra time in Wadi Musa.",
    tips: ["Buy the Jordan Pass before arrival", "Start at 6am — the Siq is empty", "The back trail from Little Petra beats the crowds", "Combine with Wadi Rum overnight camp"],
    weather: [13, 15, 18, 23, 28, 31, 32, 32, 30, 25, 19, 14],
  },
  {
    slug: "reykjavik", name: "Reykjavík", country: "Iceland", category: "eco-retreats",
    tagline: "Northern lights, black beaches and geothermal everything.",
    gradient: "from-cyan-500/40 to-blue-700/40", heroEmoji: "🌋",
    bestTime: "Jun–Aug (midnight sun) · Sep–Mar (aurora)", avgHotelUsd: 190, avgFlightUsd: 430,
    visa: "Schengen rules apply", currency: "ISK · kr",
    overview: "Use the city as a base for the Golden Circle and south coast, then soak it off in the Sky Lagoon. Iceland is effectively cashless — cards and phones only.",
    tips: ["Rent a car; tours cost more than wheels", "Aurora needs dark + clear — check vedur.is", "Hot dogs at Bæjarins Beztu are the budget meal", "Book ice-cave tours for winter only"],
    weather: [2, 3, 4, 7, 10, 13, 15, 14, 11, 7, 4, 2],
  },
  {
    slug: "new-york", name: "New York", country: "USA", category: "cities",
    tagline: "The city that never sleeps — five boroughs, infinite energy.",
    gradient: "from-violet-500/40 to-fuchsia-700/40", heroEmoji: "🗽",
    bestTime: "Apr–Jun · Sep–Nov", avgHotelUsd: 290, avgFlightUsd: 520,
    visa: "ESTA required (VWP passports)", currency: "USD · $",
    overview: "Broadway, bagels and the best skyline on earth. Tap your FurlPay card straight onto the subway turnstile — OMNY caps your weekly fare automatically.",
    tips: ["OMNY fare-caps after 12 rides/week", "Walk the High Line at golden hour", "Museum 'pay-what-you-wish' hours save $$", "Dollar slices > tourist-trap pizza"],
    weather: [4, 5, 9, 16, 21, 26, 29, 28, 24, 18, 12, 6],
  },
  {
    slug: "cancun", name: "Cancún", country: "Mexico", category: "beach",
    tagline: "Caribbean blue, Mayan ruins and cenote swims.",
    gradient: "from-teal-400/40 to-cyan-600/40", heroEmoji: "🏖️",
    bestTime: "Dec–Apr", avgHotelUsd: 150, avgFlightUsd: 380,
    visa: "Visa-free (most passports)", currency: "MXN · $",
    overview: "The hotel zone is the launchpad: Isla Mujeres by ferry, Chichén Itzá by dawn bus, and a different cenote every afternoon. All-inclusives here genuinely deliver.",
    tips: ["Cenotes beat the beach on windy days", "Chichén Itzá first bus = no crowds", "ADO buses are excellent and cheap", "Pesos get better prices than USD"],
    weather: [28, 28, 30, 31, 32, 32, 33, 33, 32, 31, 29, 28],
  },
  {
    slug: "patagonia", name: "Patagonia", country: "Argentina / Chile", category: "mountains",
    tagline: "Granite towers, turquoise lakes and the end of the world.",
    gradient: "from-indigo-500/40 to-blue-700/40", heroEmoji: "🧗",
    bestTime: "Nov–Mar (austral summer)", avgHotelUsd: 130, avgFlightUsd: 890,
    visa: "Visa-free (most passports)", currency: "ARS / CLP",
    overview: "Torres del Paine's W-trek and El Chaltén's day hikes headline, but the road trips between them are the real show. Wind is a personality here — pack for it.",
    tips: ["Book refugios 6+ months out for the W", "El Chaltén hikes are free — no permits", "Carry USD cash for Argentina's blue rate", "Weather windows change hourly — stay flexible"],
    weather: [15, 15, 13, 9, 6, 3, 3, 4, 7, 10, 12, 14],
  },
  {
    slug: "kerala", name: "Kerala", country: "India", category: "eco-retreats",
    tagline: "Backwaters, tea hills and Ayurveda by the Arabian Sea.",
    gradient: "from-green-500/40 to-emerald-700/40", heroEmoji: "🛶",
    bestTime: "Oct–Mar", avgHotelUsd: 60, avgFlightUsd: 540,
    visa: "e-Visa (most passports)", currency: "INR · ₹",
    overview: "Cruise Alleppey's backwaters on a kettuvallam houseboat, wake up in Munnar's tea estates, and finish with a beach week in Varkala. India's gentlest introduction.",
    tips: ["Book houseboats direct at the jetty for less", "Munnar mornings are cold — pack a layer", "Toddy shops serve the best fish curry", "UPI works everywhere; cards mostly do"],
    weather: [32, 32, 33, 33, 31, 29, 29, 29, 30, 30, 31, 32],
  },
];

export const DESTINATIONS: Destination[] = RAW_DESTINATIONS.map((d) => ({
  ...d,
  photo: CITY_PHOTOS[d.name] ?? unsplash("photo-1436491865332-7a61a109cc05"),
}));

export function getDestination(slug: string): Destination | undefined {
  return DESTINATIONS.find((d) => d.slug === slug);
}

export function destinationsByCategory(category: string): Destination[] {
  return DESTINATIONS.filter((d) => d.category === category);
}
