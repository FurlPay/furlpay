"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  Activity,
  Bell,
  ChevronDown,
  ChevronRight,
  FileText,
  LogOut,
  MessageSquare,
  Search,
  Settings,
  Ticket,
  User,
  Users,
} from "lucide-react";
import { FurlPayMark } from "@/components/trips/FurlPayLogo";

// ---------------------------------------------------------------------------
// Support portal chrome — navbar, hero, breadcrumb.
//
// Colour is deliberately constrained to the three the brand allows: near-black
// surfaces, white/grey text, and `neon` (#00E599) for every accent. The existing
// ticket page used amber and sky for status pills; those are gone, and status is
// carried by the neon dot plus the label instead. That costs one distinction —
// "waiting" and "open" no longer differ by hue — so the LABEL has to do that
// work, which is why the pills are worded rather than colour-coded.
// ---------------------------------------------------------------------------

const NAV = [
  { label: "Home", href: "/support" },
  { label: "Tickets", href: "/support/tickets" },
  { label: "Knowledge Base", href: "/docs/help" },
  { label: "Community", href: "/community" },
  { label: "Status", href: "/status" },
] as const;

export function SupportNavbar({ activeLabel }: { activeLabel?: string }) {
  const pathname = usePathname();
  const isActive = (item: (typeof NAV)[number]) =>
    activeLabel ? item.label === activeLabel : pathname === item.href;

  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.07] bg-[#0B0F0D]/95 backdrop-blur">
      <div className="mx-auto flex h-[62px] max-w-[1536px] items-center gap-6 px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <FurlPayMark className="h-7 w-7" />
          <span className="text-[19px] font-semibold tracking-tight text-white">FurlPay</span>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex">
          {NAV.map((item) => {
            const active = isActive(item);
            return (
              <Link
                key={item.label}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`relative px-3 py-[19px] text-[14px] transition-colors ${
                  active ? "text-white" : "text-textSecondary hover:text-white"
                }`}
              >
                {item.label}
                {/* The active underline is the only nav accent — see the colour
                    note at the top of this file. */}
                {active && (
                  <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-neon" />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <form
            role="search"
            className="hidden items-center gap-2 rounded-full border border-white/[0.09] bg-white/[0.04] px-4 py-2 transition-colors focus-within:border-neon/60 md:flex"
            onSubmit={(e) => e.preventDefault()}
          >
            <Search className="h-4 w-4 shrink-0 text-textSecondary" />
            <input
              className="w-[260px] bg-transparent text-[13.5px] text-white placeholder:text-textSecondary focus:outline-none xl:w-[300px]"
              placeholder="Search your tickets, topics, or ask AI..."
              aria-label="Search tickets, topics, or ask AI"
            />
            <kbd className="hidden shrink-0 rounded border border-white/10 px-1.5 py-0.5 text-[10.5px] text-textSecondary lg:block">
              ⌘ K
            </kbd>
          </form>

          <Link
            href="/support/new"
            className="rounded-full bg-neon px-5 py-2 text-[13.5px] font-semibold text-black transition-colors hover:bg-neonDeep"
          >
            Submit a ticket
          </Link>

          <AccountMenu />
        </div>
      </div>
    </header>
  );
}

const ACTIONS = [
  { icon: MessageSquare, title: "Submit a ticket", sub: "Get help from our team", href: "/support/new" },
  { icon: FileText, title: "Browse help center", sub: "Guides, docs and FAQs", href: "/docs/help" },
  { icon: Users, title: "Join community", sub: "Connect with other users", href: "/community" },
  { icon: Activity, title: "System status", sub: "Check live service updates", href: "/status" },
] as const;

export function SupportHero() {
  return (
    <section className="relative overflow-hidden border-b border-white/[0.07] bg-[#0B0F0D]">
      {/* The globe is decorative and sits behind the text at every width, so it
          is aria-hidden and never intercepts a pointer. */}
      <SupportGlobe />
      <div className="relative mx-auto max-w-[1536px] px-6 py-10">
        <h1 className="text-[44px] font-bold leading-[1.05] tracking-tight text-white sm:text-[52px]">
          FurlPay <span className="text-neon">Support Portal</span>
        </h1>
        <p className="mt-3 max-w-[640px] text-[15px] leading-relaxed text-[#C9CDCB]">
          Get help with payments, accounts, travel bookings, cards, trading, and developer tools.
          <br />
          Powered by AI. Built for you.
        </p>

        <div className="mt-7 grid max-w-[1000px] grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
          {ACTIONS.map(({ icon: Icon, title, sub, href }) => (
            <Link key={title} href={href} className="group flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-neon/45 text-neon transition-colors group-hover:border-neon group-hover:bg-neon/10">
                <Icon className="h-[19px] w-[19px]" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[14.5px] font-semibold text-white">{title}</span>
                <span className="block truncate text-[12.5px] text-textSecondary">{sub}</span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * The fintech globe.
 *
 * Drawn as inline SVG rather than shipped as an image: it is a handful of
 * ellipses and dots, so a raster would cost more bytes than the markup and blur
 * on a retina panel. Monochrome neon at low opacity, as specified — no gradient
 * mesh, no second hue.
 */
function SupportGlobe() {
  const orbits = [
    { rx: 210, ry: 78, rot: -18 },
    { rx: 180, ry: 120, rot: 24 },
    { rx: 225, ry: 46, rot: 8 },
  ];
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute right-0 top-0 hidden h-full w-[620px] select-none lg:block"
    >
      <svg viewBox="0 0 620 300" className="h-full w-full" fill="none">
        <defs>
          <radialGradient id="fp-globe" cx="50%" cy="50%">
            <stop offset="0%" stopColor="#00E599" stopOpacity="0.22" />
            <stop offset="70%" stopColor="#00E599" stopOpacity="0.05" />
            <stop offset="100%" stopColor="#00E599" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="330" cy="150" r="118" fill="url(#fp-globe)" />
        {/* Latitude/longitude suggestion — dotted so it reads as a wireframe
            globe without competing with the headline beside it. */}
        {[36, 72, 108].map((r) => (
          <ellipse
            key={r}
            cx="330"
            cy="150"
            rx={r}
            ry="112"
            stroke="#00E599"
            strokeOpacity="0.16"
            strokeWidth="1"
          />
        ))}
        {[-70, -35, 0, 35, 70].map((dy) => (
          <ellipse
            key={dy}
            cx="330"
            cy={150 + dy}
            rx={Math.sqrt(Math.max(0, 112 * 112 - dy * dy * 1.6)) * 0.95}
            ry="9"
            stroke="#00E599"
            strokeOpacity="0.13"
            strokeWidth="1"
          />
        ))}
        {orbits.map((o, i) => (
          <ellipse
            key={i}
            cx="330"
            cy="150"
            rx={o.rx}
            ry={o.ry}
            stroke="#00E599"
            strokeOpacity="0.3"
            strokeWidth="1"
            strokeDasharray="3 6"
            transform={`rotate(${o.rot} 330 150)`}
          />
        ))}
      </svg>
    </div>
  );
}

export function TicketBreadcrumb({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mx-auto max-w-[1536px] px-6 pb-1 pt-5">
      <ol className="flex items-center gap-2 text-[13px]">
        {items.map((item, i) => (
          <li key={item.label} className="flex items-center gap-2">
            {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-textSecondary" />}
            {item.href && i < items.length - 1 ? (
              <Link href={item.href} className="text-textSecondary transition-colors hover:text-white">
                {item.label}
              </Link>
            ) : (
              <span className="text-white">{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Account menu.
//
// The avatar was previously a `<button type="button">` with no handler — it
// looked interactive and did nothing. This is the working version.
//
// The user is read from GET /api/profile, which already returns { name, email,
// initials } for the authenticated session. Nothing is hardcoded: a signed-out
// visitor sees a Sign in link rather than a fabricated identity, and the initial
// in the avatar comes from the real name.
// ---------------------------------------------------------------------------

interface Me {
  name?: string;
  email?: string;
  initials?: string;
}

export function AccountMenu() {
  const [open, setOpen] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [loaded, setLoaded] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLAnchorElement>(null);

  // Fetched once on mount rather than on open, so the avatar shows the right
  // initial immediately instead of flashing a placeholder when clicked.
  useEffect(() => {
    const ac = new AbortController();
    void (async () => {
      try {
        const res = await fetch("/api/profile", { signal: ac.signal });
        if (res.ok) setMe((await res.json()) as Me);
      } catch {
        /* signed out, or offline — handled by the `me` null branch below */
      } finally {
        if (!ac.signal.aborted) setLoaded(true);
      }
    })();
    return () => ac.abort();
  }, []);

  // Close on outside click and on Escape. Both listeners are attached only
  // while the menu is open, so a closed menu costs nothing.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    // Move focus into the menu so a keyboard user is not stranded on the trigger.
    firstItemRef.current?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const initial = (me?.initials || me?.name || me?.email || "?").charAt(0).toUpperCase();
  const item =
    "flex items-center gap-2.5 px-3.5 py-2 text-[13px] text-white transition-colors hover:bg-neon/[0.08] focus:bg-neon/[0.08] focus:outline-none";

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex items-center gap-1 rounded-full pl-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-neon"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-neon text-[13px] font-semibold text-black">
          {initial}
        </span>
        <ChevronDown className={`h-4 w-4 text-textSecondary transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        // Absolute inside a relative wrapper, and the header is `sticky z-40`
        // with no `overflow-hidden`, so the panel is not clipped. z-50 keeps it
        // above the sticky header itself.
        <div
          role="menu"
          aria-label="Account"
          className="absolute right-0 top-[calc(100%+10px)] z-50 w-[248px] overflow-hidden rounded-xl border border-white/[0.09] bg-[#101512] py-1.5 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.8)]"
        >
          <div className="flex items-center gap-2.5 border-b border-white/[0.07] px-3.5 pb-3 pt-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neon text-[14px] font-semibold text-black">
              {initial}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13.5px] font-semibold text-white">
                {me?.name ?? (loaded ? "Not signed in" : "Loading…")}
              </span>
              {me?.email && <span className="block truncate text-[12px] text-textSecondary">{me.email}</span>}
            </span>
          </div>

          {me ? (
            <>
              <div className="py-1">
                <Link ref={firstItemRef} href="/profile" role="menuitem" className={item} onClick={() => setOpen(false)}>
                  <User className="h-4 w-4 text-neon" /> My profile
                </Link>
                <Link href="/support/tickets" role="menuitem" className={item} onClick={() => setOpen(false)}>
                  <Ticket className="h-4 w-4 text-neon" /> My tickets
                </Link>
                <Link href="/profile" role="menuitem" className={item} onClick={() => setOpen(false)}>
                  <Settings className="h-4 w-4 text-neon" /> Account settings
                </Link>
                <Link href="/profile" role="menuitem" className={item} onClick={() => setOpen(false)}>
                  <Bell className="h-4 w-4 text-neon" /> Notifications
                </Link>
              </div>
              <div className="border-t border-white/[0.07] pt-1">
                <Link href="/api/auth/logout" role="menuitem" className={item}>
                  <LogOut className="h-4 w-4 text-neon" /> Sign out
                </Link>
              </div>
            </>
          ) : (
            <div className="py-1">
              <Link ref={firstItemRef} href="/login" role="menuitem" className={item} onClick={() => setOpen(false)}>
                <User className="h-4 w-4 text-neon" /> Sign in
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
