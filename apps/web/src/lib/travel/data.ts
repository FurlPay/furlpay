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
}

export interface DestinationCategory {
  slug: string;
  title: string;
  blurb: string;
  tag: string;
  examples: string[];
  gradient: string; // tailwind gradient classes
}

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
  },
  {
    slug: "mountains",
    title: "Mountain Escapes",
    blurb: "Snow peaks, alpine lodges.",
    tag: "USDC accepted",
    examples: ["Swiss Alps", "Aspen", "Himalayas", "Patagonia"],
    gradient: "from-slate-400/30 via-indigo-400/20 to-blue-300/20",
  },
  {
    slug: "cities",
    title: "Metropolitan Cities",
    blurb: "Skylines, neon nights.",
    tag: "x402 compatible",
    examples: ["Tokyo", "London", "New York", "Dubai"],
    gradient: "from-fuchsia-500/30 via-purple-500/20 to-violet-400/20",
  },
  {
    slug: "eco-retreats",
    title: "Eco & Wellness",
    blurb: "Lush jungle, spa pools.",
    tag: "Solana payments",
    examples: ["Costa Rica", "Kerala", "Kyoto", "Iceland"],
    gradient: "from-emerald-500/30 via-green-400/20 to-lime-300/20",
  },
  {
    slug: "historical",
    title: "Historical Wonders",
    blurb: "Ancient ruins, architecture.",
    tag: "AI Agent booking",
    examples: ["Rome", "Petra", "Giza", "Machu Picchu"],
    gradient: "from-amber-500/30 via-orange-400/20 to-yellow-300/20",
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
