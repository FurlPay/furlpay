"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { FurlPayMark } from "@/components/trips/FurlPayLogo";
import type { OnchainDashboard as Data } from "@/lib/onchain/dashboard";
import { relTime } from "@/components/analytics/format";
import { AlliumMark, RANGE_LABEL, Sidebar, TopNav } from "./Shell";
import { Activity, Categories, ChainDonut, Counterparties, Flow, KpiRow, MarketInsights, PaymentVolume, Risk, StablecoinFlows } from "./panels";
import { chainLabel } from "./ui";
import { useOnchain, type OnchainRange } from "./useOnchain";

// ---------------------------------------------------------------------------
// /onchain — Onchain Intelligence. Layout follows the reference design; every
// number comes from /api/onchain, and every card names its source. A card
// whose source is not connected says so in place of a chart: nothing on this
// page is a placeholder value.
// ---------------------------------------------------------------------------

/** Sidebar item lit for the section nearest the top of the viewport. */
const SECTION_NAV: [string, string][] = [
  ["payments", "Payments"],
  ["chains", "Chain Analytics"],
  ["categories", "Merchants"],
  ["counterparties", "Counterparties"],
  ["risk", "Risk"],
  ["market", "Stablecoin Market"],
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

export default function OnchainDashboard() {
  const [range, setRange] = useState<OnchainRange>("30d");
  const [chain, setChain] = useState("all");
  const [query, setQuery] = useState("");
  const [drawer, setDrawer] = useState(false);
  const { data, state, error, updatedAt } = useOnchain(range, chain);
  const active = useActiveSection(Boolean(data));
  const allium = data?.alliumConfigured ?? false;

  return (
    <div className="min-h-screen bg-[#05080A] font-sans text-white antialiased">
      <div className="flex">
        <aside className="sticky top-0 hidden h-screen w-[188px] shrink-0 overflow-y-auto border-r border-white/[0.07] bg-[#06090B] xl:block">
          <Sidebar active={active} alliumConfigured={allium} />
        </aside>
        {drawer && (
          <div className="fixed inset-0 z-50 xl:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
            <button aria-label="Close navigation" className="absolute inset-0 bg-black/70" onClick={() => setDrawer(false)} />
            <div className="absolute inset-y-0 left-0 w-[240px] overflow-y-auto border-r border-white/[0.08] bg-[#06090B]">
              <button aria-label="Close navigation" onClick={() => setDrawer(false)} className="absolute right-3 top-4 z-10 rounded-md p-1.5 text-white/60 hover:text-white">
                <X className="h-5 w-5" />
              </button>
              <Sidebar active={active} alliumConfigured={allium} onNavigate={() => setDrawer(false)} />
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
          />
          <main id="overview" className="px-4 pb-8 pt-[18px] sm:px-[20px]">
            <TitleRow data={data} state={state} updatedAt={updatedAt} />
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
                <div className="grid grid-cols-1 gap-[14px] xl:min-h-[238px] xl:grid-cols-[472fr_352fr_442fr]">
                  <PaymentVolume data={data} chain={chain} setChain={setChain} rangeKey={range} />
                  <ChainDonut data={data} />
                  <StablecoinFlows data={data} />
                </div>
                <div className="grid grid-cols-1 gap-[14px] xl:min-h-[242px] xl:grid-cols-[428fr_410fr_442fr]">
                  <Categories data={data} />
                  <Counterparties data={data} query={query} />
                  <Activity data={data} query={query} />
                </div>
                <div className="grid grid-cols-1 gap-[14px] xl:min-h-[234px] xl:grid-cols-[404fr_436fr_442fr]">
                  <Risk data={data} />
                  <Flow data={data} chain={chain} setChain={setChain} />
                  <MarketInsights data={data} />
                </div>
                <p className="pt-1 text-[11px] text-white/35">
                  Generated {new Date(data.generatedAt).toLocaleString("en-US", { timeZone: "UTC" })} UTC · {chainLabel(data.chain)} · {RANGE_LABEL[range]}. Settled transactions only; changes compare with the equally long period before.
                </p>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

function TitleRow({ data, state, updatedAt }: { data: Data | null; state: string; updatedAt: number | null }) {
  const badge =
    state === "live"
      ? { text: "Live Data", cls: "border-[#00E599]/45 text-[#00E599]", dot: "bg-[#00E599]" }
      : state === "degraded"
        ? { text: "Live · some sources unavailable", cls: "border-[#F5B83D]/45 text-[#F5B83D]", dot: "bg-[#F5B83D]" }
        : state === "offline"
          ? { text: updatedAt ? `Offline · ${relTime(updatedAt)}` : "Offline", cls: "border-[#FF4D6D]/45 text-[#FF8FA3]", dot: "bg-[#FF4D6D]" }
          : { text: "Connecting…", cls: "border-white/20 text-white/70", dot: "bg-white/50" };
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
      <div className="min-w-0">
        <h1 className="text-[27px] font-bold leading-tight tracking-[-0.02em]">Onchain Intelligence</h1>
        <p className="mt-0.5 text-[14.5px] text-white/80">
          {data?.alliumConfigured ? "Real-time blockchain data, analytics and insights powered by Allium." : "Real-time payment analytics from the FurlPay ledger and live stablecoin market data."}
        </p>
      </div>
      <div className="flex items-center gap-5 lg:ml-auto">
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
        <span className={`flex h-[34px] items-center gap-2 rounded-lg border bg-[#00E599]/[0.04] px-4 text-[12.5px] font-medium ${badge.cls}`} aria-live="polite">
          <span className={`h-2 w-2 rounded-full ${badge.dot} ${state === "live" ? "animate-pulse" : ""}`} />
          {badge.text}
        </span>
      </div>
    </div>
  );
}
