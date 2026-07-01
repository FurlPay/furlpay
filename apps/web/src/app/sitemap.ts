import type { MetadataRoute } from "next";
import { POSTS } from "@/lib/blog/posts";
import { CATEGORIES } from "@/lib/blog/categories";

const BASE = "https://furlpay.com";

// Search engines discover every public page from here (linked via robots.ts).
export default function sitemap(): MetadataRoute.Sitemap {
  const staticPages = [
    { path: "", priority: 1.0, changeFrequency: "weekly" as const },
    { path: "/signup", priority: 0.9, changeFrequency: "monthly" as const },
    { path: "/login", priority: 0.5, changeFrequency: "monthly" as const },
    { path: "/developer", priority: 0.8, changeFrequency: "weekly" as const },
    { path: "/docs", priority: 0.9, changeFrequency: "weekly" as const },
    { path: "/docs/quickstart", priority: 0.8, changeFrequency: "weekly" as const },
    { path: "/docs/architecture/monorepo", priority: 0.6, changeFrequency: "monthly" as const },
    { path: "/docs/architecture/api-routes", priority: 0.6, changeFrequency: "monthly" as const },
    { path: "/docs/integrations/stripe-crypto", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/docs/integrations/persona-kyc", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/docs/compliance/mica", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/docs/security/mpc-webauthn", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/blog", priority: 0.9, changeFrequency: "daily" as const },
    { path: "/legal/terms", priority: 0.3, changeFrequency: "yearly" as const },
    { path: "/legal/privacy", priority: 0.3, changeFrequency: "yearly" as const },
    { path: "/legal/disclosures", priority: 0.3, changeFrequency: "yearly" as const },
  ].map(({ path, priority, changeFrequency }) => ({
    url: `${BASE}${path}`,
    lastModified: new Date(),
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
    lastModified: new Date(),
    changeFrequency: "weekly" as const,
    priority: 0.6,
  }));

  return [...staticPages, ...posts, ...categories];
}
