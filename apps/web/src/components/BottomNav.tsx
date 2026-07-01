"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BillIcon, CardIcon, HomeIcon, InvestIcon, UserIcon } from "./icons";

const TABS = [
  { href: "/dashboard", label: "Home", Icon: HomeIcon },
  { href: "/cards", label: "Cards", Icon: CardIcon },
  { href: "/investing", label: "Invest", Icon: InvestIcon },
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
      <div className="mx-3 mb-3 flex items-center justify-around rounded-capsule border border-white/5 bg-black/85 px-1.5 py-2 backdrop-blur-xl">
        {TABS.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2 rounded-capsule px-3 py-2 transition-colors ${
                active ? "bg-white/[0.06] text-accent" : "text-textSecondary"
              }`}
            >
              <Icon className="h-6 w-6" />
              <span className={`text-[12px] font-medium ${active ? "block" : "hidden"}`}>
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
