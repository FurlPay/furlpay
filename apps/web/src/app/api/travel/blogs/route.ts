import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { getSortedPosts } from "@/lib/blog/posts";
import { GUIDES } from "@/lib/travel/guides";

// GET /api/travel/blogs — travel stories: blog deep-dives (travel category)
// plus practical guides, newest first.
export async function GET() {
  const stories = getSortedPosts()
    .filter((p) => p.category === "travel")
    .map((p) => ({
      type: "story" as const,
      slug: p.slug,
      url: `/blog/${p.slug}`,
      title: p.title,
      excerpt: p.excerpt,
      date: p.date,
      readMins: p.readMins,
      author: p.author,
      cover: p.cover ?? null,
    }));
  const guides = GUIDES.map((g) => ({
    type: "guide" as const,
    slug: g.slug,
    url: `/travel/guides/${g.slug}`,
    title: g.title,
    excerpt: g.excerpt,
    date: g.date,
    readMins: g.readMins,
    category: g.category,
  }));
  return NextResponse.json({
    count: stories.length + guides.length,
    stories,
    guides,
  });
}
