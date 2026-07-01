import Link from "next/link";
import { categoryById } from "@/lib/blog/categories";
import { getFeatured, getSortedPosts, formatDate } from "@/lib/blog/posts";
import StoryCard from "@/components/blog/StoryCard";
import CategoryBadge from "@/components/blog/CategoryBadge";
import CoverArt from "@/components/blog/CoverArt";

export const revalidate = 3600; // ISR

export const metadata = {
  title: "Furlpay Blog — Product, Engineering, Compliance & Security",
  description:
    "Product launches, engineering deep-dives, compliance updates and transparent security reporting from the Furlpay team.",
};

export default function BlogFeed() {
  const featured = getFeatured();
  const rest = getSortedPosts().filter((p) => p.slug !== featured.slug);

  return (
    <div>
      <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-neon">Featured story</p>
      <FeaturedCard />

      <div className="mb-6 mt-14 flex items-end justify-between">
        <h2 className="text-[24px] font-extrabold tracking-tighter">Latest stories</h2>
      </div>
      <div className="columns-1 gap-5 sm:columns-2 lg:columns-3">
        {rest.map((post) => (
          <StoryCard key={post.slug} post={post} />
        ))}
      </div>
    </div>
  );
}

function FeaturedCard() {
  const post = getFeatured();
  const c = categoryById(post.category);
  if (!c) return null;
  return (
    <Link
      href={`/blog/${post.slug}`}
      style={{ ["--cat" as string]: c.color }}
      className="group grid overflow-hidden rounded-card border border-white/10 bg-white/[0.03] backdrop-blur-xl transition-all hover:border-[color:var(--cat)] hover:shadow-[0_0_44px_-16px_var(--cat)] lg:grid-cols-2"
    >
      <CoverArt color={c.color} label={c.label} className="min-h-[220px] w-full lg:h-full" />
      <div className="p-7 sm:p-9">
        <CategoryBadge id={post.category} />
        <h3 className="mt-4 text-[26px] font-extrabold leading-tight tracking-tighter sm:text-[32px]">
          {post.title}
        </h3>
        <p className="mt-3 text-[15px] leading-relaxed text-textSecondary">{post.excerpt}</p>
        <p className="mt-6 text-[12px] text-textMuted">
          {formatDate(post.date)} · {post.readMins} min read · {c.label}
        </p>
      </div>
    </Link>
  );
}
