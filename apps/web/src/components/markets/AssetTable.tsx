"use client";

import { memo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { AssetLogo } from "@furlpay/ui";
import { fmtPrice } from "@/components/AssetRow";
import Sparkline from "./Sparkline";
import WatchStar from "./WatchStar";
import { DASH, fmtCountCompact, fmtMoneyCompact, fmtPctSigned } from "./format";
import type { SortDir, SortKey, TableRow } from "@/lib/markets/table";

// ---------------------------------------------------------------------------
// The asset table.
//
// A real <table> with a real <thead>, not a grid of divs. Screen readers
// announce "column 4 of 9, 24h change" from the semantics, sortable headers get
// `aria-sort`, and the browser handles column alignment — all of which a
// div-grid has to reimplement badly.
//
// TWO LAYOUTS, ONE DATA SET. Below `lg` the table is replaced by a card list;
// nine columns cannot be squeezed into 380px, and the usual answer — a
// horizontally scrolling table — hides the price behind a swipe on a phone.
// The cards carry the same rows, minus the two columns (7d, volume) that a
// reader on a phone is least likely to be scanning for.
//
// EVERY CELL IS NULLABLE. A missing figure renders as an em-dash and a missing
// series renders as blank space of the right size. Nothing on this surface is
// defaulted to zero, because a $0.00 price and a +0.00% move both read as
// statements of fact.
// ---------------------------------------------------------------------------

export interface AssetTableProps {
  rows: TableRow[];
  loading: boolean;
  /** 1-based index of the first row on this page, for the # column. */
  startIndex: number;
  sort: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
  isStarred: (symbol: string) => boolean;
  onToggleStar: (symbol: string) => void;
  /** Whether the acting user can actually place an order. */
  canTrade: boolean;
  emptyState?: React.ReactNode;
}

interface Column {
  key: SortKey | null;
  label: string;
  className: string;
  /** Hidden below xl, where the viewport cannot carry nine columns. */
  wide?: boolean;
}

const COLUMNS: Column[] = [
  { key: null, label: "#", className: "w-[52px] pl-3 text-left" },
  { key: "name", label: "Asset", className: "text-left" },
  { key: "price", label: "Price", className: "w-[110px] text-right" },
  { key: "change", label: "24h %", className: "w-[86px] text-right" },
  { key: "change7d", label: "7D %", className: "w-[86px] text-right", wide: true },
  { key: "marketCap", label: "Market Cap", className: "w-[104px] text-right" },
  { key: "volume", label: "Volume (24h)", className: "w-[110px] text-right", wide: true },
  { key: null, label: "Chart", className: "w-[92px] text-center" },
  { key: null, label: "Actions", className: "w-[118px] pr-3 text-right" },
];

const KIND_LABEL: Record<TableRow["kind"], string> = {
  stock: "Stock",
  etf: "ETF",
  crypto: "Crypto",
  // The row's own category says which kind of instrument ("Precious metal",
  // "Currency pair"), so this badge only has to say it is not a security.
  instrument: "Market",
};

export default function AssetTable({
  rows,
  loading,
  startIndex,
  sort,
  dir,
  onSort,
  isStarred,
  onToggleStar,
  canTrade,
  emptyState,
}: AssetTableProps) {
  if (loading && rows.length === 0) {
    return (
      <div className="mt-2 space-y-1" aria-busy="true" aria-label="Loading assets">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="h-[52px] animate-pulse rounded-lg bg-white/[0.03]" aria-hidden />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return <>{emptyState ?? <p className="py-14 text-center text-[13px] text-textMuted">No assets match these filters.</p>}</>;
  }

  return (
    <>
      {/* ── Desktop: the table ─────────────────────────────────────────── */}
      <div className="mt-1 hidden lg:block">
        <table className="w-full border-collapse">
          <caption className="sr-only">
            Assets with price, 24-hour and 7-day change, market capitalisation and volume
          </caption>
          <thead>
            <tr className="border-b border-white/[0.07]">
              {COLUMNS.map((col) => {
                const active = col.key != null && col.key === sort;
                return (
                  <th
                    key={col.label}
                    scope="col"
                    aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined}
                    className={`${col.className} ${col.wide ? "hidden xl:table-cell" : ""} py-2 text-[11px] font-semibold text-textMuted`}
                  >
                    {col.key ? (
                      <button
                        type="button"
                        onClick={() => onSort(col.key as SortKey)}
                        className={`inline-flex items-center gap-1 rounded transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                          active ? "text-accent" : ""
                        }`}
                      >
                        {col.label}
                        {active && (
                          <span aria-hidden className="text-[8px]">
                            {dir === "asc" ? "▲" : "▼"}
                          </span>
                        )}
                      </button>
                    ) : (
                      col.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <AssetTableRow
                key={`${row.kind}:${row.symbol}`}
                row={row}
                index={startIndex + i}
                starred={isStarred(row.symbol)}
                onToggleStar={onToggleStar}
                canTrade={canTrade}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Below lg: cards ────────────────────────────────────────────── */}
      <ul className="mt-1 lg:hidden">
        {rows.map((row, i) => (
          <AssetCard
            key={`${row.kind}:${row.symbol}`}
            row={row}
            index={startIndex + i}
            starred={isStarred(row.symbol)}
            onToggleStar={onToggleStar}
          />
        ))}
      </ul>
    </>
  );
}

// ---------------------------------------------------------------------------
// One row. Memoised on the fields it renders: a page of 25 rows re-renders on
// every watchlist toggle otherwise, and each row carries an SVG chart.
// ---------------------------------------------------------------------------

const AssetTableRow = memo(function AssetTableRow({
  row,
  index,
  starred,
  onToggleStar,
  canTrade,
}: {
  row: TableRow;
  index: number;
  starred: boolean;
  onToggleStar: (symbol: string) => void;
  canTrade: boolean;
}) {
  const router = useRouter();
  const href = `/markets/${encodeURIComponent(row.symbol)}`;
  const up24 = row.changePct != null && row.changePct >= 0;
  const up7 = row.changePct7d != null && row.changePct7d >= 0;

  return (
    <tr
      // The whole row is clickable, but the accessible control is the symbol
      // link in the Asset cell — a <tr> cannot be a link, and giving it a
      // tabindex would put a second, unlabelled stop in the tab order for
      // every row on the page.
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest("a, button")) return;
        router.push(href);
      }}
      className="group cursor-pointer border-b border-white/[0.05] transition-colors hover:bg-white/[0.03]"
    >
      <td className="w-[52px] py-2 pl-3">
        <span className="flex items-center gap-1">
          <WatchStar symbol={row.symbol} starred={starred} onToggle={onToggleStar} size={14} />
          <span className="text-[11.5px] text-textMuted font-mono">{index}</span>
        </span>
      </td>

      <td className="py-2">
        <span className="flex items-center gap-2.5">
          <AssetLogo src={row.logo} label={row.symbol} size={28} className="shrink-0" />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5">
              <Link
                href={href}
                onClick={(e) => e.stopPropagation()}
                className="truncate text-[13px] font-bold text-white hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {row.symbol}
              </Link>
              <span className="shrink-0 rounded border border-white/[0.09] px-1 py-px text-[9.5px] font-semibold text-textMuted">
                {row.category ?? KIND_LABEL[row.kind]}
              </span>
            </span>
            <span className="block max-w-[220px] truncate text-[11px] text-textMuted">{row.name}</span>
          </span>
        </span>
      </td>

      <td className="w-[110px] py-2 text-right text-[12.5px] font-semibold text-white font-mono">
        {fmtPrice(row.price)}
      </td>

      <td
        className={`w-[86px] py-2 text-right text-[12.5px] font-semibold font-mono ${
          row.changePct == null ? "text-textMuted" : up24 ? "text-gain" : "text-loss"
        }`}
      >
        {fmtPctSigned(row.changePct)}
      </td>

      <td
        className={`hidden w-[86px] py-2 text-right text-[12.5px] font-semibold font-mono xl:table-cell ${
          row.changePct7d == null ? "text-textMuted" : up7 ? "text-gain" : "text-loss"
        }`}
      >
        {fmtPctSigned(row.changePct7d)}
      </td>

      <td className="w-[104px] py-2 text-right text-[12.5px] text-textSecondary font-mono">
        {row.marketCap == null ? DASH : fmtMoneyCompact(row.marketCap)}
      </td>

      <td className="hidden w-[110px] py-2 text-right text-[12.5px] text-textSecondary font-mono xl:table-cell">
        {row.volume24h == null
          ? DASH
          : // Crypto volume is a USD figure; equity volume is a share count.
            // Rendering both with a "$" would misstate one of them.
            row.kind === "crypto"
            ? fmtMoneyCompact(row.volume24h)
            : fmtCountCompact(row.volume24h)}
      </td>

      <td className="w-[92px] py-2 text-center">
        <Sparkline points={row.spark} width={76} height={26} interactive />
      </td>

      <td className="w-[118px] py-2 pr-3">
        <span className="flex items-center justify-end gap-1">
          <Link
            href={canTrade ? `${href}?action=trade` : `/login?next=${encodeURIComponent(href)}`}
            onClick={(e) => e.stopPropagation()}
            className="rounded-lg border border-white/[0.1] px-2.5 py-1 text-[11.5px] font-semibold text-white/80 transition-colors hover:border-accent/50 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Trade
          </Link>
          <Link
            href={href}
            onClick={(e) => e.stopPropagation()}
            aria-label={`More about ${row.name}`}
            className="grid h-6 w-6 place-items-center rounded-lg text-textMuted transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Link>
        </span>
      </td>
    </tr>
  );
});

// ---------------------------------------------------------------------------
// The phone card. Four figures, one chart, a 44px-plus tap target.
// ---------------------------------------------------------------------------

const AssetCard = memo(function AssetCard({
  row,
  index,
  starred,
  onToggleStar,
}: {
  row: TableRow;
  index: number;
  starred: boolean;
  onToggleStar: (symbol: string) => void;
}) {
  const up = row.changePct != null && row.changePct >= 0;
  return (
    <li className="border-b border-white/[0.05]">
      <Link
        href={`/markets/${encodeURIComponent(row.symbol)}`}
        className="flex items-center gap-2.5 py-2.5 transition-colors hover:bg-white/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <WatchStar symbol={row.symbol} starred={starred} onToggle={onToggleStar} size={15} />
        <span className="w-4 shrink-0 text-[11px] text-textMuted font-mono">{index}</span>
        <AssetLogo src={row.logo} label={row.symbol} size={32} className="shrink-0" />

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-bold text-white">{row.symbol}</span>
          <span className="block truncate text-[11px] text-textMuted">{row.name}</span>
        </span>

        <Sparkline points={row.spark} width={54} height={24} className="hidden shrink-0 sm:block" />

        <span className="shrink-0 text-right">
          <span className="block text-[13px] font-semibold text-white font-mono">
            {fmtPrice(row.price)}
          </span>
          <span
            className={`block text-[11.5px] font-semibold font-mono ${
              row.changePct == null ? "text-textMuted" : up ? "text-gain" : "text-loss"
            }`}
          >
            {fmtPctSigned(row.changePct)}
          </span>
        </span>
      </Link>
    </li>
  );
});
