// ---------------------------------------------------------------------------
// FurlPay Swag Center — merchandise catalog + contributor reward rules.
//
// Swag is EARNED with contribution points and REDEEMED here — points are scaled
// to each item's worth. Checkout collects the winner's email + shipping address
// and sends a redemption request to hello@furlpay.com; the team verifies points
// and fulfils via print-on-demand. No payment is taken on-site.
//
// Product photos live in /public/swag/<slug>.webp. Items without a photo fall
// back to a Lucide icon tile automatically.
// ---------------------------------------------------------------------------

export type SwagCategory = "Apparel" | "Drinkware" | "Accessories" | "Stickers";
// Lucide icon key — mapped to a real <Icon/> in the store (no emoji).
export type SwagIconName = "shirt" | "backpack" | "laptop" | "bottle" | "mug" | "sticker";

export interface SwagItem {
  slug: string;
  name: string;
  category: SwagCategory;
  /** Points required to redeem — scaled to the item's worth. */
  points: number;
  /** Approximate retail worth in USD, shown for transparency. */
  worthUsd: number;
  description: string;
  icon: SwagIconName; // Lucide icon shown as the tile fallback + cart thumbnail
  image?: string; // /public path; omitted → icon tile
  sizes?: string[]; // apparel only
  badge?: string; // optional ribbon, e.g. "Architect tier"
}

const APPAREL_SIZES = ["XS", "S", "M", "L", "XL", "2XL"];

export const SWAG: SwagItem[] = [
  {
    slug: "black-hoodie", name: "Black Hoodie", category: "Apparel", points: 200, worthUsd: 62,
    description: "Heavyweight black hoodie with the embroidered FurlPay mark. The one people actually keep.",
    icon: "shirt", image: "/swag/black-hoodie.webp", sizes: APPAREL_SIZES,
  },
  {
    slug: "blue-hoodie", name: "Arbitrum-Blue Hoodie", category: "Apparel", points: 200, worthUsd: 62,
    description: "Same heavyweight fit in Arbitrum blue. Soft brushed interior, ribbed cuffs.",
    icon: "shirt", image: "/swag/blue-hoodie.webp", sizes: APPAREL_SIZES,
  },
  {
    slug: "white-hoodie", name: "White Hoodie", category: "Apparel", points: 200, worthUsd: 62,
    description: "Clean white heavyweight hoodie with a tonal embroidered logo.",
    icon: "shirt", image: "/swag/white-hoodie.webp", sizes: APPAREL_SIZES,
  },
  {
    slug: "architect-jacket", name: "Architect Jacket", category: "Apparel", points: 500, worthUsd: 110,
    description: "The flagship. A premium softshell jacket with the embossed engineering motif — the reward for reaching the Architect tier.",
    icon: "shirt", image: "/swag/architect-jacket.webp", sizes: APPAREL_SIZES, badge: "Architect tier",
  },
  {
    slug: "black-tee", name: "Black Tee", category: "Apparel", points: 60, worthUsd: 24,
    description: "Combed-cotton black tee with the FurlPay wordmark. True-to-size, keeps its shape.",
    icon: "shirt", image: "/swag/black-tee.webp", sizes: APPAREL_SIZES,
  },
  {
    slug: "white-tee", name: "White Tee", category: "Apparel", points: 60, worthUsd: 24,
    description: "Crisp white combed-cotton tee with a clean logo print.",
    icon: "shirt", image: "/swag/white-tee.webp", sizes: APPAREL_SIZES,
  },
  {
    slug: "backpack", name: "Commuter Backpack", category: "Accessories", points: 250, worthUsd: 78,
    description: "Water-resistant commuter backpack with a padded laptop bay and USB pass-through. For the airport and the desk.",
    icon: "backpack", image: "/swag/backpack.webp",
  },
  {
    slug: "laptop-sleeve", name: "Laptop Sleeve", category: "Accessories", points: 120, worthUsd: 36,
    description: "Padded 14\"/16\" sleeve with a smooth zip and the printed engineering motif. Durable, premium, protective.",
    icon: "laptop", image: "/swag/laptop-sleeve.webp",
  },
  {
    slug: "insulated-bottle", name: "Insulated Bottle", category: "Drinkware", points: 90, worthUsd: 28,
    description: "Vacuum-insulated stainless steel bottle with the FurlPay mark. Keeps cold 24h, hot 12h. 20oz.",
    icon: "bottle", image: "/swag/insulated-bottle.webp",
  },
  {
    slug: "coffee-mug", name: "Builder Mug", category: "Drinkware", points: 60, worthUsd: 18,
    description: "15oz ceramic mug for the deploy days. Logo on the side, dishwasher-safe.",
    icon: "mug", image: "/swag/coffee-mug.webp",
  },
  {
    slug: "sticker-pack", name: "Sticker Pack", category: "Stickers", points: 10, worthUsd: 6,
    description: "Die-cut vinyl sticker sheet — the x402 mark, the logo, and travel glyphs. Great starter reward.",
    icon: "sticker",
  },
];

export function getSwag(slug: string): SwagItem | undefined {
  return SWAG.find((s) => s.slug === slug);
}

// How contributions convert to points — mirrors CONTRIBUTING.md.
export interface RewardTier {
  label: string;
  points: number;
  detail: string;
}

export const REWARD_TIERS: RewardTier[] = [
  { label: "Docs & typos", points: 10, detail: "Documentation fixes, README improvements, small copy edits." },
  { label: "Bug fixes & tests", points: 50, detail: "A merged bug fix, added test coverage, or a small improvement." },
  { label: "Features & security", points: 200, detail: "A shipped feature, integration, or a valid security disclosure." },
  { label: "Architect (elite)", points: 500, detail: "Sustained, high-impact contribution. By invitation — unlocks premium early access." },
];

// Extra ways to earn — non-code counts too (2026 program best-practice).
export const BONUS_RULES: string[] = [
  "First merged PR: +25 bonus points.",
  "Non-code contributions count — design, docs, translations, community support.",
  "Monthly top contributor: +100 points and a featured shout-out.",
  "Contributions are reviewed monthly; points post after a PR is merged.",
];
