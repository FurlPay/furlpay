import Link from "next/link";
import { notFound } from "next/navigation";
import { categoryById } from "@/lib/blog/categories";
import { POSTS, getPost, postsByCategory, formatDate } from "@/lib/blog/posts";
import CategoryBadge from "@/components/blog/CategoryBadge";
import CoverArt from "@/components/blog/CoverArt";
import ArticleBody from "@/components/blog/ArticleBody";
import StoryCard from "@/components/blog/StoryCard";

export const revalidate = 3600; // ISR

export function generateStaticParams() {
  return POSTS.map((p) => ({ slug: p.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }) {
  const post = getPost(params.slug);
  if (!post) return {};
  return { title: `${post.title} — Furlpay Blog`, description: post.excerpt };
}

export default function ArticlePage({ params }: { params: { slug: string } }) {
  const post = getPost(params.slug);
  if (!post) notFound();

  const c = categoryById(post.category);
  const related = postsByCategory(post.category).filter((p) => p.slug !== post.slug).slice(0, 3);

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/blog" className="text-[13px] text-textSecondary transition-colors hover:text-neon">
        ← Back to blog
      </Link>

      <div className="mt-6">
        <CategoryBadge id={post.category} />
      </div>
      <h1 className="mt-4 text-[32px] font-extrabold leading-tight tracking-tighter sm:text-[40px]">
        {post.title}
      </h1>
      <p className="mt-4 text-[13px] text-textMuted">
        By {post.author} · {formatDate(post.date)} · {post.readMins} min read
      </p>

      {c && <CoverArt color={c.color} label={c.label} className="mt-7 h-56 w-full rounded-card sm:h-64" />}

      <div className="mt-9">
        <ArticleBody blocks={post.body} />
      </div>

      {related.length > 0 && (
        <div className="mt-16 border-t border-white/5 pt-10">
          <h2 className="mb-6 text-[20px] font-bold tracking-tighter">More in {c?.label}</h2>
          <div className="columns-1 gap-5 sm:columns-2">
            {related.map((p) => (
              <StoryCard key={p.slug} post={p} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
