"use client";

import { useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { FurlPayMark } from "@/components/trips/FurlPayLogo";
import type { OnchainDashboard as Data } from "@/lib/onchain/dashboard";
import { relTime } from "@/components/analytics/format";
import { AlliumMark, RANGE_LABEL, Sidebar, TopNav } from "./Shell";
import { Activity, Categories, ChainDonut, Counterparties, Flow, KpiRow, MarketInsights, PaymentVolume, Risk, StablecoinFlows } from "./panels";
import { chainLabel } from "./ui";
import { useOnchain, type OnchainRange } from "./useOnchain";
import { ChainEventRow, LiveBadge, TxDrawer, useOnchainLive, type ConnState } from "./live";
import { UsdcNetworkPanel } from "./usdc";
import { CctpPanel } from "./cctp";
import { UsdcIndexPanel } from "./usdcIndex";
import { ChainLookup, isChainQuery } from "./lookup";
import { ExportMenu, SystemStatusPill, VolumeLayers } from "./viewBar";
import { MarketOverview } from "./MarketOverview";
import { viewParams, viewQuery } from "@/lib/onchain/dashboardView";
import type { FeedEvent, LiveSnapshot } from "@/lib/onchain/live";

// ---------------------------------------------------------------------------
// /onchain — Onchain Intelligence. Layout follows the reference design; every
// number comes from /api/onchain, and every card names its source. A card
// whose source is not connected says so in place of a chart: nothing on this
// page is a placeholder value.
// ---------------------------------------------------------------------------

/** Sidebar item lit for the section nearest the top of the viewport. */
const SECTION_NAV: [string, string][] = [
  ["flows", "Geography"],
  ["market-overview", "Stablecoins"],
  ["payments", "Payments"],
  ["counterparties", "Wallets"],
  ["chains", "Chains"],
  ["risk", "Risk & Compliance"],
  ["market", "Market Insights"],
  ["cctp", "Cross-chain"],
];

function useActiveSection(ready: boolean) {
  const [active, setActive] = useState("Overview");
  useEffect(() => {
    if (!ready) return;
    const onScroll = () => {
      if (window.scrollY < 140) return setActive("Overview");
      let best = "Overview";
      for (const [id, label] of SECTION_NAV) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top < window.innerHeight * 0.45) best = label;
      }
      setActive(best);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [ready]);
  return active;
}

export default function OnchainDashboard({ operatorSection = null }: { operatorSection?: ReactNode }) {
  const [range, setRange] = useState<OnchainRange>("30d");
  const [chain, setChain] = useState("all");
  // ?range=&chain= make a view shareable. Read once after mount (the server
  // render has no URL state) and written back with replaceState, so filters
  // do not pile up browser history.
  const [urlReady, setUrlReady] = useState(false);
  useEffect(() => {
    const v = viewParams(window.location.search);
    setRange(v.range);
    setChain(v.chain);
    setUrlReady(true);
  }, []);
  useEffect(() => {
    if (!urlReady) return;
    const next = `${window.location.pathname}${viewQuery(range, chain)}${window.location.hash}`;
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(null, "", next);
  }, [range, chain, urlReady]);
  const [query, setQuery] = useState("");
  const [drawer, setDrawer] = useState(false);
  const { data, error, reload } = useOnchain(range, chain);
  // A new chain event also refreshes the ledger-backed cards on the page.
  const live = useOnchainLive(() => void reload());
  const [openEv, setOpenEv] = useState<FeedEvent | null>(null);
  const [search, setSearch] = useState<SearchState | null>(null);
  const runSearch = async (q: string) => {
    setSearch({ q, status: "loading", events: [], message: null });
    try {
      const res = await fetch(`/api/onchain/search?q=${encodeURIComponent(q)}`, { cache: "no-store" });
      const b = (await res.json().catch(() => null)) as { ok: true; data: { events: FeedEvent[]; scope: string } } | { ok: false; error?: { message?: string } } | null;
      if (b && b.ok) setSearch({ q, status: "done", events: b.data.events, message: b.data.scope === "furlpay_owned" ? "Public search covers FurlPay-owned addresses; user wallets stay private." : null });
      else setSearch({ q, status: "done", events: [], message: (b && !b.ok && b.error?.message) || `Search failed (${res.status})` });
    } catch {
      setSearch({ q, status: "done", events: [], message: "Network error." });
    }
  };
  const active = useActiveSection(Boolean(data));
  const allium = data?.alliumConfigured ?? false;

  return (
    <div className="min-h-screen bg-[#05080A] font-sans text-white antialiased">
      <div className="flex">
        <aside className="sticky top-0 hidden h-screen w-[188px] shrink-0 overflow-y-auto border-r border-white/[0.07] bg-[#06090B] xl:block">
          <Sidebar active={active} alliumConfigured={allium} operator={Boolean(operatorSection)} />
        </aside>
        {drawer && (
          <div className="fixed inset-0 z-50 xl:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
            <button aria-label="Close navigation" className="absolute inset-0 bg-black/70" onClick={() => setDrawer(false)} />
            <div className="absolute inset-y-0 left-0 w-[240px] overflow-y-auto border-r border-white/[0.08] bg-[#06090B]">
              <button aria-label="Close navigation" onClick={() => setDrawer(false)} className="absolute right-3 top-4 z-10 rounded-md p-1.5 text-white/60 hover:text-white">
                <X className="h-5 w-5" />
              </button>
              <Sidebar active={active} alliumConfigured={allium} operator={Boolean(operatorSection)} onNavigate={() => setDrawer(false)} />
            </div>
          </div>
        )}

        <div className="min-w-0 flex-1">
          <TopNav
            range={range}
            setRange={setRange}
            chain={chain}
            setChain={setChain}
            query={query}
            setQuery={setQuery}
            risk={data?.risk.status === "ok" ? data.risk.data : null}
            onMenu={() => setDrawer(true)}
            onSearch={runSearch}
          />
          <main id="overview" className="px-4 pb-8 pt-[18px] sm:px-[20px]">
            <TitleRow data={data} snap={live.snap} conn={live.conn} />
            {search && <SearchPanel s={search} onClose={() => setSearch(null)} onOpen={setOpenEv} />}
            {error && (
              <p role="alert" className="mt-3 rounded-lg border border-[#FF4D6D]/30 bg-[#FF4D6D]/[0.06] px-3 py-2 text-[13px] text-[#FFB3C1]">
                {error}
                {data ? " — showing the last good data." : ""}
              </p>
            )}
            {!data ? (
              <div className="mt-[18px] grid gap-[14px] md:grid-cols-5">
                {Array.from({ length: 5 }, (_, i) => (
                  <div key={i} className="h-[105px] animate-pulse rounded-[10px] border border-white/[0.06] bg-white/[0.02]" />
                ))}
              </div>
            ) : (
              <div className="mt-[18px] space-y-[14px]">
                <KpiRow data={data} />
                {data.ledger.status === "unavailable" && <p className="text-[12.5px] text-[#F5B83D]">FurlPay ledger unavailable: {data.ledger.reason}</p>}
                {data.ledger.status === "ok" && data.ledger.note && <p className="text-[12.5px] text-[#F5B83D]">{data.ledger.note}</p>}
                {/* Same order as the reference design: flows, market and classification, volume, rankings, then chain data. */}
                <StablecoinFlows data={data} />
                <div className="grid grid-cols-1 gap-[14px] xl:grid-cols-[6fr_4fr]">
                  <MarketOverview data={data} />
                  <Categories data={data} />
                </div>
                <VolumeLayers data={data} />
                <div className="grid grid-cols-1 gap-[14px] xl:min-h-[238px] xl:grid-cols-[7fr_3fr]">
                  <PaymentVolume data={data} chain={chain} setChain={setChain} rangeKey={range} />
                  <Counterparties data={data} query={query} />
                </div>
                <div className="grid grid-cols-1 gap-[14px] xl:min-h-[234px] xl:grid-cols-3">
                  <ChainDonut data={data} />
                  <Flow data={data} chain={chain} setChain={setChain} />
                  <MarketInsights data={data} />
                </div>
                <div className="grid grid-cols-1 gap-[14px] xl:min-h-[234px] xl:grid-cols-2">
                  <Risk data={data} />
                  <Activity data={data} query={query} live={live.snap} onOpen={setOpenEv} />
                </div>
                {operatorSection && <div className="mt-6 border-t border-white/[0.07] pt-6">{operatorSection}</div>}
                <p className="pt-1 text-[11px] text-white/35">
                  Generated {new Date(data.generatedAt).toLocaleString("en-US", { timeZone: "UTC" })} UTC · {chainLabel(data.chain)} · {RANGE_LABEL[range]}. Settled transactions only; changes compare with the equally long period before.
                </p>
              </div>
            )}
            {/* Network-wide USDC read from FurlPay's chain nodes, and cross-chain CCTP.
                These load on their own, so they render even when the ledger API fails. */}
            <div className="mt-[14px] space-y-[14px]">
              <UsdcIndexPanel />
              <UsdcNetworkPanel />
              <CctpPanel />
            </div>
          </main>
        </div>
      </div>
      {openEv && <TxDrawer ev={openEv} onClose={() => setOpenEv(null)} />}
    </div>
  );
}

interface SearchState {
  q: string;
  status: "loading" | "done";
  events: FeedEvent[];
  message: string | null;
}

function SearchPanel({ s, onClose, onOpen }: { s: SearchState; onClose: () => void; onOpen: (e: FeedEvent) => void }) {
  return (
    <section className="mt-3 rounded-[10px] border border-white/[0.09] bg-[#0A0F10] px-4 py-3" aria-label="Search results">
      <div className="mb-1 flex items-center gap-2 text-[13px]">
        <span className="font-semibold">Search</span>
        <span className="min-w-0 break-all font-mono text-white/60">{s.q}</span>
        <button onClick={onClose} aria-label="Close search" className="ml-auto rounded p-1 text-white/50 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>
      {s.status === "loading" ? (
        <p className="py-2 text-[12.5px] text-white/50">Searching…</p>
      ) : s.events.length === 0 ? (
        <p className="py-2 text-[12.5px] text-white/50">{s.message ?? "No matching onchain events."}</p>
      ) : (
        <>
          <ul className="text-[12.5px]">
            {s.events.map((e) => (
              <ChainEventRow key={e.key} e={e} onOpen={onOpen} />
            ))}
          </ul>
          {s.message && <p className="mt-1 text-[11px] text-white/40">{s.message}</p>}
        </>
      )}
      {isChainQuery(s.q) && (
        <div className="mt-2 border-t border-white/[0.07] pt-2">
          <p className="text-[12px] font-semibold text-white/80">On-chain</p>
          <ChainLookup q={s.q} />
        </div>
      )}
    </section>
  );
}

function TitleRow({ data, snap, conn }: { data: Data | null; snap: LiveSnapshot | null; conn: ConnState }) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
      <div className="min-w-0">
        <h1 className="text-[27px] font-bold leading-tight tracking-[-0.02em]">Onchain Intelligence</h1>
        <p className="mt-0.5 text-[14.5px] text-white/80">
          {data?.alliumConfigured ? "Blockchain data, analytics and insights from Allium, the FurlPay ledger and FurlPay's chain nodes; each card shows its source and freshness." : "Payment analytics from the FurlPay ledger, USDC read from FurlPay's chain nodes, and stablecoin market data; each card shows its source and freshness."}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3 lg:ml-auto lg:gap-5">
        {data?.alliumConfigured && (
          <div className="hidden items-center gap-2.5 sm:flex" aria-label="FurlPay × Allium">
            <FurlPayMark size={27} />
            <span className="text-[24px] font-semibold tracking-[-0.02em]">FurlPay</span>
            <span className="px-1 text-[18px] text-white/70">×</span>
            <AlliumMark className="h-[26px] w-[26px]" />
            <span className="text-[24px] font-semibold tracking-[-0.02em]">Allium</span>
          </div>
        )}
        {data?.alliumConfigured && <span className="hidden h-8 w-px bg-white/[0.1] sm:block" />}
        <LiveBadge snap={snap} conn={conn} />
        {data && (
          <div className="flex items-center gap-2">
            <SystemStatusPill data={data} />
            <ExportMenu data={data} />
          </div>
        )}
      </div>
    </div>
  );
}
