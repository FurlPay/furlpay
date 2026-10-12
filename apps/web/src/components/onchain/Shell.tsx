"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  IconAnalytics,
  IconApi,
  IconBell,
  IconCctp,
  IconChainAnalytics,
  IconCounterparties,
  IconDocs,
  IconIntegrations,
  IconMenu,
  IconOverview,
  IconPayments,
  IconProfile,
  IconReports,
  IconRisk,
  IconSearch,
  IconSettings,
  IconStablecoinFlows,
  IconStablecoinMarket,
  IconTokenizedAssets,
  IconWallet,
  type FurlIcon,
} from "@/components/furlicons";
import { FurlPayMark } from "@/components/trips/FurlPayLogo";
import type { RiskView } from "@/lib/onchain/dashboard";
import { fmtCount } from "@/components/analytics/format";
import { Menu, chainLabel } from "./ui";
import type { OnchainRange } from "./useOnchain";

export const RANGE_LABEL: Record<OnchainRange, string> = { "24h": "Last 24 hours", "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days" };
export const CHAINS = ["all", "ethereum", "base", "arbitrum", "solana", "polygon", "optimism", "avalanche"] as const;

/** Section anchors on this page, or real pages. No dead links: the reference
 *  design's "Entities" and "Investigations" have no destination yet, so they
 *  are not listed; Admin is added for operators only (see Sidebar). */
const NAV: { label: string; href: string; Icon: FurlIcon }[] = [
  { label: "Overview", href: "#overview", Icon: IconOverview },
  { label: "Payments", href: "#payments", Icon: IconPayments },
  { label: "Wallets", href: "#counterparties", Icon: IconWallet },
  { label: "Stablecoins", href: "#market-overview", Icon: IconStablecoinMarket },
  { label: "Chains", href: "#chains", Icon: IconChainAnalytics },
  { label: "Geography", href: "#flows", Icon: IconStablecoinFlows },
  { label: "Cross-chain", href: "#cctp", Icon: IconCctp },
  { label: "Agent Payments", href: "/developer/agents", Icon: IconApi },
  { label: "Risk & Compliance", href: "#risk", Icon: IconRisk },
  { label: "Market Insights", href: "#market", Icon: IconTokenizedAssets },
  { label: "Reports", href: "/reports", Icon: IconReports },
  { label: "Webhooks", href: "/developer/webhooks", Icon: IconCounterparties },
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
  const nav = operator ? [...NAV, { label: "Tokenized Assets", href: "#rwa", Icon: IconTokenizedAssets }, { label: "Admin", href: "/ops", Icon: IconSettings }] : NAV;
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
        <IconAnalytics size={16} strokeWidth={1.7} className="text-[#00E599]" /> Analytics <ChevronDown className="ml-auto h-3.5 w-3.5 text-white/70" />
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
                <Icon size={17} strokeWidth={1.7} className={on ? "text-[#00E599]" : "text-white/85"} /> {label}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="mx-1 my-3 border-t border-white/[0.07]" />
      <ul className="space-y-[1px]">
        <li>
          <Link href="/docs" onClick={onNavigate} className={`${row} border-transparent text-[#D5DAD8] hover:bg-white/[0.04] hover:text-white`}>
            <IconApi size={17} strokeWidth={1.7} /> API & Webhooks
          </Link>
        </li>
        <li>
          <Link href="/integrations" onClick={onNavigate} className={`${row} border-transparent text-[#D5DAD8] hover:bg-white/[0.04] hover:text-white`}>
            <IconIntegrations size={17} strokeWidth={1.7} /> Integrations
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
              <IconDocs size={17} strokeWidth={1.7} /> Docs
            </Link>
          </li>
          <li>
            <Link href="/profile" onClick={onNavigate} className={`${row} border-transparent text-[#D5DAD8] hover:bg-white/[0.04] hover:text-white`}>
              <IconSettings size={17} strokeWidth={1.7} /> Settings
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
        <IconMenu size={20} />
      </button>
      <label className="hidden h-[32px] w-full max-w-[454px] items-center gap-2 rounded-md border border-white/[0.11] bg-[#0A0F10] px-3 transition-colors focus-within:border-[#00E599]/50 md:flex">
        <IconSearch size={14} className="text-white/55" />
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
            <IconBell size={16} />
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
          {me ? initialOf(me) : <IconProfile size={16} className="text-white/85" />}
        </Link>
      </div>
    </header>
  );
}
