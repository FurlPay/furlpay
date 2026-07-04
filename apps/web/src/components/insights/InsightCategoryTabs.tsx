"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { INSIGHT_CATEGORIES } from "@/lib/insights/categories";

// [All] + research-track pills. Highlights the active track from the route and
// hides on individual article pages (/investing/insights/<slug>).
export default function InsightCategoryTabs() {
  const pathname = usePathname();
  const parts = pathname.split("/").filter(Boolean); // ["investing","insights",...]

  const isArticle = parts.length === 3 && parts[1] === "insights" && parts[2] !== "category";
  if (isArticle) return null;

  const active = parts[2] === "category" ? parts[3] : "all";

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
      {tab("all", "All", "/investing/insights")}
      {INSIGHT_CATEGORIES.map((c) => tab(c.id, c.label, `/investing/insights/category/${c.id}`, c.color))}
    </div>
  );
}
