import Link from "next/link";
import { categoryById } from "@/lib/blog/categories";
import { formatDate, type Post } from "@/lib/blog/posts";
import CategoryBadge from "@/components/blog/CategoryBadge";
import CoverArt from "@/components/blog/CoverArt";

// Glassmorphic story card for the masonry grid. Border + glow adopt the
// category colour on hover (via the --cat CSS var).
export default function StoryCard({ post }: { post: Post }) {
  const c = categoryById(post.category);
  if (!c) return null;
  return (
    <Link
      href={`/blog/${post.slug}`}
      style={{ ["--cat" as string]: c.color }}
      className="group mb-5 block w-full break-inside-avoid overflow-hidden rounded-card border border-white/10 bg-white/[0.03] backdrop-blur-xl transition-all hover:border-[color:var(--cat)] hover:shadow-[0_0_34px_-14px_var(--cat)]"
    >
      <CoverArt color={c.color} label={c.label} className="h-40 w-full" />
      <div className="p-5">
        <CategoryBadge id={post.category} />
        <h3 className="mt-3 text-[17px] font-bold leading-snug tracking-tight text-textPrimary transition-colors">
          {post.title}
        </h3>
        <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-textSecondary">{post.excerpt}</p>
        <p className="mt-3 text-[11px] text-textMuted">
          {formatDate(post.date)} · {post.readMins} min read
        </p>
      </div>
    </Link>
  );
}
