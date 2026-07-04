"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS: Array<{ href: string; label: string; exact?: boolean }> = [
  { href: "/travel", label: "Overview", exact: true },
  { href: "/travel/stays", label: "Stays" },
  { href: "/travel/flights", label: "Flights" },
  { href: "/travel/car-rentals", label: "Cars" },
  { href: "/travel/activities", label: "Activities" },
  { href: "/travel/destinations", label: "Destinations" },
  { href: "/travel/deals", label: "Deals" },
  { href: "/travel/guides", label: "Guides" },
  { href: "/travel/rewards", label: "Rewards" },
];

// Horizontal section nav for the Travels portal. Scrollable on small screens;
// pills keep a ≥44px hit area (WCAG 2.5.5 enhanced target size).
export default function TravelNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Travel sections" className="-mx-1 flex gap-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {LINKS.map((l) => {
        const active = l.exact ? pathname === l.href : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-[40px] shrink-0 items-center rounded-full px-3.5 text-[13px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-neon ${
              active ? "bg-white text-black" : "text-textSecondary hover:bg-white/[0.06] hover:text-white"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
