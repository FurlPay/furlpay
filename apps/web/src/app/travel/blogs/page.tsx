import Link from "next/link";
import { Newspaper, ArrowRight, Clock, BookOpen } from "lucide-react";
import { Pill } from "@/components/ui";
import { GUIDE_CATEGORY_ICONS } from "@/components/travel/guideIcons";
import { getSortedPosts, formatDate } from "@/lib/blog/posts";
import { GUIDES } from "@/lib/travel/guides";

export const metadata = {
  title: "Travel Stories",
  description:
    "Deep-dive travel stories, engineering write-ups and practical guides from the FurlPay Travels team — agentic booking, stablecoin settlement and crypto travel.",
};

// Travel Stories hub — aggregates blog deep-dives (travel category) with the
// practical guides so every story is one click from a booking funnel.
export default function TravelBlogsPage() {
  const stories = getSortedPosts().filter((p) => p.category === "travel");
  const guides = [...GUIDES].sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <div className="mx-auto max-w-6xl px-5 pb-24 pt-8">
      <div className="mb-3 flex items-center gap-2">
        <Pill tone="accent">Travel stories</Pill>
      </div>
      <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-white">
        <Newspaper className="h-7 w-7 text-neon" /> Stories & deep dives
      </h1>
      <p className="mt-2 max-w-xl text-sm text-textSecondary">
        Long-form stories from the team building crypto travel — plus the practical guides to act on them. Every
        story links straight into a bookable trip.
      </p>

      {/* Deep dives (blog, travel category) */}
      <section className="mt-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">Deep dives</h2>
          <Link href="/blog/category/travel" className="text-sm text-neon hover:underline">
            View on the blog →
          </Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {stories.map((p) => (
            <Link
              key={p.slug}
              href={`/blog/${p.slug}`}
              className="group overflow-hidden rounded-card border border-white/10 bg-charcoal transition hover:border-[#32ADE6] hover:shadow-[0_0_32px_-14px_#32ADE6]"
            >
              {p.cover && (
                <div className="relative h-36 overflow-hidden">
                  <img
                    src={p.cover}
                    alt={p.title}
                    loading="lazy"
                    className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                </div>
              )}
              <div className="p-5">
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                  style={{ color: "#32ADE6", backgroundColor: "#32ADE61A" }}
                >
                  Travel
                </span>
                <h3 className="mt-3 text-base font-bold leading-snug text-white">{p.title}</h3>
                <p className="mt-2 line-clamp-2 text-xs text-textSecondary">{p.excerpt}</p>
                <p className="mt-3 flex items-center gap-1 text-[11px] text-textSecondary">
                  <Clock className="h-3 w-3" /> {formatDate(p.date)} · {p.readMins} min read
                </p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Guides */}
      <section className="mt-12">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-xl font-bold text-white">
            <BookOpen className="h-5 w-5 text-emerald-400" /> Practical guides
          </h2>
          <Link href="/travel/guides" className="text-sm text-neon hover:underline">
            All guides →
          </Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {guides.slice(0, 6).map((g) => {
            const Icon = GUIDE_CATEGORY_ICONS[g.category];
            return (
              <Link
                key={g.slug}
                href={`/travel/guides/${g.slug}`}
                className="group flex flex-col rounded-card border border-white/10 bg-charcoal p-5 transition hover:border-white/25 hover:shadow-glow-sm"
              >
                <div className="flex items-center justify-between">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-neon/10 text-neon">
                    <Icon className="h-[18px] w-[18px]" />
                  </span>
                  <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-semibold text-textSecondary">
                    {g.category}
                  </span>
                </div>
                <h3 className="mt-3 flex-1 text-sm font-bold leading-snug text-white">{g.title}</h3>
                <div className="mt-3 flex items-center justify-between text-[11px] text-textSecondary">
                  <span>{g.readMins} min read</span>
                  <ArrowRight className="h-4 w-4 text-neon transition group-hover:translate-x-1" />
                </div>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
