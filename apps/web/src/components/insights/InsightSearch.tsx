"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { INSIGHTS } from "@/lib/insights/articles";
import { categoryById } from "@/lib/insights/categories";
import SignalBadge from "./SignalBadge";

// Client-side search across insight titles, excerpts and tickers with a
// dropdown results panel (mirrors BlogSearch).
export default function InsightSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (needle.length < 2) return [];
    return INSIGHTS.filter(
      (a) =>
        a.title.toLowerCase().includes(needle) ||
        a.excerpt.toLowerCase().includes(needle) ||
        a.tickers.some((t) => t.toLowerCase().includes(needle))
    ).slice(0, 6);
  }, [q]);

  return (
    <div ref={boxRef} className="relative">
      <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-2">
        <Search className="h-4 w-4 shrink-0 text-textMuted" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search insights, stocks, earnings…"
          className="w-[150px] bg-transparent text-[13px] outline-none placeholder:text-textMuted sm:w-[210px]"
        />
      </div>
      {open && results.length > 0 && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[340px] overflow-hidden rounded-2xl border border-white/10 bg-[#0c0c0f] shadow-2xl">
          {results.map((a) => {
            const c = categoryById(a.category);
            return (
              <button
                key={a.slug}
                onClick={() => {
                  setOpen(false);
                  setQ("");
                  router.push(`/investing/insights/${a.slug}`);
                }}
                className="flex w-full flex-col gap-1 border-b border-white/5 px-4 py-3 text-left last:border-0 hover:bg-white/[0.04]"
              >
                <div className="flex items-center gap-2">
                  <span className="rounded-full border px-2 py-0.5 text-[9.5px] font-semibold" style={{ color: c?.color, borderColor: c?.color }}>
                    {c?.label}
                  </span>
                  {a.signal && <SignalBadge signal={a.signal} compact />}
                </div>
                <span className="line-clamp-2 text-[13px] font-semibold leading-snug">{a.title}</span>
                <span className="font-mono text-[10px] text-textMuted">{a.tickers.slice(0, 5).join(" · ")}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
