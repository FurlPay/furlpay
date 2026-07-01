"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { POSTS, formatDate } from "@/lib/blog/posts";
import { categoryById } from "@/lib/blog/categories";

// Lightweight blog search: filters posts by title, excerpt or category label
// and shows a live results dropdown.
export default function BlogSearch() {
  const [q, setQ] = useState("");
  const [focused, setFocused] = useState(false);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return POSTS.filter((p) => {
      const cat = categoryById(p.category)?.label.toLowerCase() ?? "";
      return (
        p.title.toLowerCase().includes(s) ||
        p.excerpt.toLowerCase().includes(s) ||
        cat.includes(s)
      );
    }).slice(0, 6);
  }, [q]);

  const open = focused && q.trim().length > 0;

  return (
    <div className="relative w-full sm:w-[300px]">
      <div className="flex items-center gap-2.5 rounded-pill border border-white/10 bg-white/[0.03] px-3.5 py-2 text-textSecondary focus-within:border-neon/30">
        <Search className="h-4 w-4" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder="Search the blog…"
          className="w-full bg-transparent text-[13px] text-white outline-none placeholder:text-textSecondary"
        />
      </div>

      {open && (
        <div className="absolute z-50 mt-2 w-full overflow-hidden rounded-2xl border border-white/10 bg-[#0A0A0C] shadow-glow">
          {results.length === 0 ? (
            <p className="px-4 py-5 text-center text-[13px] text-textSecondary">
              No stories for “{q}”.
            </p>
          ) : (
            <div className="p-2">
              {results.map((p) => {
                const c = categoryById(p.category);
                return (
                  <Link
                    key={p.slug}
                    href={`/blog/${p.slug}`}
                    className="flex flex-col gap-0.5 rounded-lg px-3 py-2.5 transition-colors hover:bg-white/[0.04]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[13px] font-semibold text-white">{p.title}</span>
                    </div>
                    <span className="text-[11px] text-textMuted">
                      {c?.label} · {formatDate(p.date)}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
