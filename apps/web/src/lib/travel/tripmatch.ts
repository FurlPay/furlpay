// Furl AI Trip Match — natural-language destination search.
//
// Parses an unstructured query ("beach under $100 a night, visa free, good for
// remote work in november") into structured signals, then scores every
// destination against them. The demo parser is deterministic keyword + budget
// extraction; the live build routes the query through the LLM and keeps this
// scorer as the ranking layer.

import { DESTINATIONS, type Destination } from "@/lib/travel/data";

export interface TripMatchSignal {
  label: string; // human-readable chip shown in the UI ("beach", "under $100/night")
  kind: "vibe" | "budget" | "month" | "visa" | "interest";
}

export interface TripMatch {
  destination: Pick<
    Destination,
    "slug" | "name" | "country" | "tagline" | "photo" | "avgHotelUsd" | "avgFlightUsd" | "bestTime" | "visa"
  >;
  score: number;
  /** Which of the parsed signals this destination satisfied. */
  hits: string[];
}

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

// vibe keyword → destination category slugs + free-text hints scored against
// the tagline/overview/tips corpus.
const VIBES: Array<{ words: string[]; categories: string[]; hints: string[]; label: string }> = [
  { words: ["beach", "island", "surf", "snorkel", "diving"], categories: ["beach"], hints: ["beach", "surf", "island"], label: "beach" },
  { words: ["mountain", "hike", "hiking", "trek", "ski", "alpine"], categories: ["mountains"], hints: ["mountain", "trek", "hike", "ski"], label: "mountains" },
  { words: ["city", "urban", "museum", "shopping", "architecture"], categories: ["cities"], hints: ["museum", "district", "skyline"], label: "city break" },
  { words: ["nightlife", "party", "club", "bar"], categories: ["cities", "beach"], hints: ["nightlife", "party", "bar"], label: "nightlife" },
  { words: ["food", "foodie", "eat", "restaurant", "culinary", "street food"], categories: [], hints: ["food", "restaurant", "eat", "culinary", "street"], label: "food scene" },
  { words: ["nomad", "remote work", "coworking", "workation", "wifi"], categories: [], hints: ["nomad", "coworking", "wifi", "café", "cafe"], label: "remote-work friendly" },
  { words: ["family", "kids", "children"], categories: [], hints: ["family", "kid"], label: "family friendly" },
  { words: ["quiet", "relax", "wellness", "spa", "peaceful", "chill"], categories: ["beach", "mountains"], hints: ["wellness", "quiet", "relax", "spa"], label: "relaxing" },
  { words: ["crypto", "usdc", "stablecoin", "bitcoin"], categories: [], hints: ["crypto", "stablecoin", "usdc"], label: "crypto friendly" },
  { words: ["culture", "history", "temple", "ancient", "heritage"], categories: [], hints: ["temple", "history", "ancient", "heritage", "shrine"], label: "culture & history" },
];

export function parseSignals(query: string): TripMatchSignal[] {
  const q = query.toLowerCase();
  const signals: TripMatchSignal[] = [];

  for (const v of VIBES) {
    if (v.words.some((w) => q.includes(w))) signals.push({ label: v.label, kind: "vibe" });
  }

  // budget: "under $100", "below 150", "$80/night", "budget of 200"
  const budget = q.match(/(?:under|below|less than|max|budget of|around)?\s*\$?\s*(\d{2,4})(?:\s*(?:usd|dollars|bucks))?\s*(?:\/|a |per )?\s*night/i)
    ?? q.match(/(?:under|below|less than|max|budget of)\s*\$?\s*(\d{2,4})/i);
  if (budget) signals.push({ label: `under $${budget[1]}/night`, kind: "budget" });

  const month = MONTHS.find((m) => q.includes(m));
  if (month) signals.push({ label: month[0].toUpperCase() + month.slice(1), kind: "month" });

  if (/visa[- ]?free|no visa|without a visa/.test(q)) signals.push({ label: "visa-free", kind: "visa" });

  return signals;
}

function budgetFromSignals(signals: TripMatchSignal[]): number | undefined {
  const b = signals.find((s) => s.kind === "budget");
  if (!b) return undefined;
  const n = b.label.match(/\d+/);
  return n ? Number(n[0]) : undefined;
}

export function matchTrips(query: string, limit = 4): { signals: TripMatchSignal[]; matches: TripMatch[] } {
  const q = query.toLowerCase();
  const signals = parseSignals(query);
  const budget = budgetFromSignals(signals);
  const monthSignal = signals.find((s) => s.kind === "month");
  const wantsVisaFree = signals.some((s) => s.kind === "visa");
  const activeVibes = VIBES.filter((v) => v.words.some((w) => q.includes(w)));

  const scored: TripMatch[] = DESTINATIONS.map((d) => {
    const corpus = `${d.tagline} ${d.overview} ${d.tips.join(" ")}`.toLowerCase();
    let score = 0;
    const hits: string[] = [];

    for (const v of activeVibes) {
      let hit = v.categories.includes(d.category);
      if (v.hints.some((h) => corpus.includes(h))) hit = true;
      if (hit) {
        score += 3;
        hits.push(v.label);
      }
    }

    if (budget !== undefined) {
      if (d.avgHotelUsd <= budget) {
        score += 3;
        hits.push(`avg $${d.avgHotelUsd}/night`);
      } else if (d.avgHotelUsd <= budget * 1.25) {
        score += 1; // close enough to surface with a caveat
      } else {
        score -= 2;
      }
    }

    if (monthSignal) {
      const mon = monthSignal.label.slice(0, 3).toLowerCase();
      if (d.bestTime.toLowerCase().includes(mon)) {
        score += 2;
        hits.push(`great in ${monthSignal.label}`);
      }
    }

    if (wantsVisaFree && /visa[- ]?free/i.test(d.visa)) {
      score += 2;
      hits.push("visa-free");
    }

    // direct name/country mention always wins
    if (q.includes(d.name.toLowerCase()) || q.includes(d.country.toLowerCase())) {
      score += 6;
      hits.unshift(d.name);
    }

    return {
      destination: {
        slug: d.slug, name: d.name, country: d.country, tagline: d.tagline, photo: d.photo,
        avgHotelUsd: d.avgHotelUsd, avgFlightUsd: d.avgFlightUsd, bestTime: d.bestTime, visa: d.visa,
      },
      score,
      hits: [...new Set(hits)],
    };
  })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return { signals, matches: scored };
}
