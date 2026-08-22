"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Flame, Grid3X3, LayoutGrid, List, MoreHorizontal, Search, Star } from "lucide-react";
import BottomNav from "@/components/BottomNav";
import Heatmap from "@/components/Heatmap";
import { useSession } from "@/components/auth/SessionProvider";
import DesktopNav from "./DesktopNav";
import MarketsTopBar from "./MarketsTopBar";
import MarketOverview, { type IndexItem } from "./MarketOverview";
import TrendingToday from "./TrendingToday";
import CollectionsRail from "./CollectionsRail";
import AssetTable from "./AssetTable";
import FilterPopover, { EMPTY_FILTERS, type FilterValues } from "./FilterPopover";
import Pagination from "./Pagination";
import MarketMovers from "./MarketMovers";
import PortfolioSnapshot from "./PortfolioSnapshot";
import NewsInsights from "./NewsInsights";
import WhyFurlPay from "./WhyFurlPay";
import LiveStatus from "./LiveStatus";
import { useWatchlist } from "./useWatchlist";
import {
  defaultDirFor,
  isSortKey,
  type AssetKindFilter,
  type SortDir,
  type SortKey,
  type TableRow,
} from "@/lib/markets/table";

// ---------------------------------------------------------------------------
// The Markets workspace.
//
// THE DATA MODEL, because it is what makes the page feel instant rather than
// merely correct. Two fetches, with different jobs:
//
//   /api/markets/table?pageSize=500   ONE request for the whole catalog. At
//                                     ~390 rows with a 40-point sparkline each
//                                     this is a few hundred KB, fetched once
//                                     and refreshed on a timer. Paging,
//                                     sorting, filtering and the two rails then
//                                     run in memory — a page change is a slice,
//                                     not a round trip, and the rails cannot
//                                     disagree with the table because they read
//                                     the same array.
//
//   /api/markets/indices              the six index cards.
//
// Server-side search still exists and is still the right tool for the ~13,000
// symbol universe: the header's GlobalSearch calls /api/markets/search and
// navigates. The in-table search field filters the loaded catalog, which is the
// set the table is showing.
//
// STATE LIVES IN THE URL. Tab, sort, page, collection and view are all query
// parameters, so a filtered table survives a reload, a back button and being
// pasted into a message. Only the transient things — the draft filter popover,
// the search box — are local.
// ---------------------------------------------------------------------------

type Tab = "all" | "stock" | "etf" | "crypto";
type View = "list" | "heatmap" | "grid";
type Panel = "assets" | "watchlist";

const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "stock", label: "Stocks" },
  { id: "etf", label: "ETFs" },
  { id: "crypto", label: "Crypto" },
];

const SORT_LABELS: Record<SortKey, string> = {
  popularity: "Popularity",
  price: "Price",
  change: "24h Change",
  change7d: "7D Change",
  marketCap: "Market Cap",
  volume: "Volume",
  name: "Name",
};

const PAGE_SIZE = 25;
/** One request covers the catalog; the server caps pageSize at 100 per page,
 *  so the client asks for pages of 100 and stitches them. */
const FETCH_PAGE = 100;
const REFRESH_MS = 60_000;

interface TableResponse {
  items: TableRow[];
  total: number;
  page: number;
  pageCount: number;
  catalogTotal: number;
  extrasAvailable: boolean;
  asOf: string;
}

export default function MarketsWorkspace() {
  const router = useRouter();
  const params = useSearchParams();
  const { status: sessionStatus } = useSession();
  const watchlist = useWatchlist();

  // ── URL-backed state ──────────────────────────────────────────────────
  const tab = (params.get("tab") as Tab) || "all";
  const view = (params.get("view") as View) || "list";
  const panel: Panel = params.get("panel") === "watchlist" ? "watchlist" : "assets";
  const collection = params.get("collection");
  const sortParam = params.get("sort");
  const sort: SortKey = isSortKey(sortParam) ? sortParam : "popularity";
  const dir: SortDir = params.get("dir") === "asc" ? "asc" : params.get("dir") === "desc" ? "desc" : defaultDirFor(sort);
  const page = Math.max(1, Number(params.get("page")) || 1);

  // ── Local state ───────────────────────────────────────────────────────
  const [all, setAll] = useState<TableRow[] | null>(null);
  const [meta, setMeta] = useState<{ catalogTotal: number; asOf: string } | null>(null);
  const [indices, setIndices] = useState<IndexItem[] | null>(null);
  const [universeSize, setUniverseSize] = useState<number | undefined>();
  const [tableQuery, setTableQuery] = useState("");
  const [filters, setFilters] = useState<FilterValues>(EMPTY_FILTERS);
  const [loading, setLoading] = useState(true);
  const tableTop = useRef<HTMLDivElement>(null);

  /** Rewrite the query string, preserving everything not being changed. */
  const setParams = useCallback(
    (patch: Record<string, string | null>, opts: { resetPage?: boolean } = {}) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) next.delete(k);
        else next.set(k, v);
      }
      // Any change to what the table CONTAINS invalidates the page number —
      // staying on page 9 of a filter that now has 2 pages shows an empty
      // table, which reads as a failed load.
      if (opts.resetPage !== false) next.delete("page");
      router.replace(`/markets${next.toString() ? `?${next}` : ""}`, { scroll: false });
    },
    [params, router]
  );

  // ── Load the catalog ──────────────────────────────────────────────────
  const load = useCallback(async () => {
    try {
      const first = await fetchPage(1);
      if (!first) return;
      let rows = first.items;
      // Stitch the remaining pages. Sequential, and bounded by pageCount, so a
      // catalog that grows does not turn into an unbounded fan-out.
      for (let p = 2; p <= first.pageCount; p++) {
        const next = await fetchPage(p);
        if (!next) break;
        rows = rows.concat(next.items);
      }
      setAll(rows);
      setMeta({ catalogTotal: first.catalogTotal, asOf: first.asOf });
    } catch {
      // Keep whatever is already on screen. Blanking a populated table because
      // one refresh failed is worse than showing prices a minute old — the
      // LiveStatus chip keeps counting, so the staleness stays visible.
      setAll((prev) => prev ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    const run = () =>
      fetch("/api/markets/indices", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
        .then((d: { items: IndexItem[] }) => {
          if (!cancelled) setIndices(d.items);
        })
        .catch(() => {});
    void run();
    const id = setInterval(run, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // The real tradable-universe size, for the search placeholder. One request,
  // never a hardcoded number.
  useEffect(() => {
    fetch("/api/markets/search?q=a&limit=1", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: { universe?: { tradable?: number } }) => setUniverseSize(d.universe?.tradable))
      .catch(() => {});
  }, []);

  // ── Derived views over the loaded catalog ─────────────────────────────

  /** Rows that are up on the day, for Trending. Nulls excluded, never as 0. */
  const trending = useMemo(() => {
    if (!all) return null;
    return [...all]
      .filter((r) => r.changePct != null && r.category !== "Stablecoin")
      .sort((a, b) => (b.changePct as number) - (a.changePct as number));
  }, [all]);

  /** The table's rows: tab + collection + panel + filters + query, then sort. */
  const filtered = useMemo(() => {
    if (!all) return [];
    let rows = all;

    if (tab !== "all") rows = rows.filter((r) => r.kind === (tab as AssetKindFilter));

    if (panel === "watchlist") rows = rows.filter((r) => watchlist.has(r.symbol));

    if (collection) {
      const col = COLLECTION_SYMBOLS.get(collection);
      if (col) rows = rows.filter((r) => col.has(r.symbol));
    }

    if (filters.kinds.length) {
      const set = new Set(filters.kinds);
      rows = rows.filter((r) => set.has(r.kind));
    }
    if (filters.performance) {
      rows = rows.filter((r) => {
        if (r.changePct == null) return false;
        return filters.performance === "gainers" ? r.changePct > 0 : r.changePct < 0;
      });
    }
    if (filters.capBands.length) {
      rows = rows.filter((r) => {
        if (r.marketCap == null) return false;
        return filters.capBands.some((b) =>
          b === "large" ? r.marketCap! >= 10e9 : b === "mid" ? r.marketCap! >= 2e9 && r.marketCap! < 10e9 : r.marketCap! < 2e9
        );
      });
    }
    const bound = (v: string) => (v.trim() === "" ? null : Number(v));
    const pMin = bound(filters.priceMin);
    const pMax = bound(filters.priceMax);
    const vMin = bound(filters.volumeMin);
    const vMax = bound(filters.volumeMax);
    if (pMin != null) rows = rows.filter((r) => r.price != null && r.price >= pMin);
    if (pMax != null) rows = rows.filter((r) => r.price != null && r.price <= pMax);
    if (vMin != null) rows = rows.filter((r) => r.volume24h != null && r.volume24h >= vMin);
    if (vMax != null) rows = rows.filter((r) => r.volume24h != null && r.volume24h <= vMax);

    const q = tableQuery.trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) =>
        `${r.symbol} ${r.name} ${r.category ?? ""}`.toLowerCase().includes(q)
      );
    }

    // Sort. Nulls sink in both directions — an unknown market cap is not the
    // smallest one.
    const sign = dir === "asc" ? 1 : -1;
    const valueOf = (r: TableRow): number | null =>
      sort === "price" ? r.price
      : sort === "change" ? r.changePct
      : sort === "change7d" ? r.changePct7d
      : sort === "marketCap" ? r.marketCap
      : sort === "volume" ? r.volume24h
      : sort === "popularity" ? r.rank
      : null;

    return [...rows].sort((a, b) => {
      if (sort === "name") return sign * a.symbol.localeCompare(b.symbol);
      const va = valueOf(a);
      const vb = valueOf(b);
      if (va == null && vb == null) return a.rank - b.rank;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (va === vb) return a.rank - b.rank;
      return sign * (va - vb);
    });
  }, [all, tab, panel, collection, filters, tableQuery, sort, dir, watchlist]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRows = useMemo(
    () => filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filtered, currentPage]
  );

  const anyLive = all?.some((r) => r.live) ?? false;

  function onSort(key: SortKey) {
    // Same column toggles direction; a new column starts at its natural one.
    const nextDir: SortDir = key === sort ? (dir === "asc" ? "desc" : "asc") : defaultDirFor(key);
    setParams({ sort: key, dir: nextDir });
  }

  function goToTable() {
    tableTop.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const showDiscovery = panel === "assets" && view === "list" && !collection && !tableQuery;

  return (
    <div className="bg-oled flex min-h-screen">
      <DesktopNav />

      <div className="min-w-0 flex-1">
        <MarketsTopBar universeSize={universeSize} live={anyLive} asOf={meta?.asOf ?? null} />

        <div className="mx-auto flex w-full max-w-[1440px] gap-8 px-5 pb-28 pt-6 lg:px-8 lg:pb-12 2xl:px-12">
          {/* ── Main workspace ─────────────────────────────────────────── */}
          <main className="min-w-0 flex-1">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="text-[34px] font-bold leading-none tracking-tighter text-textPrimary">
                  Markets
                </h1>
                <p className="mt-1.5 text-[12.5px] text-textSecondary">
                  Global markets. Real-time. All in one place.
                </p>
              </div>
              <LiveStatus live={anyLive} asOf={meta?.asOf ?? null} className="sm:hidden" />
            </div>

            {/* Category filters + quick controls */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <div className="rail-scroll flex gap-1.5 overflow-x-auto">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={tab === t.id}
                    onClick={() => setParams({ tab: t.id === "all" ? null : t.id })}
                    className={`h-8 shrink-0 rounded-full px-3.5 text-[12.5px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                      tab === t.id
                        ? "bg-white text-black"
                        : "border border-white/[0.08] text-textSecondary hover:border-white/20 hover:text-white"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
                <Link
                  href="/markets/chains"
                  className="flex h-8 shrink-0 items-center rounded-full border border-white/[0.08] px-3.5 text-[12.5px] font-semibold text-textSecondary transition-colors hover:border-white/20 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  Chains
                </Link>
              </div>

              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                <QuickButton
                  active={panel === "watchlist"}
                  onClick={() => setParams({ panel: panel === "watchlist" ? null : "watchlist" })}
                  Icon={Star}
                  label="Watchlist"
                />
                <QuickButton
                  active={sort === "change" && dir === "desc"}
                  onClick={() => setParams({ sort: "change", dir: "desc" })}
                  Icon={Flame}
                  label="Top Movers"
                />
                <QuickButton
                  active={view === "heatmap"}
                  onClick={() => setParams({ view: view === "heatmap" ? null : "heatmap" })}
                  Icon={Grid3X3}
                  label="Heatmap"
                />
                <Link
                  href="/markets/collections/ai-robotics"
                  aria-label="More market views"
                  className="grid h-8 w-8 place-items-center rounded-full border border-white/[0.08] text-textSecondary transition-colors hover:border-white/20 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Link>
              </div>
            </div>

            {/* Index strip */}
            <div className="mt-3.5">
              <MarketOverview items={indices} loading={!indices} />
            </div>

            {showDiscovery && (
              <>
                <TrendingToday
                  rows={trending}
                  loading={loading}
                  onSeeAll={() => {
                    setParams({ sort: "change", dir: "desc" });
                    goToTable();
                  }}
                />
                <CollectionsRail
                  rows={all}
                  activeSlug={collection}
                  onSelect={(slug) => {
                    setParams({ collection: slug });
                    goToTable();
                  }}
                />
              </>
            )}

            {/* ── Assets ──────────────────────────────────────────────── */}
            <section ref={tableTop} className="mt-7 scroll-mt-20" aria-labelledby="assets-heading">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] pb-2">
                <div className="flex items-center gap-4">
                  <PanelTab
                    active={panel === "assets"}
                    onClick={() => setParams({ panel: null })}
                    label="All Assets"
                  />
                  <PanelTab
                    active={panel === "watchlist"}
                    onClick={() => setParams({ panel: "watchlist" })}
                    label="Watchlist"
                    count={watchlist.loading ? undefined : watchlist.count}
                  />
                </div>
                <p id="assets-heading" className="text-[11.5px] text-textMuted font-mono">
                  {loading && !all
                    ? "Loading…"
                    : `${filtered.length.toLocaleString("en-US")} of ${(meta?.catalogTotal ?? 0).toLocaleString("en-US")} assets`}
                </p>
              </div>

              {collection && (
                <div className="mt-2.5 flex items-center gap-2">
                  <span className="rounded-full border border-accent/40 bg-accent/[0.1] px-2.5 py-1 text-[11.5px] font-semibold text-accent">
                    {COLLECTION_TITLES.get(collection) ?? collection}
                  </span>
                  <button
                    type="button"
                    onClick={() => setParams({ collection: null })}
                    className="text-[11.5px] font-semibold text-textSecondary hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    Clear
                  </button>
                </div>
              )}

              {/* Controls */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <label className="flex h-9 min-w-[180px] flex-1 items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 transition-colors focus-within:border-accent/40 sm:max-w-[280px]">
                  <Search className="h-3.5 w-3.5 shrink-0 text-textMuted" aria-hidden />
                  <input
                    type="search"
                    value={tableQuery}
                    onChange={(e) => {
                      setTableQuery(e.target.value);
                      if (page !== 1) setParams({});
                    }}
                    placeholder="Search assets…"
                    aria-label="Filter the assets in this table"
                    className="min-w-0 flex-1 bg-transparent text-[12.5px] text-white outline-none placeholder:text-textMuted [&::-webkit-search-cancel-button]:hidden"
                  />
                </label>

                <label className="flex h-9 items-center gap-1.5 rounded-lg border border-white/[0.08] px-2.5 text-[12px] text-textSecondary">
                  <span className="whitespace-nowrap">Sort:</span>
                  <select
                    value={sort}
                    onChange={(e) => setParams({ sort: e.target.value, dir: defaultDirFor(e.target.value as SortKey) })}
                    aria-label="Sort assets by"
                    className="bg-transparent font-semibold text-white outline-none [&>option]:bg-surface"
                  >
                    {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                      <option key={k} value={k}>
                        {SORT_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </label>

                <FilterPopover value={filters} onApply={setFilters} />

                <QuickChip
                  active={filters.performance === "gainers"}
                  onClick={() =>
                    setFilters((f) => ({
                      ...f,
                      performance: f.performance === "gainers" ? null : "gainers",
                    }))
                  }
                  label="Top Gainers"
                />
                <QuickChip
                  active={filters.performance === "losers"}
                  onClick={() =>
                    setFilters((f) => ({
                      ...f,
                      performance: f.performance === "losers" ? null : "losers",
                    }))
                  }
                  label="Top Losers"
                />
                <QuickChip
                  active={sort === "volume"}
                  onClick={() => setParams({ sort: "volume", dir: "desc" })}
                  label="Most Active"
                />

                <div className="ml-auto flex gap-0.5 rounded-lg border border-white/[0.08] p-0.5">
                  {(
                    [
                      ["list", List],
                      ["grid", LayoutGrid],
                    ] as const
                  ).map(([id, Icon]) => (
                    <button
                      key={id}
                      type="button"
                      aria-label={`${id} view`}
                      aria-pressed={view === id}
                      onClick={() => setParams({ view: id === "list" ? null : id })}
                      className={`grid h-7 w-7 place-items-center rounded-md transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
                        view === id ? "bg-white/[0.1] text-white" : "text-textMuted hover:text-white"
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </button>
                  ))}
                </div>
              </div>

              {watchlist.error && (
                <p role="alert" className="mt-2 text-[12px] font-medium text-loss">
                  {watchlist.error}
                </p>
              )}

              {/* The assets themselves */}
              {view === "heatmap" ? (
                <div className="mt-4">
                  <Heatmap
                    items={filtered
                      .filter((f) => f.category !== "Stablecoin" && f.changePct != null && f.price != null)
                      .slice(0, 80)
                      .map((f) => ({
                        symbol: f.symbol,
                        name: f.name,
                        kind: f.kind,
                        cap: capTierFor(f.marketCap),
                        price: f.price as number,
                        changePct: f.changePct as number,
                      }))}
                    onSelect={(sym) => router.push(`/markets/${sym}`)}
                  />
                  <p className="mt-3 text-center text-[11px] text-textMuted">
                    Block size = market cap tier · colour = day move
                  </p>
                </div>
              ) : view === "grid" ? (
                <GridView rows={pageRows} />
              ) : (
                <AssetTable
                  rows={pageRows}
                  loading={loading}
                  startIndex={(currentPage - 1) * PAGE_SIZE + 1}
                  sort={sort}
                  dir={dir}
                  onSort={onSort}
                  isStarred={watchlist.has}
                  onToggleStar={(symbol) => {
                    void watchlist.toggle(symbol).then((handled) => {
                      // Not handled → no session. Take them to sign-in; the
                      // symbol is already parked and replays on return.
                      if (!handled) router.push(`/login?next=${encodeURIComponent("/markets")}`);
                    });
                  }}
                  canTrade={sessionStatus === "authenticated"}
                  emptyState={
                    panel === "watchlist" ? (
                      <WatchlistEmpty
                        authed={sessionStatus === "authenticated"}
                        onExplore={() => setParams({ panel: null })}
                      />
                    ) : undefined
                  }
                />
              )}

              {view !== "heatmap" && (
                <Pagination
                  page={currentPage}
                  pageCount={pageCount}
                  onChange={(p) => {
                    setParams({ page: String(p) }, { resetPage: false });
                    goToTable();
                  }}
                />
              )}
            </section>

            <WhyFurlPay />
          </main>

          {/* ── Intelligence rail ──────────────────────────────────────── */}
          <aside className="hidden w-[372px] shrink-0 xl:block" aria-label="Market intelligence">
            <div className="sticky top-6 space-y-5">
              <MarketMovers
                rows={all}
                loading={loading}
                onViewAll={(t) => {
                  if (t === "volume") setParams({ sort: "volume", dir: "desc" });
                  else setParams({ sort: "change", dir: t === "gainers" ? "desc" : "asc" });
                  goToTable();
                }}
              />
              <PortfolioSnapshot />
              <NewsInsights />
            </div>
          </aside>
        </div>

        <div className="lg:hidden">
          <BottomNav />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

async function fetchPage(page: number): Promise<TableResponse | null> {
  const res = await fetch(`/api/markets/table?page=${page}&pageSize=${FETCH_PAGE}`, {
    cache: "no-store",
  });
  if (!res.ok) return null;
  return (await res.json()) as TableResponse;
}

/** Cap tier from a real market cap, for the heatmap's block sizing. Unknown
 *  caps fall to "small" — the smallest block, so an unknown never dominates
 *  the picture on the strength of a value we do not have. */
function capTierFor(marketCap: number | null): "mega" | "large" | "mid" | "small" {
  if (marketCap == null) return "small";
  if (marketCap >= 200e9) return "mega";
  if (marketCap >= 10e9) return "large";
  if (marketCap >= 2e9) return "mid";
  return "small";
}

function QuickButton({
  active,
  onClick,
  Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  Icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
        active
          ? "border-accent/45 bg-accent/[0.1] text-accent"
          : "border-white/[0.08] text-textSecondary hover:border-white/20 hover:text-white"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function QuickChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`h-9 rounded-lg border px-2.5 text-[12px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
        active
          ? "border-accent/45 bg-accent/[0.1] text-accent"
          : "border-white/[0.08] text-textSecondary hover:border-white/20 hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}

function PanelTab({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`relative flex items-center gap-1.5 pb-2 text-[15px] font-bold tracking-tight transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
        active ? "text-white" : "text-textMuted hover:text-textSecondary"
      }`}
    >
      {label}
      {count !== undefined && (
        <span className="rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[11px] font-bold text-textSecondary font-mono">
          {count}
        </span>
      )}
      {active && <span className="absolute -bottom-[9px] left-0 right-0 h-0.5 rounded-full bg-accent" />}
    </button>
  );
}

function WatchlistEmpty({ authed, onExplore }: { authed: boolean; onExplore: () => void }) {
  return (
    <div className="py-14 text-center">
      <Star className="mx-auto h-7 w-7 text-white/15" aria-hidden />
      <p className="mt-3 text-[14px] font-semibold text-white">
        {authed ? "Your watchlist is empty." : "Sign in to save assets."}
      </p>
      <p className="mt-1 text-[12.5px] text-textMuted">
        {authed
          ? "Star any asset to track it here."
          : "Star an asset and we'll add it as soon as you sign in."}
      </p>
      <button
        type="button"
        onClick={onExplore}
        className="mt-4 rounded-lg bg-accent px-4 py-2 text-[12.5px] font-bold text-[#04202a] transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        Explore Markets
      </button>
    </div>
  );
}

function GridView({ rows }: { rows: TableRow[] }) {
  return (
    <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
      {rows.map((r) => {
        const up = r.changePct != null && r.changePct >= 0;
        return (
          <Link
            key={`${r.kind}:${r.symbol}`}
            href={`/markets/${encodeURIComponent(r.symbol)}`}
            className="surface-card surface-card-interactive p-3.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <p className="truncate text-[13.5px] font-bold text-white">{r.symbol}</p>
            <p className="truncate text-[11px] text-textMuted">{r.name}</p>
            <p className="mt-2 text-[15px] font-semibold tracking-tight text-white font-mono">
              {r.price == null ? "—" : r.price >= 1 ? `$${r.price.toFixed(2)}` : `$${r.price.toPrecision(3)}`}
            </p>
            <p
              className={`text-[12px] font-semibold font-mono ${
                r.changePct == null ? "text-textMuted" : up ? "text-gain" : "text-loss"
              }`}
            >
              {r.changePct == null ? "—" : `${r.changePct >= 0 ? "+" : ""}${r.changePct.toFixed(2)}%`}
            </p>
          </Link>
        );
      })}
    </div>
  );
}

// Collection lookups, built once at module load rather than per render.
import { COLLECTIONS } from "@/lib/markets/collections";
const COLLECTION_SYMBOLS = new Map(COLLECTIONS.map((c) => [c.slug, new Set(c.symbols)]));
const COLLECTION_TITLES = new Map(COLLECTIONS.map((c) => [c.slug, c.title]));
