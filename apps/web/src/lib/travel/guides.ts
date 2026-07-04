// FurlPay Travels guides — practical, evergreen content for /travel/guides.
// Deep-dive engineering/strategy stories live on the blog under the "travel"
// category; these guides are the how-to layer that links into the funnel.

export type GuideCategory =
  | "Destinations"
  | "Crypto Payments"
  | "Tutorials"
  | "AI Agents"
  | "Tips & Packing"
  | "Sustainable Travel"
  | "Cards & Rewards";

export interface GuideSection {
  h2?: string;
  paragraphs: string[];
  bullets?: string[];
}

export interface Guide {
  slug: string;
  title: string;
  category: GuideCategory;
  excerpt: string;
  readMins: number;
  date: string; // ISO
  sections: GuideSection[];
  cta?: { label: string; href: string };
}

export const GUIDE_CATEGORIES: Array<{ id: GuideCategory; blurb: string }> = [
  { id: "Destinations", blurb: "Country & city guides with crypto-friendly picks." },
  { id: "Crypto Payments", blurb: "How to pay for travel with stablecoins and tokens." },
  { id: "Tutorials", blurb: "Step-by-step booking walkthroughs." },
  { id: "AI Agents", blurb: "Let your agent search, book and pay via MCP + x402." },
  { id: "Tips & Packing", blurb: "Checklists and hard-won travel wisdom." },
  { id: "Sustainable Travel", blurb: "Lower-impact ways to see the world." },
  { id: "Cards & Rewards", blurb: "Virtual cards, cashback tiers and comparisons." },
];

export const GUIDES: Guide[] = [
  {
    slug: "how-to-pay-for-travel-with-crypto",
    title: "How to Pay for Travel with Crypto in 2026",
    category: "Crypto Payments",
   
    excerpt:
      "USDC, SOL, BTC or 100+ tokens — every way to fund a trip on FurlPay, from direct wallet payments to single-use Visa cards.",
    readMins: 6,
    date: "2026-07-01",
    sections: [
      {
        paragraphs: [
          "Paying for travel with crypto used to mean finding the one hotel in town that accepted Bitcoin. In 2026 it means the opposite problem: choosing between five different payment paths, each with different fees, speed and cashback. This guide walks through all of them.",
        ],
      },
      {
        h2: "Path 1 — Pay direct from your wallet",
        paragraphs: [
          "Connect Phantom, Solflare or Coinbase Wallet at checkout and settle in USDC or SOL. FurlPay locks your exchange rate for 15 minutes, so the price you see is the price that settles — even if the market moves while you're finding your hardware wallet.",
        ],
        bullets: ["Best for: crypto-native users", "Settlement: instant via x402 on Base or Solana", "Cashback: 2–7% in USDC depending on your tier"],
      },
      {
        h2: "Path 2 — FurlPay balance",
        paragraphs: [
          "If you already hold a FurlPay balance, one tap pays the booking with no wallet pop-ups and no network fees. Refunds land back in the balance instantly on cancellation.",
        ],
      },
      {
        h2: "Path 3 — Single-use virtual Visa card",
        paragraphs: [
          "For merchants that only take cards, FurlPay generates a one-time Visa VCN funded from your stablecoin balance. The card is MCC-locked to travel merchants and dies after one authorization — card-not-present fraud simply has nothing to steal.",
        ],
      },
      {
        h2: "Rate locks, refunds and the Travel Rule",
        paragraphs: [
          "Every checkout locks its quote for 15 minutes. Cancellations follow the property's policy and refund to your original payment method or balance. For crypto payments over $1,000, FurlPay collects Travel Rule originator information at checkout — a one-time form that takes under a minute.",
        ],
      },
    ],
    cta: { label: "See the full crypto travel guide", href: "/travel/crypto-travel" },
  },
  {
    slug: "how-to-book-flights-with-usdc",
    title: "How to Book Flights with USDC — Step by Step",
    category: "Tutorials",
   
    excerpt: "From search to boarding pass in five steps, with a 15-minute rate lock so turbulence stays in the air, not your checkout.",
    readMins: 4,
    date: "2026-06-28",
    sections: [
      {
        paragraphs: [
          "Booking a flight with USDC on FurlPay takes about three minutes end-to-end. Here's the exact flow.",
        ],
      },
      {
        h2: "The five steps",
        paragraphs: [],
        bullets: [
          "1. Search — enter route, dates and cabin on /travel/flights.",
          "2. Compare — every fare shows USD and live USDC/SOL equivalents plus your cashback.",
          "3. Select — traveler details autofill from your FurlPay profile.",
          "4. Pay — connect a wallet or use balance; the rate locks for 15 minutes.",
          "5. Fly — e-ticket lands in your email and /travel/my-trips instantly, with the tx hash linked to Solscan or Basescan.",
        ],
      },
      {
        h2: "What if the price moves mid-checkout?",
        paragraphs: [
          "It can't — that's the point of the rate lock. The USDC amount quoted when you enter checkout is guaranteed for 15 minutes. If the timer expires, you get a fresh quote before anything is charged. No surprise slippage, ever.",
        ],
      },
    ],
    cta: { label: "Search flights now", href: "/travel/flights" },
  },
  {
    slug: "let-your-ai-agent-book-travel",
    title: "Let Your AI Agent Book Travel (MCP + x402)",
    category: "AI Agents",
   
    excerpt:
      "Give Claude a budget, not your card number. How MCP composition and x402 budget guards make autonomous booking safe.",
    readMins: 5,
    date: "2026-07-02",
    sections: [
      {
        paragraphs: [
          "\"Book me a 4-star hotel in Tokyo under $150 a night for next weekend\" is now a valid payment instruction. Your agent searches Travala's Travel MCP, picks a hotel, and settles through FurlPay's payment MCP — while a budget guard makes overspending cryptographically impossible.",
        ],
      },
      {
        h2: "How the pieces fit",
        paragraphs: [
          "Two MCP servers compose: Travala's travel-mcp handles inventory (2.2M+ properties), and FurlPay's payment server handles authorization. You approve a spending policy once — say $500 for this trip — and the agent gets an ERC-7715 session key scoped to exactly that. Every payment is an x402 proof checked against the policy on-chain.",
        ],
        bullets: [
          "You set the budget; the agent can never exceed it",
          "Bookings settle gaslessly in USDC on Base",
          "Every transaction is auditable via its on-chain hash",
          "Revoke the session key any time to cut the agent off",
        ],
      },
      {
        h2: "Try it",
        paragraphs: [
          "Add the FurlPay travel MCP to Claude, fund a wallet with USDC, and set a budget on the checkout page's 'AI Agent Authorization' method. The deep-dive engineering write-up is on our blog.",
        ],
      },
    ],
    cta: { label: "Read the engineering deep-dive", href: "/blog/letting-your-ai-agent-book-travel-travala-mcp-furlpay" },
  },
  {
    slug: "crypto-friendly-packing-checklist",
    title: "The Crypto Traveler's Packing Checklist",
    category: "Tips & Packing",
   
    excerpt: "Hardware wallet or not? Backup passkeys? The 12 things a self-custodial traveler should sort before wheels-up.",
    readMins: 4,
    date: "2026-06-20",
    sections: [
      {
        paragraphs: [
          "Traveling with self-custodial funds is safer than carrying cash — if you prepare. This is the checklist we use ourselves.",
        ],
      },
      {
        h2: "Before you leave",
        paragraphs: [],
        bullets: [
          "Register a second passkey (phone + laptop) so losing one device isn't lockout",
          "Preload your FurlPay balance for tap-speed payments abroad",
          "Generate a travel VCN with a trip-sized limit for card-only merchants",
          "Store your recovery kit offline at home — never in cloud notes",
          "Set a spending policy so a stolen phone can't drain the wallet",
          "Download offline maps and your e-tickets from /travel/my-trips",
        ],
      },
      {
        h2: "On the road",
        paragraphs: [],
        bullets: [
          "Pay in local currency when a terminal offers a choice (skip DCC markups)",
          "Use eSIMs over airport SIM stands — pay for them in USDC",
          "Keep cashback auto-depositing; it compounds over a long trip",
          "Screenshot booking confirmations for border officials",
          "Check tx hashes on Solscan if a merchant claims non-payment",
          "Revoke any agent session keys you're not actively using",
        ],
      },
    ],
    cta: { label: "Set up your travel card", href: "/cards" },
  },
  {
    slug: "sustainable-travel-guide",
    title: "Sustainable Travel, Measured Honestly",
    category: "Sustainable Travel",
   
    excerpt: "Eco-certified stays, trains over short-hops, and why on-chain settlement is the least of your footprint.",
    readMins: 5,
    date: "2026-06-15",
    sections: [
      {
        paragraphs: [
          "Sustainable travel is mostly about three big choices — how far you fly, where you stay, and how you move around locally. Everything else is rounding error, so this guide focuses on the decisions that actually shift the number.",
        ],
      },
      {
        h2: "The choices that matter",
        paragraphs: [],
        bullets: [
          "Fly less, stay longer — one 3-week trip beats three 1-week trips",
          "Filter for eco-certified stays (the leaf toggle on /travel/stays)",
          "Trains beat planes under ~700km, and sleeper trains beat both",
          "Eat local: food miles compound fast at resort buffets",
          "Offsets are a last resort — reduction first, always",
        ],
      },
      {
        h2: "Where FurlPay helps",
        paragraphs: [
          "Every eco-certified property is flagged in search results, and settlement on modern proof-of-stake L2s consumes roughly the energy of sending an email — the payment is genuinely the greenest part of your trip. Our Eco & Wellness destination collection curates lower-impact escapes from Costa Rica to Kyoto.",
        ],
      },
    ],
    cta: { label: "Browse eco retreats", href: "/travel/destinations/eco-retreats" },
  },
  {
    slug: "furlpay-card-vs-traditional-travel-cards",
    title: "FurlPay Card vs. Traditional Travel Cards",
    category: "Cards & Rewards",
   
    excerpt: "3% FX markups and 30-day statements vs. mid-market rates and instant USDC cashback — the honest comparison.",
    readMins: 5,
    date: "2026-06-10",
    sections: [
      {
        paragraphs: [
          "Traditional travel credit cards compete on sign-up bonuses and lounge passes, then quietly claw it back with FX markups, annual fees and points that devalue. Here's the line-by-line comparison.",
        ],
      },
      {
        h2: "The numbers",
        paragraphs: [],
        bullets: [
          "FX rate: mid-market on FurlPay vs. 1.5–3% markup on most bank cards",
          "Cashback: 2–7% in liquid USDC vs. 1–2% in devaluing points",
          "Settlement: instant, on-chain, 24/7/365 vs. 1–3 business days",
          "Fraud surface: single-use MCC-locked VCNs vs. one number reused everywhere",
          "Annual fee: $0 vs. $95–$695 for comparable travel perks",
        ],
      },
      {
        h2: "Where traditional cards still win",
        paragraphs: [
          "Airport lounges, primary rental-car insurance and chargeback leverage on non-crypto rails remain genuine advantages of the big travel cards. Many travelers carry both: FurlPay for spend and cashback, a legacy card for its lounge pass. That's a rational split — just stop paying FX markups on the spend.",
        ],
      },
    ],
    cta: { label: "Explore rewards tiers", href: "/travel/rewards" },
  },
  {
    slug: "best-crypto-friendly-cities",
    title: "The 5 Most Crypto-Friendly Cities to Visit in 2026",
    category: "Destinations",
   
    excerpt: "Dubai, Tokyo, Lisbon, Singapore and Miami — where paying in stablecoins is normal, not novel.",
    readMins: 5,
    date: "2026-06-25",
    sections: [
      {
        paragraphs: [
          "Some cities make crypto payments feel like the future; these five make it feel like Tuesday. Ranked by how far a USDC balance gets you on the ground.",
        ],
      },
      {
        h2: "The shortlist",
        paragraphs: [],
        bullets: [
          "Dubai — VARA-licensed everything; hotels and even rents settle in USDC",
          "Tokyo — tap-to-pay universal, crypto-linked cards work from Narita onward",
          "Lisbon — Europe's crypto-nomad capital, café-level acceptance",
          "Singapore — regulated, fast, and stablecoin-friendly for business travel",
          "Miami — the on-ramp of the Americas, from art fairs to marina fees",
        ],
      },
      {
        h2: "Booking them",
        paragraphs: [
          "All five are in our destination collections with curated stays, average prices and local tips — every booking pays 2%+ cashback in USDC regardless of where you land.",
        ],
      },
    ],
    cta: { label: "Browse city destinations", href: "/travel/destinations/cities" },
  },
];

export function getGuide(slug: string): Guide | undefined {
  return GUIDES.find((g) => g.slug === slug);
}
