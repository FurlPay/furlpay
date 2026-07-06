import type { MetadataRoute } from "next";

// Index the marketing/docs/blog surface; keep the authenticated app and API
// out of search results.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        // Allow wins by longer-path specificity: /investing/insights is public
        // SEO content nested under the private /investing app route.
        allow: ["/", "/investing/insights"],
        disallow: [
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
        ],
      },
    ],
    sitemap: "https://furlpay.com/sitemap.xml",
  };
}
