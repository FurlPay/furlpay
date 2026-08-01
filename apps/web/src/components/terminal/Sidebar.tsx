"use client";

import { useState } from "react";
import {
  Bot,
  CreditCard,
  Home,
  LineChart,
  Landmark,
  PanelLeftClose,
  PanelLeft,
  PieChart,
  Plane,
  Send,
  Settings,
  Wallet,
  type LucideIcon,
} from "lucide-react";

// Fixed left navigation — the single change that most makes a dense data page
// read as a terminal rather than an analytics dashboard.
//
// Every destination is a REAL route in this app. A nav that links to pages
// that 404 is worse than a shorter nav: it advertises capability the product
// doesn't have and erodes trust on the first click. Items whose screens are
// mobile-only (they live under the /dashboard phone frame) are marked so they
// open there rather than pretending to be terminal surfaces.

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Active when the terminal itself is the destination. */
  self?: boolean;
}

const NAV: NavItem[] = [
  { label: "Dashboard", href: "/dashboard/terminal", icon: Home, self: true },
  { label: "Wallet", href: "/dashboard", icon: Wallet },
  { label: "Markets", href: "/markets", icon: LineChart },
  { label: "Portfolio", href: "/investing", icon: PieChart },
  { label: "Treasury", href: "/earn", icon: Landmark },
  { label: "Payments", href: "/dashboard", icon: Send },
  { label: "Cards", href: "/cards", icon: CreditCard },
  { label: "Travel", href: "/travel", icon: Plane },
  { label: "Agents", href: "/developer/agents", icon: Bot },
  { label: "Settings", href: "/dashboard", icon: Settings },
];

export function Sidebar({ active = "Dashboard" }: { active?: string }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r border-term-border bg-term-panel/60 backdrop-blur-sm lg:flex ${
        collapsed ? "w-[68px]" : "w-[204px]"
      } transition-[width] duration-200`}
    >
      <div className="flex items-center gap-2.5 px-4 py-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/furlpay-mark.svg" alt="" width={30} height={30} className="h-[30px] w-[30px] shrink-0 rounded-[7px]" />
        {!collapsed && (
          <div className="leading-tight">
            <p className="text-[13px] font-bold tracking-tight text-textPrimary">FurlPay</p>
            <p className="text-[9px] uppercase tracking-wider text-textSecondary">Terminal</p>
          </div>
        )}
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 px-2.5 py-2" aria-label="Primary">
        {NAV.map((item) => {
          const isActive = item.label === active;
          const Icon = item.icon;
          return (
            <a
              key={item.label}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              title={collapsed ? item.label : undefined}
              className={`group flex items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors ${
                isActive
                  ? "bg-neon/12 text-neon"
                  : "text-textSecondary hover:bg-term-raised hover:text-textPrimary"
              }`}
            >
              <Icon size={18} className="shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
              {isActive && !collapsed && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-neon" />}
            </a>
          );
        })}
      </nav>

      <button
        onClick={() => setCollapsed((c) => !c)}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className="m-2.5 flex items-center gap-3 rounded-lg px-2.5 py-2 text-[12px] text-textMuted transition-colors hover:bg-term-raised hover:text-textPrimary"
      >
        {collapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
        {!collapsed && <span>Collapse</span>}
      </button>
    </aside>
  );
}
