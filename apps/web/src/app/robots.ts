import type { MetadataRoute } from "next";

// Index the marketing/docs/blog surface; keep the authenticated app and API
// out of search results.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/dashboard",
          "/cards",
          "/banking",
          "/bills",
          "/investing",
          "/profile",
        ],
      },
    ],
    sitemap: "https://furlpay.com/sitemap.xml",
  };
}
