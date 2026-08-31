"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell, ChevronDown, Search } from "lucide-react";
import { useSession } from "@/components/auth/SessionProvider";

// ---------------------------------------------------------------------------
// The workstation header: view title, section tabs, command search, alerts.
//
// The search field does not implement its own search. It dispatches the
// `furlpay:search` event that components/CommandPalette.tsx already listens
// for, alongside its global ⌘K binding — so this is a second door onto the one
// palette rather than a second palette, and the shortcut hint it prints is the
// shortcut that actually works.
// ---------------------------------------------------------------------------

export const TABS = [
  { id: "overview", label: "Overview" },
  { id: "performance", label: "Performance" },
  { id: "analytics", label: "Analytics" },
  { id: "allocation", label: "Allocation" },
  { id: "activity", label: "Activity" },
  { id: "reports", label: "Reports" },
] as const;

export type TabId = (typeof TABS)[number]["id"];

export default function TopBar({
  tab,
  onTab,
  unread = 0,
  onDeposit,
}: {
  tab: TabId;
  onTab: (t: TabId) => void;
  unread?: number;
  /** Opens the wallet-connect + deposit modal. */
  onDeposit: () => void;
}) {
  const { user } = useSession();
  const [mac, setMac] = useState(false);

  // The modifier symbol is platform-dependent, and reading `navigator` during
  // render would disagree with the server. Resolved after mount instead.
  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
  }, []);

  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-oled/85 backdrop-blur-xl">
      <div className="flex items-center gap-3 px-5 pt-4 lg:px-7">
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-lg text-[19px] font-bold tracking-tight text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gain sm:text-[21px]"
          aria-label="Switch portfolio view"
        >
          Portfolio Overview
          <ChevronDown className="h-4 w-4 text-textSecondary" aria-hidden />
        </button>

        {/* Command search — the visible half of the ⌘K palette. */}
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("furlpay:search"))}
          className="ml-auto hidden h-9 min-w-0 max-w-[380px] flex-1 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-left transition-colors hover:border-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gain md:flex"
        >
          <Search className="h-3.5 w-3.5 shrink-0 text-textMuted" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-textMuted">
            Search markets, assets, reports…
          </span>
          <kbd className="shrink-0 rounded border border-white/10 bg-white/[0.05] px-1.5 py-0.5 font-sans text-[10px] font-semibold text-textMuted">
            {mac ? "⌘" : "Ctrl"}K
          </kbd>
        </button>

        <div className="ml-auto flex shrink-0 items-center gap-2 md:ml-0">
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event("furlpay:search"))}
            aria-label="Search"
            className="grid h-9 w-9 place-items-center rounded-xl text-textSecondary transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gain md:hidden"
          >
            <Search className="h-[18px] w-[18px]" aria-hidden />
          </button>

          <Link
            href="/notifications"
            aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
            className="relative grid h-9 w-9 place-items-center rounded-xl text-textSecondary transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gain"
          >
            <Bell className="h-[18px] w-[18px]" aria-hidden />
            {unread > 0 && (
              <span className="absolute -right-0.5 -top-0.5 grid h-[17px] min-w-[17px] place-items-center rounded-full bg-loss px-1 text-[9.5px] font-bold text-white">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </Link>

          <Link
            href="/profile"
            aria-label="Your account"
            className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-white/[0.08] text-[12px] font-bold text-white transition-colors hover:bg-white/[0.14] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gain"
          >
            {user?.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
            ) : (
              user?.initials || "—"
            )}
          </Link>
        </div>
      </div>

      {/* Section tabs */}
      <div className="flex items-center gap-3 px-5 lg:px-7">
        <div role="tablist" aria-label="Portfolio sections" className="no-scrollbar -mb-px flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {TABS.map((t) => {
            const active = t.id === tab;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={active}
                onClick={() => onTab(t.id)}
                className={`shrink-0 border-b-2 px-3 py-2.5 text-[13px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-gain ${
                  active
                    ? "border-gain text-white"
                    : "border-transparent text-textSecondary hover:text-white"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={onDeposit}
          className="mb-2 hidden shrink-0 rounded-lg bg-gain px-4 py-2 text-[12.5px] font-bold text-[#04220F] transition-all hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gain active:scale-[0.97] sm:block"
        >
          Deposit
        </button>
      </div>
    </header>
  );
}
