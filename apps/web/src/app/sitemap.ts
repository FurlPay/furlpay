import type { MetadataRoute } from "next";
import { POSTS } from "@/lib/blog/posts";
import { CATEGORIES } from "@/lib/blog/categories";
import { INSIGHTS } from "@/lib/insights/articles";
import { INSIGHT_CATEGORIES } from "@/lib/insights/categories";
import { CITIES } from "@/lib/cities";
import { INTEGRATIONS } from "@/lib/integrations/frameworks";
import { visibleJobs } from "@/lib/careers/jobs";

const BASE = "https://furlpay.com";
// Dynamic so lastmod reflects the actual build/deploy, not a frozen date.
const NOW = new Date();

// Search engines discover every public page from here (linked via robots.txt).
export default function sitemap(): MetadataRoute.Sitemap {
  const staticPages = [
    // — Marketing —
    { path: "", priority: 1.0, changeFrequency: "weekly" as const },
    { path: "/pricing", priority: 0.9, changeFrequency: "monthly" as const },
    { path: "/about", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/talk-to-us", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/newsletter", priority: 0.6, changeFrequency: "monthly" as const },
    { path: "/changelog", priority: 0.7, changeFrequency: "weekly" as const },
    { path: "/community", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/compare/redotpay", priority: 0.6, changeFrequency: "monthly" as const },
    { path: "/compare/gnosis-pay", priority: 0.6, changeFrequency: "monthly" as const },
    { path: "/partners", priority: 0.6, changeFrequency: "monthly" as const },
    { path: "/use-cases", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/hackathon", priority: 0.8, changeFrequency: "weekly" as const },
    { path: "/swag", priority: 0.6, changeFrequency: "monthly" as const },
    { path: "/developer", priority: 0.8, changeFrequency: "weekly" as const },
    { path: "/developer/agents", priority: 0.8, changeFrequency: "weekly" as const },
    { path: "/careers", priority: 0.7, changeFrequency: "weekly" as const },
    { path: "/ambassadors", priority: 0.9, changeFrequency: "weekly" as const },
    { path: "/payouts", priority: 0.9, changeFrequency: "weekly" as const },
    { path: "/marketplace", priority: 0.8, changeFrequency: "weekly" as const },
    // Wallet-name reservation funnel — an active launch surface, so it ranks
    // alongside the top marketing pages while handles are still open.
    { path: "/wallet", priority: 0.95, changeFrequency: "daily" as const },
    { path: "/waitlist", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/grants", priority: 0.6, changeFrequency: "monthly" as const },
    { path: "/press", priority: 0.5, changeFrequency: "monthly" as const },
    { path: "/status", priority: 0.4, changeFrequency: "weekly" as const },
    { path: "/developer/keys", priority: 0.6, changeFrequency: "monthly" as const },
    { path: "/developer/webhooks", priority: 0.6, changeFrequency: "monthly" as const },
    { path: "/developer/events", priority: 0.6, changeFrequency: "monthly" as const },

    // — Products (marketing landing pages) —
    { path: "/products", priority: 0.9, changeFrequency: "monthly" as const },
    { path: "/products/payments", priority: 0.9, changeFrequency: "monthly" as const },
    { path: "/products/merchant", priority: 0.9, changeFrequency: "monthly" as const },
    { path: "/products/travel", priority: 0.9, changeFrequency: "monthly" as const },
    { path: "/products/investing", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/products/wallet", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/products/x402", priority: 0.8, changeFrequency: "monthly" as const },

    // — Solutions (audience landing pages) —
    { path: "/solutions/ecommerce", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/solutions/saas", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/solutions/freelancers", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/solutions/enterprise", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/solutions/ai-agents", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/solutions/travel-agencies", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/solutions/hotels", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/solutions/airlines", priority: 0.8, changeFrequency: "monthly" as const },

    // — Trust & Contact —
    { path: "/trust", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/contact", priority: 0.6, changeFrequency: "monthly" as const },

    // — Interactive tools (backlink + conversion surface) —
    { path: "/resources", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/resources/tools", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/resources/tools/fee-calculator", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/resources/tools/roi-calculator", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/resources/tools/gas-estimator", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/resources/tools/stablecoin-comparison", priority: 0.7, changeFrequency: "monthly" as const },

    // — Crypto hotels (city landing pages) —
    { path: "/hotels", priority: 0.8, changeFrequency: "monthly" as const },

    // — FurlPay Travels (public funnel + content) —
    { path: "/travel", priority: 0.9, changeFrequency: "weekly" as const },
    { path: "/travel/flights", priority: 0.8, changeFrequency: "weekly" as const },
    { path: "/travel/stays", priority: 0.8, changeFrequency: "weekly" as const },
    { path: "/travel/hotels", priority: 0.8, changeFrequency: "weekly" as const },
    { path: "/travel/deals", priority: 0.8, changeFrequency: "weekly" as const },
    { path: "/travel/activities", priority: 0.7, changeFrequency: "weekly" as const },
    { path: "/travel/car-rentals", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/travel/restaurants", priority: 0.6, changeFrequency: "monthly" as const },
    { path: "/travel/gift-cards", priority: 0.6, changeFrequency: "monthly" as const },
    { path: "/travel/crypto-travel", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/travel/destinations", priority: 0.7, changeFrequency: "weekly" as const },
    { path: "/travel/guides", priority: 0.7, changeFrequency: "weekly" as const },
    { path: "/travel/itineraries", priority: 0.7, changeFrequency: "weekly" as const },
    { path: "/travel/rewards", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/travel/business", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/travel/refer", priority: 0.6, changeFrequency: "monthly" as const },
    { path: "/travel/blogs", priority: 0.6, changeFrequency: "weekly" as const },
    { path: "/travel/vlogs", priority: 0.6, changeFrequency: "weekly" as const },
    { path: "/travel/help", priority: 0.6, changeFrequency: "monthly" as const },
    { path: "/travel/price-match", priority: 0.6, changeFrequency: "monthly" as const },

    // — United Kingdom (en-GB) —
    { path: "/uk", priority: 0.9, changeFrequency: "monthly" as const },
    { path: "/uk/products/payments", priority: 0.9, changeFrequency: "monthly" as const },
    { path: "/uk/solutions/hotels", priority: 0.9, changeFrequency: "monthly" as const },
    { path: "/uk/solutions/airlines", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/uk/pricing", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/uk/trust", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/uk/compare/stripe", priority: 0.7, changeFrequency: "monthly" as const },

    // — United Arab Emirates (en-AE) —
    { path: "/ae", priority: 0.9, changeFrequency: "monthly" as const },
    { path: "/ae/products/payments", priority: 0.9, changeFrequency: "monthly" as const },
    { path: "/ae/solutions/hotels", priority: 0.9, changeFrequency: "monthly" as const },
    { path: "/ae/solutions/airlines", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/ae/pricing", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/ae/trust", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/ae/compare/stripe", priority: 0.7, changeFrequency: "monthly" as const },

    // — Japan (en-JP) —
    { path: "/jp", priority: 0.9, changeFrequency: "monthly" as const },
    { path: "/jp/products/payments", priority: 0.9, changeFrequency: "monthly" as const },
    { path: "/jp/solutions/hotels", priority: 0.9, changeFrequency: "monthly" as const },
    { path: "/jp/solutions/airlines", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/jp/pricing", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/jp/trust", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/jp/compare/stripe", priority: 0.7, changeFrequency: "monthly" as const },

    // — Comparisons —
    { path: "/compare", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/compare/bitpay", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/compare/coinbase-commerce", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/compare/travala", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/compare/stripe", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/compare/trip-com", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/compare/booking-com", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/compare/expedia", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/compare/airbnb", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/compare/getyourguide", priority: 0.7, changeFrequency: "monthly" as const },

    // — Integrations (pSEO — one page per agent framework/SDK) —
    { path: "/integrations", priority: 0.8, changeFrequency: "weekly" as const },
    ...INTEGRATIONS.map((i) => ({
      path: `/integrations/${i.slug}`,
      priority: 0.7,
      changeFrequency: "monthly" as const,
    })),

    // — Careers (self-hosted job board; open roles carry JobPosting JSON-LD) —
    ...visibleJobs().map((j) => ({
      path: `/careers/${j.slug}`,
      priority: j.status === "open" ? 0.8 : 0.6,
      changeFrequency: "weekly" as const,
    })),

    // — Docs —
    { path: "/docs", priority: 0.9, changeFrequency: "weekly" as const },
    { path: "/docs/quickstart", priority: 0.8, changeFrequency: "weekly" as const },
    { path: "/docs/agents", priority: 0.8, changeFrequency: "weekly" as const },
    { path: "/docs/payments/agent-trust", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/docs/payments/travels-mcp", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/docs/integrations/ai-assistants", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/docs/architecture/monorepo", priority: 0.6, changeFrequency: "monthly" as const },
    { path: "/docs/architecture/api-routes", priority: 0.6, changeFrequency: "monthly" as const },
    { path: "/docs/architecture/authentication", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/docs/architecture/webhooks", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/docs/architecture/errors", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/docs/architecture/rate-limits", priority: 0.6, changeFrequency: "monthly" as const },
    { path: "/docs/payments/cctp", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/docs/payments/lifi-swaps", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/docs/integrations/stripe-crypto", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/docs/integrations/persona-kyc", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/docs/payments/agentic-x402", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/docs/payments/solana-actions", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/docs/compliance/mica", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/docs/security/mpc-webauthn", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/docs/security/posture", priority: 0.7, changeFrequency: "monthly" as const },

    // — Blog & Research —
    { path: "/blog", priority: 0.9, changeFrequency: "daily" as const },
    { path: "/investing/insights", priority: 0.9, changeFrequency: "daily" as const },

    // — Legal —
    { path: "/legal/terms", priority: 0.3, changeFrequency: "yearly" as const },
    { path: "/legal/privacy", priority: 0.3, changeFrequency: "yearly" as const },
    { path: "/legal/cookies", priority: 0.3, changeFrequency: "yearly" as const },
    { path: "/legal/risk-disclosure", priority: 0.3, changeFrequency: "yearly" as const },
    { path: "/legal/aml-kyc", priority: 0.3, changeFrequency: "yearly" as const },
    { path: "/legal/acceptable-use", priority: 0.3, changeFrequency: "yearly" as const },
    { path: "/legal/agent-terms", priority: 0.4, changeFrequency: "yearly" as const },
    { path: "/legal/disclosures", priority: 0.3, changeFrequency: "yearly" as const },
    { path: "/legal/responsible-disclosure", priority: 0.4, changeFrequency: "yearly" as const },
  ].map(({ path, priority, changeFrequency }) => ({
    url: `${BASE}${path}`,
    lastModified: NOW,
    changeFrequency,
    priority,
  }));

  const posts = POSTS.map((p) => ({
    url: `${BASE}/blog/${p.slug}`,
    lastModified: new Date(p.date),
    changeFrequency: "monthly" as const,
    priority: p.featured ? 0.8 : 0.7,
  }));

  const categories = CATEGORIES.map((c) => ({
    url: `${BASE}/blog/category/${c.id}`,
    lastModified: NOW,
    changeFrequency: "weekly" as const,
    priority: 0.6,
  }));

  const insights = INSIGHTS.map((a) => ({
    url: `${BASE}/investing/insights/${a.slug}`,
    lastModified: new Date(a.date),
    changeFrequency: "monthly" as const,
    priority: a.featured ? 0.8 : 0.7,
  }));

  const insightCategories = INSIGHT_CATEGORIES.map((c) => ({
    url: `${BASE}/investing/insights/category/${c.id}`,
    lastModified: NOW,
    changeFrequency: "weekly" as const,
    priority: 0.6,
  }));

  const cityHotels = CITIES.map((c) => ({
    url: `${BASE}/hotels/${c.slug}`,
    lastModified: NOW,
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));

  return [...staticPages, ...posts, ...categories, ...insights, ...insightCategories, ...cityHotels];
}
