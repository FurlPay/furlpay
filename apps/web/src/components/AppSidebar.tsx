"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronRight,
  Compass,
  FileText,
  Home,
  LineChart,
  Newspaper,
  PieChart,
  Receipt,
  Settings,
  Star,
} from "lucide-react";
import { useSession } from "@/components/auth/SessionProvider";

// ---------------------------------------------------------------------------
// The app's single desktop sidebar.
//
// There used to be two: this one and components/markets/DesktopNav, a flat
// six-tab strip (Home / Cards / Invest / Markets / Bills / Profile). Which one
// you saw depended on the route, so moving from /markets to /portfolio silently
// swapped the navigation out from under you — and after /investing was retired
// the flat strip still said "Invest". They are now one component.
//
// Navigation is grouped by task (MAIN / ACCOUNT) with the signed-in identity
// pinned to the bottom.
//
// Cards and Bills are NOT in this list — they remain in the mobile tab bar
// (components/BottomNav), which is where they were always reachable on a
// phone.
//
// Every destination here is a route that EXISTS. A sidebar that lists sections
// leading to a 404 is the fastest way to make a serious product feel like a
// mockup, so "Discover" points at the markets collections page rather than
// inventing a route for the sake of matching a label.
//
// No upgrade/plan card: this is a workstation for money the user already has,
// and a permanent sales panel in the navigation is the thing that makes a
// serious platform read as a consumer app.
// ---------------------------------------------------------------------------

const MAIN = [
  { href: "/dashboard", label: "Home", Icon: Home },
  { href: "/portfolio", label: "Portfolio", Icon: PieChart },
  { href: "/markets", label: "Markets", Icon: LineChart },
  { href: "/markets/collections/ai-robotics", label: "Discover", Icon: Compass },
  { href: "/markets?panel=watchlist", label: "Watchlist", Icon: Star },
  { href: "/investing/insights", label: "News & Insights", Icon: Newspaper },
] as const;

const ACCOUNT = [
  { href: "/dashboard/payments", label: "Merchant payments", Icon: Receipt },
  { href: "/transactions", label: "Transactions", Icon: Receipt },
  { href: "/spending", label: "Reports", Icon: FileText },
  { href: "/profile", label: "Settings", Icon: Settings },
] as const;

export default function AppSidebar() {
  const pathname = usePathname();
  const { user } = useSession();

  return (
    <aside className="sticky top-0 hidden h-screen w-[212px] shrink-0 flex-col border-r border-white/[0.06] bg-black/40 backdrop-blur-sm lg:flex">
      <Link
        href="/dashboard"
        className="flex items-center gap-2.5 px-5 py-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gain"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/furlpay-mark.svg" alt="" width={30} height={30} className="h-[30px] w-[30px] rounded-[7px]" />
        <span className="text-[15px] font-bold tracking-tight text-white">FurlPay</span>
      </Link>

      <nav className="flex flex-1 flex-col overflow-y-auto px-3 pb-3" aria-label="Portfolio">
        <Group label="Main" items={MAIN} pathname={pathname} />
        <Group label="Account" items={ACCOUNT} pathname={pathname} className="mt-5" />
      </nav>

      <Link
        href="/profile"
        className="flex items-center gap-2.5 border-t border-white/[0.06] px-4 py-3.5 transition-colors hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-gain"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-white/[0.08] text-[12px] font-bold text-white">
          {user?.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
          ) : (
            user?.initials || "—"
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-semibold text-white">
            {user?.name ?? "Your account"}
          </span>
          <span className="block truncate text-[10.5px] text-textSecondary">Premium account</span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-textMuted" aria-hidden />
      </Link>
    </aside>
  );
}

function Group({
  label,
  items,
  pathname,
  className = "",
}: {
  label: string;
  items: readonly { href: string; label: string; Icon: typeof Home }[];
  pathname: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="px-3 pb-1.5 pt-2 text-[10px] font-bold uppercase tracking-[0.14em] text-textMuted">
        {label}
      </p>
      <ul className="flex flex-col gap-0.5">
        {items.map(({ href, label: text, Icon }) => {
          const base = href.split("?")[0]!;
          const active = pathname === base;
          return (
            <li key={text}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-gain ${
                  active
                    ? "bg-white/[0.07] text-white"
                    : "text-textSecondary hover:bg-white/[0.05] hover:text-white"
                }`}
              >
                <Icon className="h-[17px] w-[17px] shrink-0" aria-hidden />
                <span className="truncate">{text}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
