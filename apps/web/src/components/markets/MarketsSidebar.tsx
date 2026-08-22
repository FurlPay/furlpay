"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircleHelp, LineChart, Settings, Star } from "lucide-react";
import { BillIcon, CardIcon, HomeIcon, InvestIcon, UserIcon } from "@/components/icons";

// ---------------------------------------------------------------------------
// The persistent rail on /markets.
//
// This is DesktopNav grown up rather than a second navigation: same six
// destinations, same icon set from components/icons.tsx, same routes the phone
// tab bar uses. What is added below the divider is not new navigation — the
// watchlist is a filter on this page, and settings and help are existing
// routes — so the rail still answers "where can I go" with one list.
//
// Deliberately NOT the /dashboard/terminal Sidebar, which carries ten
// destinations in the blue `term` palette. Two rails with different contents on
// two market surfaces reads as two products.
// ---------------------------------------------------------------------------

const PRIMARY = [
  { href: "/dashboard", label: "Home", Icon: HomeIcon },
  { href: "/cards", label: "Cards", Icon: CardIcon },
  { href: "/investing", label: "Invest", Icon: InvestIcon },
  { href: "/markets", label: "Markets", Icon: LineChart },
  { href: "/bills", label: "Bills", Icon: BillIcon },
  { href: "/profile", label: "Profile", Icon: UserIcon },
];

export default function MarketsSidebar({
  watchlistCount,
  onWatchlist,
  watchlistActive = false,
}: {
  /** Real count from the user's stored watchlist. Undefined while unknown —
   *  a "0" badge on a list that simply has not loaded is a false statement. */
  watchlistCount?: number;
  /** Switches the table to the Watchlist tab instead of navigating away. */
  onWatchlist?: () => void;
  watchlistActive?: boolean;
}) {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-screen w-[188px] shrink-0 flex-col border-r border-white/[0.06] bg-black/40 backdrop-blur-sm xl:flex">
      <Link
        href="/dashboard"
        className="flex items-center gap-2.5 px-4 py-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mkt-cyan"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/furlpay-mark.svg" alt="" width={28} height={28} className="h-7 w-7 rounded-[7px]" />
        <span className="text-[14px] font-bold tracking-tight text-white">FurlPay</span>
      </Link>

      <nav className="flex flex-1 flex-col gap-0.5 px-2.5" aria-label="Primary">
        {PRIMARY.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mkt-cyan ${
                active
                  ? "bg-mkt-cyan/[0.12] text-mkt-cyan"
                  : "text-white/55 hover:bg-white/[0.05] hover:text-white"
              }`}
            >
              {/* The active marker is a rail, not a dot: at this width a dot on
                  the right edge collides with the label of a long destination. */}
              {active && (
                <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-mkt-cyan" />
              )}
              <Icon className="h-[18px] w-[18px] shrink-0" />
              <span className="truncate">{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-0.5 border-t border-white/[0.06] px-2.5 py-2.5">
        <button
          type="button"
          onClick={onWatchlist}
          aria-pressed={watchlistActive}
          className={`flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mkt-cyan ${
            watchlistActive ? "bg-white/[0.06] text-white" : "text-white/50 hover:bg-white/[0.05] hover:text-white"
          }`}
        >
          <Star className="h-[17px] w-[17px] shrink-0" />
          <span className="truncate">Watchlist</span>
          {watchlistCount !== undefined && watchlistCount > 0 && (
            <span className="ml-auto rounded-full bg-white/10 px-1.5 py-0.5 text-[10.5px] font-bold mkt-num">
              {watchlistCount}
            </span>
          )}
        </button>

        {[
          { href: "/profile", label: "Settings", Icon: Settings },
          { href: "/support", label: "Help", Icon: CircleHelp },
        ].map(({ href, label, Icon }) => (
          <Link
            key={label}
            href={href}
            className="flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-semibold text-white/50 transition-colors hover:bg-white/[0.05] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mkt-cyan"
          >
            <Icon className="h-[17px] w-[17px] shrink-0" />
            <span className="truncate">{label}</span>
          </Link>
        ))}
      </div>

      {/* Promotional card. Every claim on it is one FurlPay actually supports:
          stablecoin-funded investing across stocks, ETFs and crypto. No APY, no
          "zero fees" — those are product claims this rail cannot verify. */}
      <div className="mx-2.5 mb-4 overflow-hidden rounded-2xl border border-white/[0.07] bg-gradient-to-br from-mkt-violet/25 via-mkt-cyan/10 to-transparent p-3.5">
        <p className="text-[12.5px] font-bold leading-tight text-white">
          Invest smarter
          <br />
          with FurlPay
        </p>
        <p className="mt-1.5 text-[10.5px] leading-snug text-white/55">
          Trade and grow globally with stablecoins.
        </p>
        <Link
          href="/investing"
          className="mt-2.5 inline-flex items-center rounded-lg bg-mkt-cyan px-2.5 py-1.5 text-[11px] font-bold text-[#04202a] transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mkt-cyan"
        >
          Explore
        </Link>
      </div>
    </aside>
  );
}
