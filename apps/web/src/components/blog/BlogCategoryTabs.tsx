"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CATEGORIES } from "@/lib/blog/categories";

// [All] + category pills. Highlights the active track based on the route and
// hides itself on individual article pages (/blog/<slug>).
export default function BlogCategoryTabs() {
  const pathname = usePathname();
  const parts = pathname.split("/").filter(Boolean); // e.g. ["blog","category","engineering"]

  const isArticle = parts.length === 2 && parts[0] === "blog" && parts[1] !== "category";
  if (isArticle) return null;

  const active = parts[1] === "category" ? parts[2] : "all";

  const tab = (id: string, label: string, href: string, color?: string) => {
    const isActive = active === id;
    return (
      <Link
        key={id}
        href={href}
        style={isActive && color ? { color, borderColor: color, backgroundColor: `${color}1A` } : undefined}
        className={`rounded-full border px-3.5 py-1.5 text-[12px] font-semibold transition-colors ${
          isActive
            ? color
              ? ""
              : "border-neon bg-neonSoft text-neon"
            : "border-white/10 text-textSecondary hover:border-white/30 hover:text-white"
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {tab("all", "All", "/blog")}
      {CATEGORIES.map((c) => tab(c.id, c.label, `/blog/category/${c.id}`, c.color))}
    </div>
  );
}
