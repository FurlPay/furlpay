"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BillIcon, CardIcon, HomeIcon, InvestIcon, UserIcon } from "./icons";

const TABS = [
  { href: "/dashboard", label: "Home", Icon: HomeIcon },
  { href: "/cards", label: "Cards", Icon: CardIcon },
  { href: "/portfolio", label: "Portfolio", Icon: InvestIcon },
  { href: "/bills", label: "Bills", Icon: BillIcon },
  { href: "/profile", label: "Profile", Icon: UserIcon },
];

// Routes that render without the app chrome (marketing + auth).
const CHROME_LESS = ["/", "/login", "/signup"];

export default function BottomNav() {
  const pathname = usePathname();
  if (CHROME_LESS.includes(pathname)) return null;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-[440px]">
      {/* Fade the screen content out behind the floating bar. */}
      <div className="pointer-events-none h-8 bg-gradient-to-t from-black to-transparent" />
      <div className="mx-3 mb-5 flex items-center justify-around rounded-capsule border border-white/[0.07] bg-black/70 px-2 py-2 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.9)] backdrop-blur-2xl">
        {TABS.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              aria-label={label}
              className={`tap flex flex-col items-center gap-1 rounded-2xl px-3.5 py-1.5 transition-colors ${
                active ? "text-accent" : "text-textSecondary hover:text-white"
              }`}
            >
              <span
                className={`flex h-9 w-9 items-center justify-center rounded-xl transition-all ${
                  active
                    ? "bg-accent/15 shadow-[inset_0_0_0_1px_rgba(255,59,48,0.3)]"
                    : ""
                }`}
              >
                <Icon className="h-[22px] w-[22px]" />
              </span>
              <span className={`text-[10px] font-semibold tracking-tight ${active ? "opacity-100" : "opacity-70"}`}>
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
