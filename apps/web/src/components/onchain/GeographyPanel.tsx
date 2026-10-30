"use client";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { Expand, Globe2, RotateCcw, X } from "lucide-react";
import type { OnchainDashboard as Data } from "@/lib/onchain/dashboard";
import { cleanCorridors, countryName, countryTotals, flag } from "@/lib/onchain/corridors";
import { fmtUsd } from "@/components/analytics/format";
import { Card, GhostButton, Menu } from "./ui";
const GeoMap = dynamic(() => import("./GeoMap"), { ssr: false, loading: () => <div className="h-[280px] animate-pulse rounded bg-[#07121a]" /> });
const usd = (v: number) => fmtUsd(v, { compact: true });

export function GeographyPanel({ data }: { data: Data }) {
  const [country, setCountry] = useState("");
  const [globe, setGlobe] = useState(false);
  const [full, setFull] = useState(false);
  const [mode, setMode] = useState("provider");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (full) dialog.current?.showModal(); }, [full]);
  const all = useMemo(() => data.chain === "all" && data.corridors.status === "ok" ? cleanCorridors(data.corridors.data) : [], [data]);
  const countries = useMemo(() => countryTotals(all), [all]);
  const selected = countries.some(c => c.code === country) ? country : "";
  const rows = mode === "verified" ? [] : all.filter(r => !selected || r.from === selected || r.to === selected);
  const totals = countryTotals(rows);
  const reason = mode === "verified" ? "Verified payment geography is not connected. Wallet addresses alone do not identify a country."
    : data.chain !== "all" ? "This country-pair source does not expose chain attribution. Select All Chains to inspect its global snapshot."
    : data.corridors.status === "unavailable" ? data.corridors.reason : rows.length === 0 ? "No country pairs were returned by the provider." : null;
  const body = <>
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <Menu label="Geography evidence" value={mode} onChange={setMode} options={[["provider", "Provider attribution"], ["verified", "Verified FurlPay"]]} />
      <Menu label="Country" value={selected} onChange={setCountry} options={[["", "All countries"], ...countries.map(c => [c.code, countryName(c.code)] as const)]} />
      <button aria-pressed={globe} onClick={() => setGlobe(v => !v)} className="flex h-7 items-center gap-1 rounded border border-[#192b35] px-2 text-[11px]"><Globe2 size={13} />{globe ? "Globe" : "2D map"}</button>
      <button aria-label="Reset map and country filter" onClick={() => { setCountry(""); setGlobe(false); setMode("provider"); }} className="rounded p-1.5 text-[#9baebb] hover:text-white"><RotateCcw size={13} /></button>
      <span className="ml-auto text-[10px] text-[#ffd66b]">{mode === "verified" ? "Verified source unavailable" : "Attribution methodology unverified"}</span>
    </div>
    <div className="grid gap-3 lg:grid-cols-[minmax(0,7fr)_minmax(220px,3fr)]">
      <div className={full ? "h-[60vh] min-h-[280px]" : "h-[290px]"}><GeoMap rows={rows} globe={globe} selected={selected} onSelect={setCountry} /></div>
      <div className={full ? "max-h-[60vh] overflow-y-auto" : "min-w-0"}>
        <h3 className="mb-1 text-[11px] font-medium">Top Corridors <span className="text-[#647b89]">(returned snapshot)</span></h3>
        {reason ? <p role="status" className="mb-5 py-3 text-[11px] leading-relaxed text-[#9baebb]">{reason}</p> : <ol className="mb-3 text-[11px]">
          {rows.slice(0, full ? 25 : 5).map((r, i) => <li key={r.from + r.to} className="flex items-center gap-2 border-b border-[#192b35] py-1.5"><span className="rounded bg-[#192b35] px-1 text-[#9baebb]">{i + 1}</span><button onClick={() => setCountry(r.from)} className="hover:text-[#19d99a]" aria-label={"Filter by " + countryName(r.from)}>{r.from}</button><span className="text-[#647b89]">→</span><button onClick={() => setCountry(r.to)} className="hover:text-[#19d99a]" aria-label={"Filter by " + countryName(r.to)}>{r.to}</button><span className="ml-auto tabular-nums">{usd(r.volumeUsd)}</span></li>)}
        </ol>}
        <h3 className="mb-1 text-[11px] font-medium">Countries by touched volume</h3>
        <ol className="text-[11px]">{totals.slice(0, full ? 50 : 5).map(c => <li key={c.code}><button onClick={() => setCountry(selected === c.code ? "" : c.code)} aria-pressed={selected === c.code} className="flex w-full items-center gap-2 border-b border-[#192b35] py-1.5 text-left hover:text-[#19d99a]"><span>{flag(c.code)}</span><span className="truncate">{countryName(c.code)}</span><span className="ml-auto tabular-nums">{usd(c.touchedUsd)}</span></button></li>)}</ol>
        {!totals.length && <p className="py-3 text-[11px] text-[#647b89]">No attributed volume available.</p>}
      </div>
    </div>
    <p className="mt-2 text-[10px] leading-relaxed text-[#9baebb]">Provider snapshot: its time window, asset coverage and attribution confidence are not supplied. The page date filter does not apply. Unknown-country volume is unmeasured; country totals overlap and must not be summed. Map lines connect country centroids, not wallet locations.</p>
  </>;
  return <Card title="Global Stablecoin Flows" id="flows" source={data.corridors.source} freshness={data.freshness.corridors} action={<GhostButton onClick={() => setFull(true)}><Expand size={12} />Explore</GhostButton>}>
    {!full && body}
    {full && <dialog ref={dialog} onCancel={() => setFull(false)} onClose={() => setFull(false)} aria-label="Geographic intelligence explorer" className="fixed inset-0 m-auto max-h-[95vh] w-[96vw] max-w-[1600px] overflow-auto rounded-lg border border-[#294553] bg-[#09141c] p-4 text-[#f1f5f9] backdrop:bg-black/80">
      <div className="mb-3 flex items-center justify-between"><h2 className="text-base font-semibold">Geographic Intelligence</h2><button autoFocus onClick={() => setFull(false)} aria-label="Close geographic explorer" className="rounded border border-[#294553] p-2"><X size={18} /></button></div>{body}
    </dialog>}
  </Card>;
}
