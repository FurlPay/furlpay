"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LineChart } from "lucide-react";
import { BillIcon, CardIcon, HomeIcon, InvestIcon, UserIcon } from "@/components/icons";

// The five phone tabs, stood up as a desktop rail.
//
// Deliberately NOT the terminal's Sidebar. That one carries ten destinations in
// the blue `term` palette with a neon accent, which belongs to
// /dashboard/terminal; on a red-accented consumer surface it reads as a
// different product. This is the SAME navigation the phone shows — same routes,
// same icon set from components/icons.tsx — rotated to the vertical.
//
// Markets is listed because it is where the user currently is. A rail that
// cannot show its own page as active leaves the reader with no anchor.

const TABS = [
  { href: "/dashboard", label: "Home", Icon: HomeIcon },
  { href: "/cards", label: "Cards", Icon: CardIcon },
  { href: "/investing", label: "Invest", Icon: InvestIcon },
  { href: "/markets", label: "Markets", Icon: LineChart },
  { href: "/bills", label: "Bills", Icon: BillIcon },
  { href: "/profile", label: "Profile", Icon: UserIcon },
];

export default function DesktopNav() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-screen w-[212px] shrink-0 flex-col border-r border-white/[0.06] bg-black/40 backdrop-blur-sm lg:flex">
      <Link href="/dashboard" className="flex items-center gap-2.5 px-5 py-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/furlpay-mark.svg" alt="" width={30} height={30} className="h-[30px] w-[30px] rounded-[7px]" />
        <span className="text-[14px] font-bold tracking-tight text-textPrimary">FurlPay</span>
      </Link>

      <nav className="flex flex-1 flex-col gap-1 px-3 py-2" aria-label="Primary">
        {TABS.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] font-semibold transition-colors ${
                active
                  ? "bg-accent/[0.14] text-accent"
                  : "text-textSecondary hover:bg-white/[0.05] hover:text-textPrimary"
              }`}
            >
              <Icon className="h-[20px] w-[20px] shrink-0" />
              <span className="truncate">{label}</span>
              {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-accent" />}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
