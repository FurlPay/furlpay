"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { searchDocs } from "@/lib/docs/search";

// AI-style fuzzy search for the docs portal. Renders a header trigger; opens a
// command-palette (Cmd/Ctrl+K) with live, keyboard-navigable results.
export default function DocsSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => searchDocs(query), [query]);

  // Global Cmd/Ctrl+K to open, Esc to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  useEffect(() => setActive(0), [query]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && results[active]) {
      e.preventDefault();
      go(results[active].href);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex w-full min-w-[220px] items-center gap-2.5 rounded-pill border border-white/10 bg-white/[0.03] px-4 py-2 text-left text-[13px] text-textSecondary transition-colors hover:border-neon/30 sm:w-[360px]"
      >
        <Search className="h-4 w-4" />
        <span className="flex-1">Search APIs, SDKs, or Roadmaps…</span>
        <kbd className="hidden rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] sm:inline">
          ⌘K
        </kbd>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-start justify-center bg-black/70 px-4 pt-[12vh] backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-xl overflow-hidden rounded-2xl border border-white/10 bg-[#0A0A0C] shadow-glow"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-white/8 px-4">
              <Search className="h-4 w-4 text-textSecondary" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onInputKey}
                placeholder="Search APIs, SDKs, or Roadmaps…"
                className="w-full bg-transparent py-4 text-[15px] text-white outline-none placeholder:text-textSecondary"
              />
              <kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-textSecondary">
                esc
              </kbd>
            </div>

            <div className="max-h-[52vh] overflow-y-auto p-2">
              {query && results.length === 0 && (
                <p className="px-3 py-6 text-center text-[13px] text-textSecondary">
                  No matches for “{query}”.
                </p>
              )}
              {!query && (
                <p className="px-3 py-6 text-center text-[13px] text-textSecondary">
                  Try <span className="text-neon">MiCA</span>, <span className="text-neon">2-of-2 MPC</span>,{" "}
                  <span className="text-neon">/api/investing/order</span> or <span className="text-neon">furlpay listen</span>.
                </p>
              )}
              {results.map((r, i) => (
                <button
                  key={r.href + r.title}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(r.href)}
                  className={`flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2.5 text-left transition-colors ${
                    i === active ? "bg-neonSoft" : "hover:bg-white/[0.03]"
                  }`}
                >
                  <div className="flex w-full items-center justify-between">
                    <span className="font-semibold text-white">{r.title}</span>
                    <span className="text-[11px] uppercase tracking-wider text-textSecondary">{r.section}</span>
                  </div>
                  <span className="text-[12px] text-textMuted">{r.snippet}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
