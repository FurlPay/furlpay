// Investing research tracks — colours drive category badges, card glow and
// cover art across the insights portal (mirrors lib/blog/categories.ts).

export type InsightCategoryId =
  | "earnings"
  | "stock-analysis"
  | "sector-watch"
  | "market-outlook"
  | "crypto-blockchain"
  | "ipo-listings";

export interface InsightCategory {
  id: InsightCategoryId;
  label: string;
  color: string; // hex, applied via inline style (dynamic → not a Tailwind class)
  blurb: string;
  icon: string; // lucide icon name (rendered by InsightCover)
}

export const INSIGHT_CATEGORIES: InsightCategory[] = [
  {
    id: "earnings",
    label: "Earnings & Results",
    color: "#FFD60A",
    blurb: "Quarterly results, beats and misses, guidance and the earnings calendar.",
    icon: "FileBarChart",
  },
  {
    id: "stock-analysis",
    label: "Stock Analysis",
    color: "#00E599",
    blurb: "Bull and bear cases, price targets and the growth names we're watching.",
    icon: "LineChart",
  },
  {
    id: "sector-watch",
    label: "Sector Watch",
    color: "#007AFF",
    blurb: "Deep dives on technology, healthcare, financials, energy and more.",
    icon: "Radar",
  },
  {
    id: "market-outlook",
    label: "Market Outlook",
    color: "#FF9500",
    blurb: "Index levels, macro trends, Fed policy and what's priced in.",
    icon: "Globe",
  },
  {
    id: "crypto-blockchain",
    label: "Crypto & Blockchain",
    color: "#AF52DE",
    blurb: "Bitcoin, Ethereum, DeFi flows and layer-2 ecosystem updates.",
    icon: "Bitcoin",
  },
  {
    id: "ipo-listings",
    label: "IPO & New Listings",
    color: "#FF3B30",
    blurb: "IPOs, token launches, new listings and debut analysis.",
    icon: "Rocket",
  },
];

export function categoryById(id: string): InsightCategory | undefined {
  return INSIGHT_CATEGORIES.find((c) => c.id === id);
}
