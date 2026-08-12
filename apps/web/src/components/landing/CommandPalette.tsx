"use client";

/*
 * ⌘K / Ctrl-K command palette.
 *
 * Deliberately dependency-free: substring matching over PALETTE_LINKS, arrow
 * and Enter handling, focus restored to whatever opened it. A palette that
 * pulls in a search library would cost more bytes than the whole landing page
 * saves by not shipping an animation runtime.
 *
 * Accessibility: the dialog is a real modal (role=dialog, aria-modal), the
 * listbox/option roles are wired to aria-activedescendant, focus is trapped
 * inside while open, and Escape closes.
 */

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Search } from "lucide-react";
import { PALETTE_LINKS, type NavLink } from "./navigation";

export default function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return PALETTE_LINKS;
    return PALETTE_LINKS.filter(
      (l) => l.label.toLowerCase().includes(q) || l.desc?.toLowerCase().includes(q)
    );
  }, [query]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    if (!open) return;
    restoreFocus.current = document.activeElement as HTMLElement | null;
    setQuery("");
    setActive(0);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Focus after paint so the browser does not scroll the page to the input.
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      cancelAnimationFrame(raf);
      document.body.style.overflow = previousOverflow;
      restoreFocus.current?.focus?.();
    };
  }, [open]);

  const go = useCallback(
    (link: NavLink) => {
      onClose();
      if (link.external) {
        window.open(link.href, "_blank", "noopener,noreferrer");
        return;
      }
      router.push(link.href);
    },
    [onClose, router]
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (results.length ? (i + 1) % results.length : 0));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const link = results[active];
      if (link) go(link);
      return;
    }
    // Keep focus inside the dialog: the input and the close button are the only
    // tab stops, so Tab simply cycles between them.
    if (e.key === "Tab") {
      e.preventDefault();
    }
  };

  // Keep the highlighted row on screen when arrowing past the fold.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  return (
    <div
      aria-modal="true"
      aria-label="Search FurlPay"
      className="fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[12vh]"
      onKeyDown={onKeyDown}
      role="dialog"
    >
      <button
        aria-label="Close search"
        className="absolute inset-0 h-full w-full cursor-default bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        tabIndex={-1}
        type="button"
      />

      <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-white/10 bg-[#0a0a0c] shadow-2xl">
        <div className="flex items-center gap-3 border-b border-white/[0.07] px-4">
          <Search aria-hidden className="h-4 w-4 shrink-0 text-textMuted" />
          <input
            aria-activedescendant={results[active] ? `palette-option-${active}` : undefined}
            aria-autocomplete="list"
            aria-controls="palette-list"
            className="w-full bg-transparent py-4 text-[15px] text-white outline-none placeholder:text-textMuted"
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search docs, products, API…"
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            spellCheck={false}
            type="text"
            value={query}
          />
          <kbd className="hidden shrink-0 rounded border border-white/15 px-1.5 py-0.5 font-mono text-[10px] text-textMuted sm:block">
            ESC
          </kbd>
        </div>

        <div className="max-h-[52vh] overflow-y-auto p-2" id="palette-list" ref={listRef} role="listbox">
          {results.length === 0 ? (
            <p className="px-3 py-8 text-center text-[13px] text-textMuted">
              Nothing matches “{query}”.
            </p>
          ) : (
            results.map((link, i) => (
              <button
                aria-selected={i === active}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                  i === active ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"
                }`}
                data-index={i}
                id={`palette-option-${i}`}
                key={`${link.href}-${link.label}`}
                onClick={() => go(link)}
                onPointerMove={() => setActive(i)}
                role="option"
                tabIndex={-1}
                type="button"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold text-white">{link.label}</span>
                  {link.desc && (
                    <span className="block truncate text-[12px] text-textSecondary">{link.desc}</span>
                  )}
                </span>
                <ArrowRight
                  aria-hidden
                  className={`h-4 w-4 shrink-0 ${i === active ? "text-neon" : "text-textMuted"}`}
                />
              </button>
            ))
          )}
        </div>

        <div className="flex items-center gap-4 border-t border-white/[0.07] px-4 py-2.5 font-mono text-[11px] text-textMuted">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
