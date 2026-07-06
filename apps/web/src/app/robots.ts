import type { MetadataRoute } from "next";

// Index the marketing/docs/blog surface; keep the authenticated app and API
// out of search results. AI-answer crawlers (ChatGPT, Claude, Perplexity,
// Google-Extended, etc.) are explicitly welcomed — being in their training and
// live-retrieval sets is how we earn citations in AI Overviews / AI Mode (GEO).

// Public content lives everywhere except the authed app and API.
const ALLOW = ["/", "/investing/insights"];
const DISALLOW = [
  "/api/",
  "/dashboard",
  "/profile",
  "/cards",
  "/banking",
  "/bills",
  "/investing",
  "/earn",
  "/credit",
  "/rewards",
  "/analytics",
];

// Named AI/LLM crawlers we explicitly allow (same surface as search engines).
const AI_CRAWLERS = [
  "GPTBot", // OpenAI training
  "OAI-SearchBot", // ChatGPT search
  "ChatGPT-User", // ChatGPT live browsing
  "ClaudeBot", // Anthropic training
  "anthropic-ai",
  "Claude-Web",
  "Claude-User",
  "PerplexityBot", // Perplexity index
  "Perplexity-User", // Perplexity live fetch
  "Google-Extended", // Gemini / AI Overviews training
  "Applebot-Extended", // Apple Intelligence
  "Amazonbot",
  "Meta-ExternalAgent", // Meta AI
  "cohere-ai",
  "CCBot", // Common Crawl (feeds many LLMs)
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      // Allow wins by longer-path specificity: /investing/insights is public
      // SEO content nested under the private /investing app route.
      { userAgent: "*", allow: ALLOW, disallow: DISALLOW },
      // Explicitly welcome AI answer engines to the same public surface.
      { userAgent: AI_CRAWLERS, allow: ALLOW, disallow: DISALLOW },
    ],
    sitemap: "https://furlpay.com/sitemap.xml",
  };
}
