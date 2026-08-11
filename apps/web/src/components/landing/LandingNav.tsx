"use client";

/*
 * Sticky landing navigation.
 *
 * Three behaviours the old header did not have:
 *   1. It is transparent over the hero and only fades in its blurred backdrop
 *      after ~24px of scroll, so the hero reads as full-bleed.
 *   2. Grouped dropdowns (Products / Developers / Solutions / Resources /
 *      Company) instead of six flat links, driven by navigation.ts.
 *   3. Real keyboard support — Escape closes, Tab out closes, arrow-free but
 *      fully reachable, and the mobile menu traps nothing it should not.
 *
 * Scroll state is read with a passive listener writing a boolean; the visual
 * change is pure CSS so scrolling never triggers React work per frame.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Menu, Search, X } from "lucide-react";
import { NAV_GROUPS } from "./navigation";

export default function LandingNav({ onOpenPalette }: { onOpenPalette: () => void }) {
  const [scrolled, setScrolled] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Escape closes whatever is open; a click outside closes the dropdowns.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpenGroup(null);
      setMobileOpen(false);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (navRef.current?.contains(e.target as Node)) return;
      setOpenGroup(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  // The mobile sheet is full-height; letting the page scroll behind it is the
  // classic iOS scroll-chaining bug.
  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileOpen]);

  // Hover-intent: closing on pointerleave immediately makes the gap between
  // the trigger and the panel unusable.
  const openNow = useCallback((label: string) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpenGroup(label);
  }, []);
  const closeSoon = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpenGroup(null), 140);
  }, []);

  return (
    <header
      ref={navRef}
      className={`sticky top-0 z-50 transition-colors duration-300 ${
        scrolled
          ? "border-b border-white/[0.07] bg-black/72 backdrop-blur-xl"
          : "border-b border-transparent bg-transparent"
      }`}
    >
      <div className="section flex h-16 items-center justify-between gap-4">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- 24KB static brand mark, fixed size */}
          <img src="/icon.png" alt="" aria-hidden="true" width={28} height={28} className="h-7 w-7 rounded-lg" />
          <span className="text-[19px] font-extrabold tracking-tighter">FurlPay</span>
        </Link>

        {/* ── Desktop groups ─────────────────────────────────────────── */}
        <nav aria-label="Main" className="hidden lg:flex lg:items-center lg:gap-1">
          {NAV_GROUPS.map((group) => (
            <div
              key={group.label}
              className="relative"
              // Mouse only. On a touch screen `pointerenter` fires immediately
              // before `click`, so hover-to-open would open the panel and the
              // click would then toggle it straight back shut.
              onPointerEnter={(e) => {
                if (e.pointerType === "mouse") openNow(group.label);
              }}
              onPointerLeave={(e) => {
                if (e.pointerType === "mouse") closeSoon();
              }}
            >
              <button
                aria-expanded={openGroup === group.label}
                aria-haspopup="true"
                className="flex items-center gap-1 rounded-lg px-3 py-2 text-[14px] text-textSecondary transition-colors hover:text-white"
                onClick={() => setOpenGroup((cur) => (cur === group.label ? null : group.label))}
                type="button"
              >
                {group.label}
                <ChevronDown
                  aria-hidden
                  className={`h-3.5 w-3.5 transition-transform duration-200 ${
                    openGroup === group.label ? "rotate-180" : ""
                  }`}
                />
              </button>

              {openGroup === group.label && (
                <div
                  className="absolute left-0 top-full w-[320px] pt-2"
                  onFocus={() => openNow(group.label)}
                  onBlur={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpenGroup(null);
                  }}
                >
                  <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0a0a0c]/95 p-2 shadow-2xl backdrop-blur-xl">
                    {group.links.map((link) => (
                      <Link
                        key={link.href}
                        href={link.href}
                        className="block rounded-xl px-3 py-2.5 transition-colors hover:bg-white/[0.05]"
                        onClick={() => setOpenGroup(null)}
                      >
                        <span className="block text-[13.5px] font-semibold text-white">{link.label}</span>
                        {link.desc && (
                          <span className="mt-0.5 block text-[12px] text-textSecondary">{link.desc}</span>
                        )}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}

          <Link href="/pricing" className="rounded-lg px-3 py-2 text-[14px] text-textSecondary transition-colors hover:text-white">
            Pricing
          </Link>
          <Link href="/docs" className="rounded-lg px-3 py-2 text-[14px] text-textSecondary transition-colors hover:text-white">
            Docs
          </Link>
        </nav>

        {/* ── Actions ────────────────────────────────────────────────── */}
        <div className="flex shrink-0 items-center gap-2">
          <button
            aria-label="Search — press Command or Control plus K"
            className="hidden items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[12px] text-textMuted transition-colors hover:border-white/20 hover:text-white md:flex"
            onClick={onOpenPalette}
            type="button"
          >
            <Search aria-hidden className="h-3.5 w-3.5" />
            <kbd className="font-mono text-[11px]">⌘K</kbd>
          </button>

          <Link
            href="/developer/keys"
            className="btn-green hidden px-4 py-2 text-[14px] sm:inline-flex sm:items-center"
          >
            Get API key
          </Link>

          <button
            aria-controls="mobile-menu"
            aria-expanded={mobileOpen}
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            className="rounded-lg border border-white/10 p-2.5 text-white transition-colors hover:border-white/25 lg:hidden"
            onClick={() => setMobileOpen((v) => !v)}
            type="button"
          >
            {mobileOpen ? <X aria-hidden className="h-5 w-5" /> : <Menu aria-hidden className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* ── Mobile sheet ─────────────────────────────────────────────── */}
      {mobileOpen && (
        <div
          id="mobile-menu"
          className="max-h-[calc(100svh-4rem)] overflow-y-auto border-t border-white/[0.07] bg-black/95 backdrop-blur-xl lg:hidden"
        >
          <div className="section space-y-6 py-6">
            {NAV_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="section-eyebrow mb-2 text-textMuted">{group.label}</p>
                <div className="grid gap-1">
                  {group.links.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      className="rounded-lg px-2 py-2.5 text-[15px] text-white transition-colors hover:bg-white/5"
                      onClick={() => setMobileOpen(false)}
                    >
                      {link.label}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
            <div className="grid gap-2 border-t border-white/10 pt-5">
              <Link href="/pricing" className="rounded-lg px-2 py-2 text-[15px]" onClick={() => setMobileOpen(false)}>
                Pricing
              </Link>
              <Link href="/docs" className="rounded-lg px-2 py-2 text-[15px]" onClick={() => setMobileOpen(false)}>
                Docs
              </Link>
              <Link
                href="/developer/keys"
                className="btn-green mt-2 px-5 py-3 text-center text-[15px]"
                onClick={() => setMobileOpen(false)}
              >
                Get API key
              </Link>
              <Link
                href="/talk-to-us"
                className="btn-outline px-5 py-3 text-center text-[15px]"
                onClick={() => setMobileOpen(false)}
              >
                Talk to engineering
              </Link>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
