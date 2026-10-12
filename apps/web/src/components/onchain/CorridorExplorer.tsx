"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import world from "@/components/analytics/worldDots.json";
import { fmtUsd } from "@/components/analytics/format";
import type { SectionFreshness } from "@/lib/onchain/freshness";
import { arcPath, cleanCorridors, corridorShare, countryName, countryTotals, flag, type Corridor } from "@/lib/onchain/corridors";
import { FreshnessChip, NEON } from "./ui";

// ---------------------------------------------------------------------------
// Full-screen corridor explorer for /onchain. Everything it draws comes from
// the Allium corridor query already on the page: arcs exist only for country
// pairs that query returned, and both lists are computed from the same rows.
// Selecting a corridor or a country highlights it on the map; nothing is
// fetched, estimated or interpolated here.
// ---------------------------------------------------------------------------

const WORLD = world as unknown as { width: number; height: number; dots: [number, number][]; centroids: Record<string, [number, number]> };
const usd = (n: number) => fmtUsd(n, { compact: true });

type Selection = { kind: "corridor"; from: string; to: string } | { kind: "country"; code: string } | null;

export function CorridorExplorer({ rows, source, freshness, onClose }: { rows: readonly Corridor[]; source: string; freshness: SectionFreshness | null; onClose: () => void }) {
  const corridors = useMemo(() => cleanCorridors(rows), [rows]);
  const countries = useMemo(() => countryTotals(corridors), [corridors]);
  const max = Math.max(1, ...corridors.map((c) => c.volumeUsd));
  const [sel, setSel] = useState<Selection>(null);
  const [tab, setTab] = useState<"corridors" | "countries">("corridors");
  const dialog = useRef<HTMLDivElement>(null);
  const unplaced = corridors.filter((c) => !WORLD.centroids[c.from] || !WORLD.centroids[c.to]);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      prev?.focus();
    };
  }, [onClose]);

  const lit = (c: Corridor) =>
    !sel || (sel.kind === "corridor" ? sel.from === c.from && sel.to === c.to : c.from === sel.code || c.to === sel.code);
  const selectedCorridor = sel?.kind === "corridor" ? corridors.find((c) => c.from === sel.from && c.to === sel.to) ?? null : null;
  const selectedCountry = sel?.kind === "country" ? countries.find((c) => c.code === sel.code) ?? null : null;
  const nodes = [...new Set(corridors.flatMap((c) => [c.from, c.to]))];
  const tabBtn = (id: typeof tab, label: string) => (
    <button
      role="tab"
      aria-selected={tab === id}
      onClick={() => setTab(id)}
      className={`rounded-md px-2.5 py-1 text-[12px] ${tab === id ? "bg-[#00E599]/[0.12] text-white ring-1 ring-[#00E599]/30" : "text-white/60 hover:text-white"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-stretch justify-center bg-black/75 p-0 sm:p-6" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Stablecoin corridor explorer"
        className="flex w-full max-w-[1280px] flex-col overflow-hidden border-white/[0.1] bg-[#060B0D] outline-none sm:rounded-xl sm:border"
      >
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-white/[0.08] px-4 py-3">
          <h2 className="text-[16px] font-semibold text-white">Stablecoin Corridors</h2>
          <span className="rounded-full border border-[#F5B83D]/30 bg-[#F5B83D]/[0.08] px-2 py-0.5 text-[10.5px] font-medium text-[#F5B83D]">Market · inferred</span>
          {freshness && <FreshnessChip f={freshness} inline />}
          <button onClick={onClose} aria-label="Close corridor explorer" className="ml-auto rounded-md p-1.5 text-white/60 hover:bg-white/[0.06] hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[1fr_360px] lg:overflow-hidden">
          <div className="relative min-h-[260px] border-b border-white/[0.06] lg:border-b-0 lg:border-r">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,229,153,0.09),transparent_70%)]" />
            <svg viewBox={`0 0 ${WORLD.width} ${WORLD.height}`} className="relative h-full max-h-[620px] w-full" role="img" aria-label={`Map of ${corridors.length} attributed corridors`}>
              {WORLD.dots.map(([x, y], i) => (
                <circle key={i} cx={x} cy={y} r={1.1} fill="#1F6B52" fillOpacity={0.5} />
              ))}
              {corridors.map((c) => {
                const a = WORLD.centroids[c.from];
                const b = WORLD.centroids[c.to];
                if (!a || !b || c.from === c.to) return null;
                const t = c.volumeUsd / max;
                const on = lit(c);
                return (
                  <path
                    key={`${c.from}-${c.to}`}
                    d={arcPath(a, b)}
                    fill="none"
                    stroke={NEON}
                    strokeOpacity={on ? 0.35 + 0.6 * t : 0.08}
                    strokeWidth={(0.5 + 1.6 * t) * (on && sel ? 1.6 : 1)}
                    className="motion-safe:[stroke-dasharray:4_3] motion-safe:animate-[flow-dash_2.4s_linear_infinite] cursor-pointer"
                    style={{ filter: on ? "drop-shadow(0 0 2px #00E599)" : undefined }}
                    onClick={() => setSel({ kind: "corridor", from: c.from, to: c.to })}
                  >
                    <title>{`${countryName(c.from)} → ${countryName(c.to)}: ${usd(c.volumeUsd)}`}</title>
                  </path>
                );
              })}
              {nodes.map((code) => {
                const p = WORLD.centroids[code];
                if (!p) return null;
                const on = !sel || (sel.kind === "country" ? sel.code === code : sel.from === code || sel.to === code);
                return (
                  <circle key={code} cx={p[0]} cy={p[1]} r={on && sel ? 3.4 : 2.4} fill={NEON} fillOpacity={on ? 1 : 0.25} className="cursor-pointer" onClick={() => setSel({ kind: "country", code })}>
                    <title>{countryName(code)}</title>
                  </circle>
                );
              })}
            </svg>
            <p className="absolute bottom-2 left-3 right-3 text-[10.5px] leading-snug text-white/45">
              Countries are assigned by Allium&apos;s geographic attribution, not observed. Arc width is volume relative to the largest listed corridor. Domestic pairs and countries without a map position are listed but not drawn.
            </p>
          </div>

          <aside className="flex min-h-0 flex-col">
            <div className="border-b border-white/[0.06] p-4">
              {selectedCorridor ? (
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-white/45">Corridor</p>
                  <p className="mt-0.5 text-[15px] font-semibold text-white">
                    {flag(selectedCorridor.from)} {countryName(selectedCorridor.from)} → {flag(selectedCorridor.to)} {countryName(selectedCorridor.to)}
                  </p>
                  <dl className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
                    <div><dt className="text-white/45">Volume</dt><dd className="tabular-nums text-white">{usd(selectedCorridor.volumeUsd)}</dd></div>
                    <div><dt className="text-white/45">Share of listed</dt><dd className="tabular-nums text-white">{(corridorShare(corridors, selectedCorridor) * 100).toFixed(1)}%</dd></div>
                  </dl>
                </div>
              ) : selectedCountry ? (
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-white/45">Country</p>
                  <p className="mt-0.5 text-[15px] font-semibold text-white">{flag(selectedCountry.code)} {countryName(selectedCountry.code)}</p>
                  <dl className="mt-2 grid grid-cols-3 gap-2 text-[12px]">
                    <div><dt className="text-white/45">Inbound</dt><dd className="tabular-nums text-white">{usd(selectedCountry.inboundUsd)}</dd></div>
                    <div><dt className="text-white/45">Outbound</dt><dd className="tabular-nums text-white">{usd(selectedCountry.outboundUsd)}</dd></div>
                    <div><dt className="text-white/45">Corridors</dt><dd className="tabular-nums text-white">{selectedCountry.corridors}</dd></div>
                  </dl>
                </div>
              ) : (
                <p className="text-[12px] leading-relaxed text-white/55">
                  Select a corridor or a country, on the map or in the list. {corridors.length} corridor{corridors.length === 1 ? "" : "s"} across {countries.length} countr{countries.length === 1 ? "y" : "ies"}.
                </p>
              )}
              {sel && (
                <button onClick={() => setSel(null)} className="mt-2 text-[11.5px] text-[#00E599] hover:underline">
                  Clear selection
                </button>
              )}
            </div>

            <div role="tablist" aria-label="List" className="flex gap-1 px-4 pt-3">
              {tabBtn("corridors", "Corridors")}
              {tabBtn("countries", "Countries")}
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto px-2 py-2 text-[12.5px]">
              {tab === "corridors"
                ? corridors.map((c, i) => {
                    const on = selectedCorridor === c;
                    return (
                      <li key={`${c.from}-${c.to}`}>
                        <button
                          onClick={() => setSel(on ? null : { kind: "corridor", from: c.from, to: c.to })}
                          aria-pressed={on}
                          className={`grid w-full grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-1.5 text-left ${on ? "bg-[#00E599]/[0.10]" : "hover:bg-white/[0.04]"}`}
                        >
                          <span className="text-[11px] tabular-nums text-white/40">{i + 1}</span>
                          <span className="truncate text-white/90">
                            {flag(c.from)} {c.from} → {flag(c.to)} {c.to}
                          </span>
                          <span className="tabular-nums text-white">{usd(c.volumeUsd)}</span>
                        </button>
                      </li>
                    );
                  })
                : countries.map((c) => {
                    const on = selectedCountry === c;
                    return (
                      <li key={c.code}>
                        <button
                          onClick={() => setSel(on ? null : { kind: "country", code: c.code })}
                          aria-pressed={on}
                          className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-1.5 text-left ${on ? "bg-[#00E599]/[0.10]" : "hover:bg-white/[0.04]"}`}
                        >
                          <span className="truncate text-white/90">
                            {flag(c.code)} {countryName(c.code)}
                          </span>
                          <span className="tabular-nums text-white" title={`In ${usd(c.inboundUsd)} · Out ${usd(c.outboundUsd)}`}>{usd(c.touchedUsd)}</span>
                        </button>
                      </li>
                    );
                  })}
            </ul>
            <p className="border-t border-white/[0.06] px-4 py-2.5 text-[10.5px] leading-snug text-white/40">
              Source: {source}. Shares are of the corridors listed, not of all stablecoin volume: the query does not report volume with no country.
              {unplaced.length > 0 ? ` ${unplaced.length} listed corridor${unplaced.length === 1 ? " has" : "s have"} no map position.` : ""}
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}
