import Link from "next/link";
import { ChevronLeft, BookOpen, ArrowRight, Newspaper, Sparkles } from "lucide-react";
import { Pill } from "@/components/ui";
import { GUIDE_CATEGORY_ICONS } from "@/components/travel/guideIcons";
import { GUIDES, GUIDE_CATEGORIES } from "@/lib/travel/guides";
import { getSortedPosts, formatDate } from "@/lib/blog/posts";

export const metadata = {
  title: "Travel Guides — FurlPay Travels",
  description:
    "Destination guides, crypto payment tutorials, AI agent booking walkthroughs and packing checklists from the FurlPay Travels team.",
};

// Content hub: practical guides live here; deep-dive stories live on the blog
// under the "travel" category and are cross-linked below.
export default function GuidesPage({ searchParams }: { searchParams: { cat?: string } }) {
  const active = GUIDE_CATEGORIES.find((c) => c.id === searchParams.cat)?.id;
  const guides = active ? GUIDES.filter((g) => g.category === active) : GUIDES;
  const travelPosts = getSortedPosts().filter((p) => p.category === "travel").slice(0, 4);

  return (
    <div className="mx-auto max-w-6xl px-5 pb-24 pt-6">
      <Link href="/travel" className="mb-3 inline-flex items-center gap-1 text-sm text-textSecondary hover:text-white">
        <ChevronLeft className="h-4 w-4" /> Travel
      </Link>

      <div className="mb-3 flex items-center gap-2">
        <Pill tone="accent">Guides & tips</Pill>
      </div>
      <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-white">
        <BookOpen className="h-7 w-7 text-neon" /> Travel guides
      </h1>
      <p className="mt-2 max-w-xl text-sm text-textSecondary">
        Everything from packing checklists to letting your AI agent book the whole trip — written by people who pay
        for travel in USDC every week.
      </p>

      {/* Category chips */}
      <div className="mt-6 flex flex-wrap gap-2">
        <Link
          href="/travel/guides"
          className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold transition ${
            !active ? "bg-white text-black" : "bg-white/[0.06] text-textSecondary hover:bg-white/10"
          }`}
        >
          <Sparkles className="h-3.5 w-3.5" /> All
        </Link>
        {GUIDE_CATEGORIES.map((c) => {
          const Icon = GUIDE_CATEGORY_ICONS[c.id];
          return (
            <Link
              key={c.id}
              href={`/travel/guides?cat=${encodeURIComponent(c.id)}`}
              className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold transition ${
                active === c.id ? "bg-white text-black" : "bg-white/[0.06] text-textSecondary hover:bg-white/10"
              }`}
            >
              <Icon className="h-3.5 w-3.5" /> {c.id}
            </Link>
          );
        })}
      </div>

      {/* Guide cards */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {guides.map((g) => {
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
            <h2 className="mt-3 text-base font-bold leading-snug text-white">{g.title}</h2>
            <p className="mt-2 flex-1 text-xs leading-relaxed text-textSecondary">{g.excerpt}</p>
            <div className="mt-4 flex items-center justify-between text-[11px] text-textSecondary">
              <span>{g.readMins} min read</span>
              <ArrowRight className="h-4 w-4 text-neon transition group-hover:translate-x-1" />
            </div>
          </Link>
          );
        })}
      </div>
      {guides.length === 0 && (
        <p className="mt-12 text-center text-sm text-textSecondary">No guides in this category yet.</p>
      )}

      {/* From the blog */}
      {travelPosts.length > 0 && (
        <section className="mt-14">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-xl font-bold text-white">
              <Newspaper className="h-5 w-5 text-sky-400" /> Deep dives from the blog
            </h2>
            <Link href="/blog/category/travel" className="text-sm text-neon hover:underline">
              All travel stories →
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {travelPosts.map((p) => (
              <Link
                key={p.slug}
                href={`/blog/${p.slug}`}
                className="group rounded-card border border-white/10 bg-charcoal p-5 transition hover:border-[#32ADE6] hover:shadow-[0_0_32px_-14px_#32ADE6]"
              >
                <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ color: "#32ADE6", backgroundColor: "#32ADE61A" }}>
                  Travel
                </span>
                <h3 className="mt-3 text-sm font-bold leading-snug text-white">{p.title}</h3>
                <p className="mt-2 line-clamp-2 text-xs text-textSecondary">{p.excerpt}</p>
                <p className="mt-3 text-[11px] text-textSecondary">
                  {formatDate(p.date)} · {p.readMins} min read
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
