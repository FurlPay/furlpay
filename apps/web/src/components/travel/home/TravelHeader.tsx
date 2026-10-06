"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, Menu, Search, X } from "lucide-react";

// Travels portal header. Matches the reference: logo + "Travels", one row of
// section links, then search / currency / wallet / avatar on the right.
//
// The wallet pill and avatar are the SIGNED-IN user's real data
// (/api/wallets, /api/profile). Signed out, the pill is a sign-in link — the
// reference's "2,460 USDC" is never shown as a number nobody holds.

const NAV: Array<{ href: string; label: string; match?: (p: string) => boolean }> = [
  { href: "/travel/destinations", label: "Explore" },
  { href: "/travel/stays", label: "Stays", match: (p) => p.startsWith("/travel/stays") || p.startsWith("/travel/hotels") },
  { href: "/travel/flights", label: "Flights" },
  { href: "/travel/car-rentals", label: "Cars" },
  { href: "/travel/activities", label: "Activities" },
  { href: "/travel/deals", label: "Deals" },
  { href: "/travel#ai-planner", label: "AI Planner", match: () => false },
  { href: "/travel/guides", label: "Guides" },
  { href: "/travel/my-trips", label: "My Trips" },
];

interface Me {
  initials: string;
  avatarUrl?: string | null;
  name?: string;
  usdc: number;
}

function useMe(): { me: Me | null; state: "loading" | "in" | "out" } {
  const [me, setMe] = useState<Me | null>(null);
  const [state, setState] = useState<"loading" | "in" | "out">("loading");
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const p = await fetch("/api/profile", { credentials: "same-origin" });
        if (!p.ok) throw new Error(String(p.status));
        const profile = (await p.json()) as { initials?: string; avatarUrl?: string | null; name?: string };
        let usdc = 0;
        const w = await fetch("/api/wallets", { credentials: "same-origin" });
        if (w.ok) {
          const d = (await w.json()) as { balances?: Array<{ token: string; amount: string }> };
          usdc = (d.balances ?? []).filter((b) => b.token === "USDC").reduce((s, b) => s + Number(b.amount || 0), 0);
        }
        if (live) {
          setMe({ initials: profile.initials ?? "•", avatarUrl: profile.avatarUrl, name: profile.name, usdc });
          setState("in");
        }
      } catch {
        if (live) setState("out");
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  return { me, state };
}

const CURRENCIES = [
  { code: "USD", note: "Prices are quoted in USD" },
  { code: "EUR", note: "Coming soon" },
  { code: "GBP", note: "Coming soon" },
  { code: "INR", note: "Coming soon" },
];

export default function TravelHeader() {
  const pathname = usePathname() ?? "/travel";
  const router = useRouter();
  const { me, state } = useMe();
  const [menuOpen, setMenuOpen] = useState(false);
  const [curOpen, setCurOpen] = useState(false);
  const curRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMenuOpen(false), [pathname]);
  useEffect(() => {
    if (!curOpen) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !curRef.current?.contains(e.target as Node)) setCurOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [curOpen]);
  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  /** On the homepage the search icon focuses the hero search; elsewhere it
   *  goes there. */
  function openSearch() {
    if (pathname === "/travel") {
      const el = document.getElementById("travel-where");
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      (el as HTMLInputElement | null)?.focus({ preventScroll: true });
    } else {
      router.push("/travel?focus=search");
    }
  }

  const active = (n: (typeof NAV)[number]) => (n.match ? n.match(pathname) : pathname.startsWith(n.href));
  const usdc = me ? me.usdc.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "";

  return (
    <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-[#030505]/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-6 px-4 sm:px-6 lg:px-10">
        <Link href="/travel" className="flex shrink-0 items-center gap-2 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-neon" aria-label="FurlPay Travels home">
          <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-neon shadow-[0_0_18px_-4px_rgba(0,229,153,0.6)]">
            <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] text-black" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden>
              <path d="M6 5h12M6 12h9M6 19h5" strokeLinecap="round" />
            </svg>
          </span>
          <span className="text-[19px] font-bold tracking-tight text-white">Furlpay</span>
          <span className="ml-1.5 text-[15px] font-semibold text-neon">Travels</span>
        </Link>

        <nav aria-label="Travel sections" className="hidden items-center gap-1 xl:flex">
          {NAV.map((n) => (
            <Link
              key={n.label}
              href={n.href}
              aria-current={active(n) ? "page" : undefined}
              className={`rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-neon ${
                active(n) ? "text-neon" : "text-white/75 hover:text-white"
              }`}
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={openSearch}
            aria-label="Search travel"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white transition hover:border-white/25 hover:bg-white/[0.08] focus-visible:outline focus-visible:outline-2 focus-visible:outline-neon"
          >
            <Search className="h-4 w-4" />
          </button>

          <div ref={curRef} className="relative hidden sm:block">
            <button
              type="button"
              aria-haspopup="listbox"
              aria-expanded={curOpen}
              onClick={() => setCurOpen((o) => !o)}
              className="flex h-9 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 text-[12px] font-semibold text-white transition hover:border-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-neon"
            >
              USD <ChevronDown className={`h-3.5 w-3.5 text-white/60 transition ${curOpen ? "rotate-180" : ""}`} />
            </button>
            {curOpen && (
              <ul role="listbox" aria-label="Display currency" className="absolute right-0 top-11 w-52 rounded-xl border border-white/10 bg-[#0B0F10] p-1.5 shadow-2xl">
                {CURRENCIES.map((c) => (
                  <li
                    key={c.code}
                    role="option"
                    aria-selected={c.code === "USD"}
                    aria-disabled={c.code !== "USD"}
                    className={`flex items-center justify-between rounded-lg px-3 py-2 text-[13px] ${c.code === "USD" ? "bg-white/[0.06] text-white" : "text-white/40"}`}
                  >
                    <span className="font-semibold">{c.code}</span>
                    <span className="text-[11px]">{c.note}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {state === "in" && me ? (
            <>
              <Link
                href="/wallet"
                className="hidden h-9 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] pl-1.5 pr-3 text-[12px] font-semibold text-white transition hover:border-neon/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-neon sm:flex"
                aria-label={`Wallet: ${usdc} USDC`}
              >
                <img src="/logos/coins/usdc.svg" alt="" className="h-6 w-6 rounded-full" />
                {usdc} USDC
              </Link>
              <Link href="/profile" aria-label={me.name ? `Account: ${me.name}` : "Account"} className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-neon/15 text-[12px] font-bold text-neon ring-1 ring-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-neon">
                {me.avatarUrl ? <img src={me.avatarUrl} alt="" className="h-full w-full object-cover" /> : me.initials}
              </Link>
            </>
          ) : state === "out" ? (
            <Link
              href={`/login?next=${encodeURIComponent(pathname)}`}
              className="flex h-9 items-center rounded-full bg-neon px-4 text-[12px] font-bold text-black transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
            >
              Sign in
            </Link>
          ) : (
            <span className="hidden h-9 w-32 animate-pulse rounded-full bg-white/[0.06] sm:block" aria-hidden />
          )}

          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            aria-expanded={menuOpen}
            aria-controls="travel-mobile-menu"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-white xl:hidden"
          >
            <Menu className="h-4 w-4" />
          </button>
        </div>
      </div>

      {menuOpen && (
        <div id="travel-mobile-menu" role="dialog" aria-modal="true" aria-label="Travel menu" className="fixed inset-0 z-[60] xl:hidden">
          <button className="absolute inset-0 bg-black/70" aria-label="Close menu" onClick={() => setMenuOpen(false)} />
          <nav className="absolute right-0 top-0 flex h-full w-[min(320px,85vw)] flex-col gap-1 border-l border-white/10 bg-[#070909] p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-white">FurlPay <span className="text-neon">Travels</span></span>
              <button onClick={() => setMenuOpen(false)} aria-label="Close menu" className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            {NAV.map((n) => (
              <Link
                key={n.label}
                href={n.href}
                onClick={() => setMenuOpen(false)}
                className={`flex min-h-[44px] items-center rounded-lg px-3 text-[15px] font-medium ${active(n) ? "bg-neon/10 text-neon" : "text-white/85 hover:bg-white/[0.05]"}`}
              >
                {n.label}
              </Link>
            ))}
            {state === "in" && me && (
              <Link href="/wallet" className="mt-auto flex min-h-[44px] items-center gap-2 rounded-lg border border-white/10 px-3 text-sm font-semibold text-white">
                <img src="/logos/coins/usdc.svg" alt="" className="h-5 w-5" /> {usdc} USDC
              </Link>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
