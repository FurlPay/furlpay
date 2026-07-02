import type { MetadataRoute } from "next";
import { POSTS } from "@/lib/blog/posts";
import { CATEGORIES } from "@/lib/blog/categories";

const BASE = "https://furlpay.com";
const NOW = new Date("2026-07-02");

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
    { path: "/partners", priority: 0.6, changeFrequency: "monthly" as const },
    { path: "/use-cases", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/developer", priority: 0.8, changeFrequency: "weekly" as const },
    { path: "/developer/agents", priority: 0.8, changeFrequency: "weekly" as const },
    { path: "/careers", priority: 0.7, changeFrequency: "weekly" as const },
    { path: "/marketplace", priority: 0.8, changeFrequency: "weekly" as const },
    { path: "/waitlist", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/grants", priority: 0.6, changeFrequency: "monthly" as const },
    { path: "/press", priority: 0.5, changeFrequency: "monthly" as const },
    { path: "/status", priority: 0.4, changeFrequency: "weekly" as const },
    { path: "/developer/keys", priority: 0.6, changeFrequency: "monthly" as const },
    { path: "/developer/webhooks", priority: 0.6, changeFrequency: "monthly" as const },
    { path: "/developer/events", priority: 0.6, changeFrequency: "monthly" as const },

    // — Product —
    { path: "/banking", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/investing", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/earn", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/cards", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/bills", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/credit", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/rewards", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/analytics", priority: 0.6, changeFrequency: "monthly" as const },

    // — Docs —
    { path: "/docs", priority: 0.9, changeFrequency: "weekly" as const },
    { path: "/docs/quickstart", priority: 0.8, changeFrequency: "weekly" as const },
    { path: "/docs/architecture/monorepo", priority: 0.6, changeFrequency: "monthly" as const },
    { path: "/docs/architecture/api-routes", priority: 0.6, changeFrequency: "monthly" as const },
    { path: "/docs/integrations/stripe-crypto", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/docs/integrations/persona-kyc", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/docs/payments/agentic-x402", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/docs/payments/solana-actions", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/docs/compliance/mica", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/docs/security/mpc-webauthn", priority: 0.7, changeFrequency: "monthly" as const },

    // — Blog —
    { path: "/blog", priority: 0.9, changeFrequency: "daily" as const },

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

  return [...staticPages, ...posts, ...categories];
}
