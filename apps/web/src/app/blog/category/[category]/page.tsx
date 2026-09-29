import { notFound } from "next/navigation";
import { CATEGORIES, categoryById } from "@/lib/blog/categories";
import { postsByCategory } from "@/lib/blog/posts";
import StoryCard from "@/components/blog/StoryCard";

export const revalidate = 3600; // ISR

// The param set below is the complete list, so any other slug is a real miss.
// Without this Next renders it on demand and the not-found page is returned
// with a 200 — a soft 404 that Google indexes as content. Same rule as
// /hotels/[city].
export const dynamicParams = false;

export function generateStaticParams() {
  return CATEGORIES.map((c) => ({ category: c.id }));
}

export async function generateMetadata(props: { params: Promise<{ category: string }> }) {
  const params = await props.params;
  const c = categoryById(params.category);
  if (!c) return {};
  return { title: `${c.label} — Furlpay Blog`, description: c.blurb };
}

export default async function CategoryPage(props: { params: Promise<{ category: string }> }) {
  const params = await props.params;
  const c = categoryById(params.category);
  if (!c) notFound();

  const posts = postsByCategory(c.id);

  return (
    <div>
      <p
        className="mb-3 text-[12px] font-semibold uppercase tracking-[0.18em]"
        style={{ color: c.color }}
      >
        {c.label}
      </p>
      <h1 className="text-[32px] font-extrabold tracking-tighter sm:text-[40px]">{c.label}</h1>
      <p className="mt-3 max-w-2xl text-[15px] text-textSecondary">{c.blurb}</p>

      {posts.length === 0 ? (
        <p className="mt-12 text-[14px] text-textMuted">No stories in this track yet — check back soon.</p>
      ) : (
        <div className="mt-10 columns-1 gap-5 sm:columns-2 lg:columns-3">
          {posts.map((post) => (
            <StoryCard key={post.slug} post={post} />
          ))}
        </div>
      )}
    </div>
  );
}
