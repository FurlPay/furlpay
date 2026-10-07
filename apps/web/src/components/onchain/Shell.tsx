"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  BarChart3,
  Bell,
  BookOpen,
  Boxes,
  ChartNoAxesCombined,
  ChevronDown,
  CircleDollarSign,
  CreditCard,
  FileText,
  Globe2,
  Landmark,
  LayoutDashboard,
  Network,
  Plane,
  Plug,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Store,
  Users,
  Wallet,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import { FurlPayMark } from "@/components/trips/FurlPayLogo";
import type { RiskView } from "@/lib/onchain/dashboard";
import { fmtCount } from "@/components/analytics/format";
import { Menu, chainLabel } from "./ui";
import type { OnchainRange } from "./useOnchain";

export const RANGE_LABEL: Record<OnchainRange, string> = { "24h": "Last 24 hours", "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days" };
export const CHAINS = ["all", "ethereum", "base", "arbitrum", "solana", "polygon", "optimism", "avalanche"] as const;

/** Section anchors on this page, or real public pages. No dead links. */
const NAV: { label: string; href: string; Icon: LucideIcon }[] = [
  { label: "Overview", href: "#overview", Icon: LayoutDashboard },
  { label: "Payments", href: "#payments", Icon: CircleDollarSign },
  { label: "Wallets", href: "/dashboard", Icon: Wallet },
  { label: "Cards", href: "/cards", Icon: CreditCard },
  { label: "Travel", href: "/travel", Icon: Plane },
  { label: "Users", href: "#overview", Icon: Users },
  { label: "Merchants", href: "#categories", Icon: Store },
  { label: "Compliance", href: "#risk", Icon: ShieldCheck },
  { label: "Risk", href: "#risk", Icon: ShieldAlert },
  { label: "Counterparties", href: "#counterparties", Icon: Network },
  { label: "Chain Analytics", href: "#chains", Icon: Boxes },
  { label: "Stablecoin Market", href: "#market", Icon: Globe2 },
  { label: "Reports", href: "/reports", Icon: FileText },
];

/** A plain ring glyph standing in for the Allium wordmark (not their trademarked logo). */
export function AlliumMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}

interface Me {
  name?: string;
  email?: string;
  initials?: string;
}

function useMe() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => {
    const ac = new AbortController();
    fetch("/api/profile", { signal: ac.signal })
      .then(async (r) => setMe(r.ok ? ((await r.json()) as Me) : null))
      .catch(() => !ac.signal.aborted && setMe(null));
    return () => ac.abort();
  }, []);
  return me;
}

const initialOf = (me: Me | null | undefined) => (me?.initials || me?.name?.[0] || me?.email?.[0] || "").toUpperCase();

export function Sidebar({ active, onNavigate, alliumConfigured, operator = false }: { active: string; onNavigate?: () => void; alliumConfigured: boolean; operator?: boolean }) {
  // The Tokenized Assets section exists on the page only for the operator.
  const nav = operator ? [...NAV.slice(0, 12), { label: "Tokenized Assets", href: "#rwa", Icon: Landmark }, ...NAV.slice(12)] : NAV;
  const me = useMe();
  const row = "flex h-[35px] items-center gap-3 rounded-lg border px-3 text-[13px] transition-colors";
  return (
    <nav className="flex min-h-full flex-col px-[10px] pb-3 pt-[14px]" aria-label="Onchain Intelligence">
      <Link href="/onchain" onClick={onNavigate} className="mb-[22px] flex items-center gap-2 px-2">
        <FurlPayMark size={27} />
        <span className="text-[21px] font-bold tracking-[-0.02em] text-white">FurlPay</span>
      </Link>
      <Link
        href="/onchain"
        onClick={onNavigate}
        className="mb-2 flex h-[36px] items-center gap-2.5 rounded-lg border border-[#00E599]/25 bg-[#00E599]/[0.10] px-3 text-[13px] font-medium text-white"
      >
        <ChartNoAxesCombined className="h-4 w-4 text-[#00E599]" /> Analytics <ChevronDown className="ml-auto h-3.5 w-3.5 text-white/70" />
      </Link>
      <ul className="space-y-[1px]">
        {nav.map(({ label, href, Icon }) => {
          const on = label === active;
          return (
            <li key={label}>
              <Link
                href={href}
                onClick={onNavigate}
                aria-current={on ? "page" : undefined}
                className={`${row} ${on ? "border-[#00E599]/20 bg-[#0E2A20] text-white" : "border-transparent text-[#D5DAD8] hover:bg-white/[0.04] hover:text-white"}`}
              >
                <Icon className={`h-[17px] w-[17px] shrink-0 ${on ? "text-[#00E599]" : "text-white/85"}`} strokeWidth={1.7} /> {label}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="mx-1 my-3 border-t border-white/[0.07]" />
      <ul className="space-y-[1px]">
        <li>
          <Link href="/docs" onClick={onNavigate} className={`${row} border-transparent text-[#D5DAD8] hover:bg-white/[0.04] hover:text-white`}>
            <Webhook className="h-[17px] w-[17px]" strokeWidth={1.7} /> API & Webhooks
          </Link>
        </li>
        <li>
          <Link href="/integrations" onClick={onNavigate} className={`${row} border-transparent text-[#D5DAD8] hover:bg-white/[0.04] hover:text-white`}>
            <Plug className="h-[17px] w-[17px]" strokeWidth={1.7} /> Integrations
          </Link>
        </li>
      </ul>

      <div className="mt-auto pt-8">
        <div className="mx-0.5 mb-5 flex h-[48px] items-center gap-2 rounded-lg border border-white/[0.09] bg-white/[0.015] px-3 text-[12px] text-white/75">
          {alliumConfigured ? (
            <>
              <span>Powered by</span>
              <AlliumMark className="h-3.5 w-3.5 text-white" />
              <span className="font-semibold text-white">Allium</span>
            </>
          ) : (
            <span className="leading-tight">
              Allium <span className="text-white/45">· not connected</span>
            </span>
          )}
        </div>
        <ul className="space-y-[1px]">
          <li>
            <Link href="/docs" onClick={onNavigate} className={`${row} border-transparent text-[#D5DAD8] hover:bg-white/[0.04] hover:text-white`}>
              <BookOpen className="h-[17px] w-[17px]" strokeWidth={1.7} /> Docs
            </Link>
          </li>
          <li>
            <Link href="/profile" onClick={onNavigate} className={`${row} border-transparent text-[#D5DAD8] hover:bg-white/[0.04] hover:text-white`}>
              <Settings className="h-[17px] w-[17px]" strokeWidth={1.7} /> Settings
            </Link>
          </li>
        </ul>
        <div className="mx-1 mt-4 border-t border-white/[0.07] pt-4">
          {me ? (
            <Link href="/profile" className="flex items-center gap-2.5 px-1">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0E7A52] text-[14px] font-semibold text-white">{initialOf(me) || "·"}</span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium text-white">{me.name || me.email}</span>
                <span className="block truncate text-[11.5px] text-white/55">{me.name && me.email ? me.email : "FurlPay"}</span>
              </span>
            </Link>
          ) : me === null ? (
            <Link href="/login?next=%2Fonchain" className="flex items-center gap-2.5 px-1 text-[13px] text-white/80 hover:text-white">
              <span className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 text-white/60">?</span> Sign in
            </Link>
          ) : (
            <div className="h-8" />
          )}
        </div>
      </div>
    </nav>
  );
}

export function TopNav({
  range,
  setRange,
  chain,
  setChain,
  query,
  setQuery,
  risk,
  onMenu,
  onSearch,
}: {
  range: OnchainRange;
  setRange: (r: OnchainRange) => void;
  chain: string;
  setChain: (c: string) => void;
  query: string;
  setQuery: (q: string) => void;
  risk: RiskView | null;
  onMenu: () => void;
  onSearch: (q: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [bell, setBell] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);
  const me = useMe();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
      }
      if (e.key === "Escape") setBell(false);
    };
    const onDown = (e: MouseEvent) => !bellRef.current?.contains(e.target as Node) && setBell(false);
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, []);

  const alerts = risk ? risk.flagged.value : 0;
  return (
    <header className="sticky top-0 z-40 flex h-[53px] items-center gap-3 border-b border-white/[0.07] bg-[#06090A]/95 px-4 backdrop-blur sm:px-[15px]">
      <button onClick={onMenu} aria-label="Open navigation" className="rounded-md p-1.5 text-white/75 hover:text-white xl:hidden">
        <BarChart3 className="h-5 w-5" />
      </button>
      <label className="hidden h-[32px] w-full max-w-[454px] items-center gap-2 rounded-md border border-white/[0.11] bg-[#0A0F10] px-3 transition-colors focus-within:border-[#00E599]/50 md:flex">
        <Search className="h-4 w-4 shrink-0 text-white/55" />
        <input
          ref={input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && query.trim()) onSearch(query.trim());
          }}
          enterKeyHint="search"
          className="min-w-0 flex-1 bg-transparent text-[12.5px] text-white placeholder:text-white/50 focus:outline-none"
          placeholder="Search transactions, addresses, entities, merchants..."
          aria-label="Search transactions, addresses, entities, merchants"
        />
        <kbd className="rounded border border-white/15 px-1.5 text-[10.5px] text-white/55">⌘ K</kbd>
      </label>
      <div className="ml-auto flex items-center gap-2.5">
        <Menu label="Time range" size="md" width={132} value={range} onChange={setRange} options={(Object.keys(RANGE_LABEL) as OnchainRange[]).map((k) => [k, RANGE_LABEL[k]] as const)} />
        <div className="hidden sm:block">
          <Menu label="Chain" size="md" width={145} value={chain} onChange={setChain} options={CHAINS.map((c) => [c, chainLabel(c)] as const)} />
        </div>
        <span className="mx-1 hidden h-6 w-px bg-white/[0.1] sm:block" />
        <div ref={bellRef} className="relative">
          <button onClick={() => setBell((b) => !b)} aria-label={`Alerts${alerts ? `: ${alerts} flagged` : ""}`} aria-expanded={bell} className="relative rounded-lg p-2 text-white/85 hover:bg-white/[0.05]">
            <Bell className="h-[18px] w-[18px]" />
            {alerts > 0 && <span className="absolute right-[7px] top-[6px] h-2 w-2 rounded-full bg-[#FF3B5C] ring-2 ring-[#06090A]" />}
          </button>
          {bell && (
            <div className="absolute right-0 z-50 mt-1 w-[260px] rounded-lg border border-white/[0.12] bg-[#0D1415] p-3 text-[12.5px] shadow-xl shadow-black/60">
              <p className="mb-2 font-medium text-white">Security events in this period</p>
              {risk ? (
                <ul className="space-y-1 text-white/75">
                  <li className="flex justify-between">Flagged (medium+) <span className="tabular-nums text-white">{fmtCount(risk.flagged.value)}</span></li>
                  <li className="flex justify-between">Sanctions hits <span className="tabular-nums text-white">{fmtCount(risk.sanctions.value)}</span></li>
                  <li className="flex justify-between">Critical <span className="tabular-nums text-white">{fmtCount(risk.critical.value)}</span></li>
                </ul>
              ) : (
                <p className="text-white/55">The security event store is not available.</p>
              )}
              <a href="#risk" onClick={() => setBell(false)} className="mt-2.5 block text-[#00E599] hover:underline">
                Open Risk & Compliance
              </a>
            </div>
          )}
        </div>
        <Link href={me ? "/profile" : "/login?next=%2Fonchain"} aria-label={me ? "Your profile" : "Sign in"} className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-[#1A2224] text-[13px] font-semibold text-white ring-1 ring-white/10 hover:ring-white/30">
          {me ? initialOf(me) : <Users className="h-4 w-4 text-white/85" />}
        </Link>
      </div>
    </header>
  );
}
