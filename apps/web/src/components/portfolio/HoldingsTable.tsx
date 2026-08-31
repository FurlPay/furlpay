"use client";

import { useMemo, useState } from "react";
import { ArrowUpDown, Search } from "lucide-react";
import { AssetLogo } from "@furlpay/ui";
import { assetLogoPath, bySymbol } from "@/lib/markets/catalog";
import type { AssetClass, PositionRow } from "@/lib/portfolioMetrics";
import { Card, Delta, money } from "./primitives";

// ---------------------------------------------------------------------------
// The holdings table.
//
// A real <table> with a real <thead>, not a grid of divs: a screen reader
// announces "row 3 of 8, Market Value, $1,063.96" only if the markup says so,
// and this is the densest data on the page.
//
// Sorting is on the header buttons themselves with aria-sort, which is what a
// keyboard user reaches first. Below `lg` the table scrolls horizontally inside
// its own container rather than the page — a horizontally scrolling PAGE on a
// phone breaks every other module on it.
// ---------------------------------------------------------------------------

const CLASS_TABS = ["All", "Stocks", "ETFs", "Crypto"] as const;
type ClassTab = (typeof CLASS_TABS)[number];

type SortKey = "symbol" | "shares" | "avgPrice" | "price" | "marketValue" | "weight" | "changePct" | "unrealizedPct";

const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: "symbol", label: "Asset", numeric: false },
  { key: "shares", label: "Shares", numeric: true },
  { key: "avgPrice", label: "Avg. Price", numeric: true },
  { key: "price", label: "Current Price", numeric: true },
  { key: "marketValue", label: "Market Value", numeric: true },
  { key: "weight", label: "Allocation", numeric: true },
  { key: "changePct", label: "Day's Change", numeric: true },
  { key: "unrealizedPct", label: "Total Return", numeric: true },
];

export default function HoldingsTable({
  positions,
  onSelect,
}: {
  positions: PositionRow[];
  onSelect: (p: PositionRow) => void;
}) {
  const [tab, setTab] = useState<ClassTab>("All");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "marketValue",
    dir: "desc",
  });

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = positions.filter((p) => {
      if (tab !== "All" && p.assetClass !== (tab as AssetClass)) return false;
      if (!q) return true;
      return p.symbol.toLowerCase().includes(q) || p.name.toLowerCase().includes(q);
    });
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * dir;
      return ((av as number) - (bv as number)) * dir;
    });
  }, [positions, tab, query, sort]);

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 px-4 pt-4">
        <h2 className="text-[14.5px] font-semibold tracking-tight text-white">Holdings</h2>

        <div role="tablist" aria-label="Asset class" className="flex gap-1">
          {CLASS_TABS.map((t) => {
            const active = t === tab;
            return (
              <button
                key={t}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t)}
                className={`rounded-lg px-2.5 py-1.5 text-[12px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gain ${
                  active ? "bg-white/[0.1] text-white" : "text-textSecondary hover:bg-white/[0.05] hover:text-white"
                }`}
              >
                {t}
              </button>
            );
          })}
        </div>

        <label className="ml-auto flex h-8 min-w-[150px] items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.02] px-2.5 transition-colors focus-within:border-gain/50">
          <Search className="h-3.5 w-3.5 shrink-0 text-textMuted" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter holdings"
            aria-label="Filter holdings by name or ticker"
            className="min-w-0 flex-1 bg-transparent text-[12px] text-white outline-none placeholder:text-textMuted"
          />
        </label>
      </div>

      {/* The table scrolls inside this box, never the page. */}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse">
          <caption className="sr-only">
            Your holdings, sortable by column. {rows.length} of {positions.length} shown.
          </caption>
          <thead>
            <tr className="border-y border-white/[0.06]">
              {COLUMNS.map((c) => {
                const active = sort.key === c.key;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                    className={`whitespace-nowrap px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-textMuted ${
                      c.numeric ? "text-right" : "text-left"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(c.key)}
                      className={`inline-flex items-center gap-1 rounded transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gain ${
                        active ? "text-white" : ""
                      }`}
                    >
                      {c.label}
                      <ArrowUpDown className="h-3 w-3 opacity-60" aria-hidden />
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-4 py-10 text-center text-[12.5px] text-textMuted">
                  {positions.length === 0
                    ? "No holdings yet. Buy your first position from Markets."
                    : "No holdings match that filter."}
                </td>
              </tr>
            ) : (
              rows.map((p) => {
                const asset = bySymbol.get(p.symbol);
                return (
                  <tr
                    key={p.symbol}
                    tabIndex={0}
                    onClick={() => onSelect(p)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelect(p);
                      }
                    }}
                    aria-label={`${p.symbol}, ${p.name}. Open details.`}
                    className="cursor-pointer border-b border-white/[0.04] transition-colors last:border-0 hover:bg-white/[0.035] focus-visible:bg-white/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-gain"
                  >
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2.5">
                        <AssetLogo
                          src={asset ? assetLogoPath(asset) : null}
                          label={p.symbol}
                          size={26}
                          className="shrink-0"
                        />
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-semibold text-white">{p.symbol}</p>
                          <p className="truncate text-[11px] text-textMuted">{p.name}</p>
                        </div>
                      </div>
                    </td>
                    <Num>{p.shares.toLocaleString(undefined, { maximumFractionDigits: 4 })}</Num>
                    <Num>{money(p.avgPrice)}</Num>
                    <Num>{money(p.price)}</Num>
                    <Num>{money(p.marketValue)}</Num>
                    <Num>{(p.weight * 100).toFixed(1)}%</Num>
                    <td className="whitespace-nowrap px-3 py-3 text-right text-[12.5px]">
                      <Delta value={p.changePct} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right text-[12.5px]">
                      <Delta value={p.unrealizedPct} />
                      <span className="ml-1 block text-[10.5px] text-textMuted">
                        {p.unrealized >= 0 ? "+" : "−"}
                        {money(Math.abs(p.unrealized))}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="border-t border-white/[0.06] px-4 py-2.5 text-[11px] text-textMuted">
        Showing {rows.length} of {positions.length} holdings · select a row for full detail
      </p>
    </Card>
  );
}

function Num({ children }: { children: React.ReactNode }) {
  return (
    <td className="whitespace-nowrap px-3 py-3 text-right text-[12.5px] tabular-nums text-white">
      {children}
    </td>
  );
}
