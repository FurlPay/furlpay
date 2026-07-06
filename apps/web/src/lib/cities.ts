// City directory for the programmatic /hotels/[city] pages. Each city carries
// enough unique, factual context (why crypto/tourism matters there, the local
// currency, and which regional hotels page to hand off to) that the pages are
// genuinely differentiated — not thin doorway pages.

export type City = {
  slug: string;
  name: string;
  country: "United States" | "United Kingdom" | "United Arab Emirates";
  currency: string; // symbol used in copy
  hotelsHref: string; // regional /solutions/hotels handoff
  // One-to-two sentence, factual reason this city fits crypto hotel payments.
  context: string;
  // A distinct angle for the FAQ / body so no two pages read the same.
  angle: string;
};

export const CITIES: City[] = [
  { slug: "miami", name: "Miami", country: "United States", currency: "$", hotelsHref: "/solutions/hotels",
    context: "Miami is one of the most crypto-forward cities in the US, with a large share of international visitors from Latin America and Europe whose cards carry cross-border and FX fees.",
    angle: "South Beach and Brickell boutique hotels see heavy international and crypto-native demand." },
  { slug: "new-york", name: "New York", country: "United States", currency: "$", hotelsHref: "/solutions/hotels",
    context: "New York has among the highest concentration of crypto-accepting businesses in the US and a constant flow of international travellers paying with foreign cards.",
    angle: "Manhattan's high average room rates make even a one-point fee difference material." },
  { slug: "las-vegas", name: "Las Vegas", country: "United States", currency: "$", hotelsHref: "/solutions/hotels",
    context: "Las Vegas is a global tourism and conference capital, hosting events like Money 20/20, with huge volumes of high-value, international hotel bookings.",
    angle: "Resort and conference properties process large tickets where card fees and chargebacks add up fast." },
  { slug: "austin", name: "Austin", country: "United States", currency: "$", hotelsHref: "/solutions/hotels",
    context: "Austin sits in one of the most crypto-friendly US states and is a growing tech and events hub with a young, digitally native visitor base.",
    angle: "Independent hotels near downtown and the events district can differentiate by accepting crypto first." },
  { slug: "san-francisco", name: "San Francisco", country: "United States", currency: "$", hotelsHref: "/solutions/hotels",
    context: "San Francisco has among the highest crypto ownership per capita in the US and a dense population of Web3 and fintech travellers.",
    angle: "Business travellers in tech expense stays and increasingly hold stablecoins." },
  { slug: "los-angeles", name: "Los Angeles", country: "United States", currency: "$", hotelsHref: "/solutions/hotels",
    context: "Los Angeles is a major international tourism gateway, with large volumes of overseas guests whose card payments incur FX conversion costs.",
    angle: "International leisure demand means a high share of foreign-card bookings." },
  { slug: "orlando", name: "Orlando", country: "United States", currency: "$", hotelsHref: "/solutions/hotels",
    context: "Orlando's theme-park tourism draws enormous international family travel, a segment hit hard by card FX and cross-border fees.",
    angle: "High-volume, international leisure bookings reward even small per-transaction savings." },
  { slug: "chicago", name: "Chicago", country: "United States", currency: "$", hotelsHref: "/solutions/hotels",
    context: "Chicago is a major US business-travel and convention hub, where corporate guests increasingly expense stays and value fast settlement.",
    angle: "Convention-season demand concentrates high-value bookings into short windows." },
  { slug: "seattle", name: "Seattle", country: "United States", currency: "$", hotelsHref: "/solutions/hotels",
    context: "Seattle is a tech-forward city with a digitally native visitor base and strong international connections across the Pacific.",
    angle: "Tech travellers are comfortable with passkey wallets and stablecoins." },
  { slug: "denver", name: "Denver", country: "United States", currency: "$", hotelsHref: "/solutions/hotels",
    context: "Denver is a fast-growing US destination and a rising crypto community hub, with heavy seasonal and events-driven tourism.",
    angle: "Seasonal peaks make cash-flow and instant settlement especially valuable." },
  { slug: "london", name: "London", country: "United Kingdom", currency: "£", hotelsHref: "/uk/solutions/hotels",
    context: "London runs one of the world's largest hotel markets with a very high share of international guests, whose cards carry foreign-transaction and FX fees.",
    angle: "Overseas demand is the norm, so removing FX on those bookings compounds quickly." },
  { slug: "dubai", name: "Dubai", country: "United Arab Emirates", currency: "AED ", hotelsHref: "/ae/solutions/hotels",
    context: "Dubai has the highest international-guest share and among the highest room rates globally, and luxury properties such as Palazzo Versace Dubai already accept crypto.",
    angle: "Ultra-luxury, cross-border bookings are exactly where card fees and FX bite hardest." },
];

export function getCity(slug: string): City | undefined {
  return CITIES.find((c) => c.slug === slug);
}
