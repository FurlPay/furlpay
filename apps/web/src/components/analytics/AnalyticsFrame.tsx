"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  BarChart3,
  BookOpen,
  CircleDollarSign,
  CreditCard,
  Filter,
  Globe,
  HeartPulse,
  LayoutGrid,
  LifeBuoy,
  Menu,
  MessagesSquare,
  Landmark,
  Package,
  Search,
  Ticket,
  Users,
  X,
} from "lucide-react";
import { FurlPayMark } from "@/components/trips/FurlPayLogo";
import { AccountMenu } from "@/components/support/SupportChrome";
import { useDashboard, type DashboardQuery } from "./useDashboard";
import { relTime } from "./format";

// ---------------------------------------------------------------------------
// The /analytics chrome: top navbar, sidebar, and ONE shared poller.
//
// The provider lives in the layout, so moving between Overview, Users,
// Transactions… keeps the same 15-second poll and the same filters instead of
// starting a new one per page. Filters are mirrored into the URL (?range=…
// &product=…) so a view is shareable and survives a reload.
// ---------------------------------------------------------------------------

type Ctx = ReturnType<typeof useDashboard> & {
  query: DashboardQuery;
  setQuery: (q: Partial<DashboardQuery>) => void;
};
const AnalyticsContext = createContext<Ctx | null>(null);
export function useAnalytics(): Ctx {
  const c = useContext(AnalyticsContext);
  if (!c) throw new Error("useAnalytics outside AnalyticsFrame");
  return c;
}

const RANGES = new Set(["24h", "7d", "30d", "90d", "custom"]);

function queryFromUrl(): DashboardQuery {
  const sp = new URLSearchParams(window.location.search);
  const range = sp.get("range");
  return {
    range: (range && RANGES.has(range) ? range : "24h") as DashboardQuery["range"],
    product: sp.get("product") ?? "all",
    from: sp.get("from") ?? undefined,
    to: sp.get("to") ?? undefined,
  };
}

const TOP_NAV = [
  { label: "Home", href: "/support" },
  { label: "Analytics", href: "/analytics" },
  { label: "Tickets", href: "/support/tickets" },
  { label: "Knowledge Base", href: "/docs/help" },
  { label: "Community", href: "/community" },
  { label: "Status", href: "/status" },
] as const;

export const SECTIONS = [
  { label: "Overview", href: "/analytics", Icon: BarChart3 },
  { label: "Users", href: "/analytics/users", Icon: Users },
  { label: "Transactions", href: "/analytics/transactions", Icon: CreditCard },
  { label: "Revenue", href: "/analytics/revenue", Icon: CircleDollarSign },
  { label: "Products", href: "/analytics/products", Icon: Package },
  { label: "Funnels", href: "/analytics/funnels", Icon: Filter },
  { label: "Geography", href: "/analytics/geography", Icon: Globe },
  { label: "Tokenized Assets", href: "/analytics/rwa", Icon: Landmark },
  { label: "Realtime", href: "/analytics/realtime", Icon: Activity },
  { label: "System Health", href: "/analytics/system-health", Icon: HeartPulse },
] as const;

const SUPPORT = [
  { label: "Support Tickets", href: "/support/tickets", Icon: Ticket },
  { label: "Knowledge Base", href: "/docs/help", Icon: BookOpen },
  { label: "Community", href: "/community", Icon: MessagesSquare },
  { label: "System Status", href: "/status", Icon: LifeBuoy },
] as const;

export default function AnalyticsFrame({ children }: { children: ReactNode }) {
  // Defaults on the server and first client render (no hydration mismatch);
  // the URL is read once after mount, and polling waits for it.
  const [query, setQueryState] = useState<DashboardQuery>({ range: "24h", product: "all" });
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setQueryState(queryFromUrl());
    setHydrated(true);
  }, []);
  const dash = useDashboard(query, hydrated);
  const pathname = usePathname();
  const router = useRouter();
  const [drawer, setDrawer] = useState(false);

  const setQuery = (q: Partial<DashboardQuery>) => setQueryState((prev) => ({ ...prev, ...q }));

  // Mirror filters into the URL without a navigation.
  useEffect(() => {
    if (!hydrated) return;
    const sp = new URLSearchParams();
    if (query.range !== "24h") sp.set("range", query.range);
    if (query.product !== "all") sp.set("product", query.product);
    if (query.range === "custom" && query.from && query.to) {
      sp.set("from", query.from);
      sp.set("to", query.to);
    }
    const qs = sp.toString();
    window.history.replaceState(null, "", `${pathname}${qs ? `?${qs}` : ""}`);
  }, [query, pathname, hydrated]);

  useEffect(() => setDrawer(false), [pathname]);

  const value = useMemo(() => ({ ...dash, query, setQuery }), [dash, query]);

  return (
    <AnalyticsContext.Provider value={value}>
      <div className="min-h-screen bg-[#070A09] text-white">
        <TopBar onMenu={() => setDrawer(true)} onSearch={(q) => router.push(`/analytics/realtime?q=${encodeURIComponent(q)}`)} />
        <div className="mx-auto flex max-w-[1680px]">
          <Sidebar className="sticky top-[60px] hidden h-[calc(100vh-60px)] w-[200px] shrink-0 overflow-y-auto border-r border-white/[0.06] lg:block" />
          {drawer && (
            <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Analytics navigation">
              <button aria-label="Close navigation" className="absolute inset-0 bg-black/70" onClick={() => setDrawer(false)} />
              <div className="absolute inset-y-0 left-0 w-[260px] border-r border-white/[0.08] bg-[#0A0E0C]">
                <div className="flex h-[60px] items-center justify-between px-4">
                  <span className="flex items-center gap-2 font-semibold">
                    <FurlPayMark size={22} /> Analytics
                  </span>
                  <button aria-label="Close navigation" onClick={() => setDrawer(false)} className="rounded-md p-1.5 text-textSecondary hover:text-white">
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <Sidebar />
              </div>
            </div>
          )}
          <main className="min-w-0 flex-1 px-4 pb-10 pt-5 sm:px-5">{children}</main>
        </div>
      </div>
    </AnalyticsContext.Provider>
  );
}

function TopBar({ onMenu, onSearch }: { onMenu: () => void; onSearch: (q: string) => void }) {
  const pathname = usePathname();
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");

  // ⌘K / Ctrl+K focuses search, as advertised by the hint in the field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="sticky top-0 z-40 h-[60px] border-b border-white/[0.07] bg-[#070A09]/95 backdrop-blur">
      <div className="mx-auto flex h-full max-w-[1680px] items-center gap-4 px-4 sm:px-5">
        <button onClick={onMenu} aria-label="Open navigation" className="rounded-md p-1.5 text-textSecondary hover:text-white lg:hidden">
          <Menu className="h-5 w-5" />
        </button>
        <Link href="/analytics" className="flex shrink-0 items-center gap-2.5">
          <FurlPayMark size={30} />
          <span className="text-[21px] font-semibold tracking-tight">FurlPay</span>
        </Link>
        <nav className="ml-6 hidden items-center gap-1 xl:flex" aria-label="Primary">
          {TOP_NAV.map((item) => {
            const active = item.href === "/analytics" ? pathname.startsWith("/analytics") : pathname === item.href;
            return (
              <Link
                key={item.label}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`relative rounded-lg px-3.5 py-2 text-[14px] transition-colors ${
                  active ? "bg-white/[0.06] font-semibold text-white" : "text-[#D3D7D5] hover:text-white"
                }`}
              >
                {item.label}
                {active && <span className="absolute inset-x-3 -bottom-[11px] h-[2px] rounded-full bg-neon" />}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <form
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              if (q.trim()) onSearch(q.trim());
            }}
            className="hidden items-center gap-2 rounded-xl border border-white/[0.1] bg-white/[0.03] px-3.5 py-2 focus-within:border-neon/60 md:flex"
          >
            <Search className="h-4 w-4 shrink-0 text-textSecondary" />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-[220px] bg-transparent text-[13.5px] placeholder:text-textSecondary focus:outline-none xl:w-[300px]"
              placeholder="Search users, events, transactions..."
              aria-label="Search users, events, transactions"
            />
            <kbd className="hidden shrink-0 rounded border border-white/10 px-1.5 py-0.5 text-[10.5px] text-textSecondary lg:block">⌘ K</kbd>
          </form>
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}

function Sidebar({ className = "" }: { className?: string }) {
  const pathname = usePathname();
  const { state, updatedAt } = useAnalytics();
  const item = (active: boolean) =>
    `flex items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2.5 text-[14px] transition-colors ${
      active ? "border border-neon/30 bg-neon/[0.08] font-medium text-neon" : "border border-transparent text-[#D3D7D5] hover:bg-white/[0.04] hover:text-white"
    }`;
  return (
    <nav className={`${className} px-3 py-4`} aria-label="Analytics sections">
      <ul className="space-y-1">
        {SECTIONS.map(({ label, href, Icon }) => {
          const active = href === "/analytics" ? pathname === "/analytics" : pathname.startsWith(href);
          return (
            <li key={href}>
              <Link href={href} className={item(active)} aria-current={active ? "page" : undefined}>
                <Icon className="h-[18px] w-[18px] shrink-0" /> {label}
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="mt-6 border-t border-white/[0.06] px-3 pb-2 pt-5 text-[11px] font-semibold uppercase tracking-wider text-textSecondary">
        Support
      </p>
      <ul className="space-y-1">
        {SUPPORT.map(({ label, href, Icon }) => (
          <li key={label}>
            <Link href={href} className={item(false)}>
              <Icon className="h-[18px] w-[18px] shrink-0" /> {label}
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-6 flex items-center gap-2 px-3 text-[12px] text-textSecondary">
        <LayoutGrid className="h-3.5 w-3.5" />
        {updatedAt ? `Updated ${relTime(updatedAt)}` : state === "offline" ? "Not updated" : "Loading…"}
      </div>
    </nav>
  );
}
