import type { MetadataRoute } from "next";

// Index the marketing/docs/blog/research surface; keep the authenticated app
// and API out of search results. robots.txt is a crawl-budget and courtesy
// signal, NOT access control: anything private is protected by the session
// middleware, whatever a crawler is told here.

// Public content lives everywhere except the authed app and API.
const ALLOW = ["/", "/investing/insights"];
const DISALLOW = [
  "/api/",
  "/dashboard",
  "/profile",
  "/cards",
  "/banking",
  "/bills",
  "/portfolio",
  "/earn",
  "/credit",
  "/rewards",
  "/spending",
  "/analytics", // admin analytics dashboard
  // Per-user account history. Nothing here is indexable and every path under
  // it is user-scoped, so it is disallowed explicitly rather than relying on
  // the auth redirect — a crawler should not spend budget discovering that.
  "/notifications",
];

// Policy, by what a crawler does with the page. Every group gets the SAME
// public surface today; they are named separately so each can be changed on
// its own (founder decisions are marked).

// 1. Search engines: index pages and send visitors. Verified in 2026-10 traffic
//    by forward-confirmed reverse DNS: Bingbot (search.msn.com), PetalBot
//    (petalsearch.com), YouBot (search.you.com), Googlebot (googlebot.com).
const SEARCH_CRAWLERS = ["Googlebot", "Bingbot", "PetalBot", "YouBot", "DuckDuckBot", "Applebot"];

// 2. AI answer/search retrieval: fetch pages to answer a question, usually
//    with a citation back. Being retrievable is how we earn AI citations.
const AI_RETRIEVAL = [
  "OAI-SearchBot", // ChatGPT search index
  "ChatGPT-User", // ChatGPT fetching a page a user asked about
  "Claude-User", // Claude fetching a page a user asked about
  "Claude-SearchBot",
  "Perplexity-User", // Perplexity live fetch
  "PerplexityBot", // Perplexity index
];

// 3. AI training crawlers: collect pages for model training; no visitor or
//    citation follows directly. FOUNDER DECISION: currently allowed (unchanged
//    from the previous policy, which welcomed them for GEO visibility). To opt
//    out, move this group to `disallow: ["/"]` — search and retrieval above
//    are unaffected because each group is matched by its own user agent.
const AI_TRAINING = [
  "GPTBot", // OpenAI training
  "ClaudeBot", // Anthropic training
  "anthropic-ai",
  "Claude-Web",
  "Google-Extended", // Gemini / AI Overviews training (not Google Search)
  "Applebot-Extended", // Apple Intelligence training (not Apple search)
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
      { userAgent: SEARCH_CRAWLERS, allow: ALLOW, disallow: DISALLOW },
      { userAgent: AI_RETRIEVAL, allow: ALLOW, disallow: DISALLOW },
      { userAgent: AI_TRAINING, allow: ALLOW, disallow: DISALLOW },
    ],
    sitemap: "https://furlpay.com/sitemap.xml",
  };
}
