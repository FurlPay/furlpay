// Blog publication tracks. Colours come straight from the 2026 brand blog
// framework — used for category badges, card glow and cover art.

export type CategoryId = "product-news" | "engineering" | "compliance" | "security" | "travel";

export type Category = {
  id: CategoryId;
  label: string;
  color: string; // hex, applied via inline style (dynamic → not a Tailwind class)
  blurb: string;
};

export const CATEGORIES: Category[] = [
  {
    id: "product-news",
    label: "Product News",
    color: "#34C759",
    blurb: "Launches, B2B settlement, local bank rails and card promotions.",
  },
  {
    id: "engineering",
    label: "Engineering",
    color: "#007AFF",
    blurb: "How we build — paymasters, MPC key generation and the SDKs.",
  },
  {
    id: "compliance",
    label: "Legal & Compliance",
    color: "#FFCC00",
    blurb: "MiCA, the GENIUS Act, Travel Rule and reserve transparency.",
  },
  {
    id: "security",
    label: "Security",
    color: "#FF3B30",
    blurb: "Post-mortems, audits and patch notes — reported transparently.",
  },
  {
    id: "travel",
    label: "Travel",
    color: "#32ADE6",
    blurb: "FurlPay Travels — agentic booking, stablecoin settlement and crypto travel rails.",
  },
];

export function categoryById(id: string): Category | undefined {
  return CATEGORIES.find((c) => c.id === id);
}
