import { getSortedPosts } from "@/lib/blog/posts";
import { categoryById } from "@/lib/blog/categories";

const SITE_URL = "https://furlpay.com";

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function GET() {
  const posts = getSortedPosts();

  const items = posts
    .map((post) => {
      const cat = categoryById(post.category);
      const link = `${SITE_URL}/blog/${post.slug}`;
      // Convert ISO date string to RFC-822 format for RSS
      const pubDate = new Date(post.date + "T12:00:00Z").toUTCString();

      return `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${link}</link>
      <description>${escapeXml(post.excerpt)}</description>
      <pubDate>${pubDate}</pubDate>
      <guid isPermaLink="true">${link}</guid>${cat ? `\n      <category>${escapeXml(cat.label)}</category>` : ""}
    </item>`;
    })
    .join("\n");

  const lastBuildDate = posts.length > 0
    ? new Date(posts[0].date + "T12:00:00Z").toUTCString()
    : new Date().toUTCString();

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Furlpay Blog</title>
    <link>${SITE_URL}/blog</link>
    <description>Product launches, engineering deep-dives, compliance updates and transparent security reporting from the Furlpay team.</description>
    <language>en-us</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <atom:link href="${SITE_URL}/blog/rss.xml" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=600",
    },
  });
}
