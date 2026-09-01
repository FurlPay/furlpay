import Link from "next/link";
import JsonLd from "@/components/JsonLd";
import { notFound } from "next/navigation";
import { categoryById } from "@/lib/blog/categories";
import { POSTS, getPost, postsByCategory, formatDate } from "@/lib/blog/posts";
import CategoryBadge from "@/components/blog/CategoryBadge";
import CoverArt from "@/components/blog/CoverArt";
import ArticleBody from "@/components/blog/ArticleBody";
import StoryCard from "@/components/blog/StoryCard";
import NewsletterBanner from "@/components/blog/NewsletterBanner";
import AuthorBio from "@/components/blog/AuthorBio";
import { getAuthor } from "@/lib/blog/authors";

export const revalidate = 3600; // ISR

export function generateStaticParams() {
  return POSTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const post = getPost(params.slug);
  if (!post) return {};
  const url = `https://furlpay.com/blog/${post.slug}`;
  return {
    title: `${post.title} — Furlpay Blog`,
    description: post.excerpt,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      url,
      title: post.title,
      description: post.excerpt,
      publishedTime: post.date,
      authors: [post.author],
    },
    twitter: { card: "summary_large_image", title: post.title, description: post.excerpt },
  };
}

export default async function ArticlePage(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const post = getPost(params.slug);
  if (!post) notFound();

  const c = categoryById(post.category);
  const related = postsByCategory(post.category).filter((p) => p.slug !== post.slug).slice(0, 3);

  // BlogPosting structured data for rich results. Author resolves to a real
  // credentialed Person where we have one (E-E-A-T for YMYL), else an Org byline.
  const a = getAuthor(post.author);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.excerpt,
    datePublished: post.date,
    author: a.isPerson
      ? { "@type": "Person", name: a.name, url: a.url, jobTitle: a.role, sameAs: a.sameAs }
      : { "@type": "Organization", name: a.name, url: "https://furlpay.com", sameAs: a.sameAs },
    publisher: { "@id": "https://furlpay.com/#org" },
    mainEntityOfPage: `https://furlpay.com/blog/${post.slug}`,
  };

  return (
    <div className="mx-auto max-w-3xl">
      <JsonLd data={jsonLd} />
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

      {c && <CoverArt color={c.color} label={c.label} photo={post.cover} className="mt-7 h-56 w-full rounded-card sm:h-64" />}

      <div className="mt-9">
        <ArticleBody blocks={post.body} />
      </div>

      <AuthorBio author={post.author} />

      <div className="mt-12">
        <NewsletterBanner />
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
