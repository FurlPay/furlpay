"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, List, Grid3X3, LayoutGrid, Link2, TrendingUp, TrendingDown } from "lucide-react";
import { getJSON } from "@/lib/api";
import { PageHeader, Spinner, pct } from "@/components/ui";
import { AssetLogo } from "@furlpay/ui";
import AssetRow, { fmtPrice } from "@/components/AssetRow";
import Heatmap from "@/components/Heatmap";
import MarketIndices from "@/components/MarketIndices";
import CollectionCard from "@/components/CollectionCard";
import { COLLECTIONS } from "@/lib/markets/collections";
import { STOCK_SECTORS, CRYPTO_CATEGORIES } from "@/lib/markets/catalog";

// Markets — full discovery hub: 390+ assets, sector/category screeners, list /
// heatmap / grid views, movers and curated collections.

interface MarketItem {
  symbol: string;
  name: string;
  kind: "stock" | "etf" | "crypto";
  sector: string | null;
  industry: string | null;
  cap: string;
  chain: string | null;
  logo: string | null;
  price: number;
  changePct: number;
  live: boolean;
}

const TABS = [
  { id: "all", label: "All" },
  { id: "stock", label: "Stocks" },
  { id: "etf", label: "ETFs" },
  { id: "crypto", label: "Crypto" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const ETF_CATEGORIES = ["Broad Market", "Sector", "Bond", "Commodity", "Thematic", "Crypto-linked", "Dividend & Factor", "International"];

type ViewMode = "list" | "heatmap" | "grid";
type SortId = "movers" | "az" | "price";

export default function MarketsPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <MarketsInner />
    </Suspense>
  );
}

function MarketsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [items, setItems] = useState<MarketItem[] | null>(null);
  const [tab, setTab] = useState<TabId>((params.get("tab") as TabId) || "all");
  const [subFilter, setSubFilter] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("list");
  const [sort, setSort] = useState<SortId>("movers");
  const [q, setQ] = useState("");
  const [movers, setMovers] = useState<{ gainers: MarketItem[]; losers: MarketItem[] } | null>(null);

  const load = useCallback(() => {
    getJSON<{ items: MarketItem[] }>("/api/markets").then((r) => setItems(r.items)).catch(console.error);
    getJSON<{ gainers: MarketItem[]; losers: MarketItem[] }>("/api/markets/movers?limit=8").then(setMovers).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const filtered = useMemo(() => {
    if (!items) return [];
    const needle = q.trim().toLowerCase();
    let rows = items.filter(
      (i) =>
        (tab === "all" || i.kind === tab) &&
        (!needle ||
          i.symbol.toLowerCase().includes(needle) ||
          i.name.toLowerCase().includes(needle) ||
          i.industry?.toLowerCase().includes(needle))
    );
    if (subFilter && tab === "stock") rows = rows.filter((i) => i.sector === subFilter);
    if (subFilter && (tab === "crypto" || tab === "etf")) rows = rows.filter((i) => i.industry === subFilter);
    if (sort === "movers") rows = [...rows].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
    if (sort === "az") rows = [...rows].sort((a, b) => a.symbol.localeCompare(b.symbol));
    if (sort === "price") rows = [...rows].sort((a, b) => b.price - a.price);
    return rows;
  }, [items, tab, q, subFilter, sort]);

  if (!items) return <Spinner />;
  const anyLive = items.some((i) => i.live);
  const subChips = tab === "stock" ? STOCK_SECTORS : tab === "crypto" ? CRYPTO_CATEGORIES : tab === "etf" ? ETF_CATEGORIES : [];
  const discover = tab === "all" && !q;

  return (
    <>
      <PageHeader
        title="Markets"
        right={
          <span className="flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] font-semibold text-textSecondary">
            <span className={`h-1.5 w-1.5 rounded-full ${anyLive ? "bg-gain animate-pulse" : "bg-textMuted"}`} />
            {anyLive ? "Live prices" : "Delayed"}
          </span>
        }
      />

      {/* Search */}
      <div className="px-5">
        <div className="flex items-center gap-2 rounded-2xl bg-surface px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-textMuted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${items.length}+ stocks, ETFs & crypto`}
            className="w-full bg-transparent text-[14px] outline-none placeholder:text-textMuted"
          />
        </div>
      </div>

      {/* Tabs + view toggle */}
      <div className="mt-3 flex items-center gap-2 px-5">
        <div className="no-scrollbar flex flex-1 gap-2 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setTab(t.id);
                setSubFilter(null);
              }}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-semibold ${
                tab === t.id ? "bg-white text-black" : "bg-white/[0.06] text-textSecondary"
              }`}
            >
              {t.label}
            </button>
          ))}
          <Link
            href="/markets/chains"
            className="flex shrink-0 items-center gap-1 rounded-full bg-white/[0.06] px-3.5 py-1.5 text-[13px] font-semibold text-textSecondary"
          >
            <Link2 className="h-3.5 w-3.5" /> Chains
          </Link>
        </div>
        <div className="flex shrink-0 gap-1 rounded-full bg-white/[0.06] p-1">
          {(
            [
              ["list", List],
              ["heatmap", Grid3X3],
              ["grid", LayoutGrid],
            ] as const
          ).map(([id, Icon]) => (
            <button
              key={id}
              aria-label={`${id} view`}
              onClick={() => setView(id)}
              className={`rounded-full p-1.5 ${view === id ? "bg-white text-black" : "text-textSecondary"}`}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
      </div>

      {/* Sub-filters (sectors / categories) */}
      {subChips.length > 0 && (
        <div className="no-scrollbar mt-2.5 flex gap-1.5 overflow-x-auto px-5">
          {subChips.map((sc) => (
            <button
              key={sc}
              onClick={() => setSubFilter(subFilter === sc ? null : sc)}
              className={`shrink-0 rounded-full border px-3 py-1 text-[11.5px] font-semibold ${
                subFilter === sc ? "border-accent bg-accent/15 text-accent" : "border-white/10 text-textSecondary"
              }`}
            >
              {sc}
            </button>
          ))}
        </div>
      )}

      {/* Discover: pulse, movers & collections (default view only) */}
      {discover && view === "list" && (
        <>
          <div className="mt-4">
            <MarketIndices showSentiment={false} />
          </div>

          {movers && (
            <section className="mt-5">
              <h2 className="mb-2 px-5 text-[15px] font-bold tracking-tight">Trending today</h2>
              <div className="no-scrollbar flex snap-x gap-2.5 overflow-x-auto px-5">
                {[...movers.gainers.slice(0, 5), ...movers.losers.slice(0, 3)].map((m) => {
                  const up = m.changePct >= 0;
                  return (
                    <Link key={m.symbol} href={`/markets/${m.symbol}`} className="w-[120px] shrink-0 snap-start surface-card p-3">
                      <div className="flex items-center justify-between">
                        <AssetLogo src={m.logo} label={m.symbol} size={26} />
                        {up ? <TrendingUp className="h-3.5 w-3.5 text-gain" /> : <TrendingDown className="h-3.5 w-3.5 text-loss" />}
                      </div>
                      <p className="mt-2 truncate text-[13px] font-bold">{m.symbol}</p>
                      <p className="truncate text-[11px] text-textMuted">{fmtPrice(m.price)}</p>
                      <p className={`text-[12px] font-semibold ${up ? "text-gain" : "text-loss"}`}>{pct(m.changePct)}</p>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}

          <section className="mt-5">
            <div className="mb-2 flex items-center justify-between px-5">
              <h2 className="text-[15px] font-bold tracking-tight">Collections</h2>
            </div>
            <div className="no-scrollbar flex snap-x gap-2.5 overflow-x-auto px-5">
              {COLLECTIONS.map((col) => (
                <CollectionCard key={col.slug} slug={col.slug} title={col.title} gradient={col.gradient} icon={col.icon} count={col.symbols.length} size="sm" />
              ))}
            </div>
          </section>

          <h2 className="mb-1 mt-6 px-5 text-[15px] font-bold tracking-tight">All assets</h2>
        </>
      )}

      {/* Sort */}
      {view === "list" && (
        <div className="mt-2 flex items-center justify-between px-5">
          <p className="text-[12px] text-textMuted">{filtered.length} assets</p>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortId)}
            className="rounded-full bg-white/[0.06] px-3 py-1 text-[12px] font-semibold text-textSecondary outline-none"
          >
            <option value="movers">Top movers</option>
            <option value="az">A–Z</option>
            <option value="price">Price</option>
          </select>
        </div>
      )}

      {/* Asset views */}
      {view === "heatmap" ? (
        <div className="mt-3 px-5 pb-8">
          <Heatmap
            items={filtered.filter((f) => f.industry !== "Stablecoin").slice(0, 80)}
            onSelect={(sym) => router.push(`/markets/${sym}`)}
          />
          <p className="mt-3 text-center text-[11px] text-textMuted">Block size = market cap tier · colour = day move</p>
        </div>
      ) : view === "grid" ? (
        <div className="mt-3 grid grid-cols-2 gap-2.5 px-5 pb-8">
          {filtered.slice(0, 60).map((i) => {
            const up = i.changePct >= 0;
            return (
              <Link key={i.symbol} href={`/markets/${i.symbol}`} className="surface-card p-3.5">
                <div className="flex items-center justify-between">
                  <AssetLogo src={i.logo} label={i.symbol} size={30} />
                  <span className={`text-[12px] font-semibold ${up ? "text-gain" : "text-loss"}`}>{pct(i.changePct)}</span>
                </div>
                <p className="mt-2.5 truncate text-[14px] font-bold">{i.symbol}</p>
                <p className="truncate text-[11px] text-textMuted">{i.name}</p>
                <p className="mt-1 text-[15px] font-semibold tracking-tight">{fmtPrice(i.price)}</p>
              </Link>
            );
          })}
        </div>
      ) : (
        <ul className="mt-1 space-y-0.5 px-2 pb-8">
          {filtered.slice(0, 120).map((i) => (
            <li key={i.symbol}>
              <AssetRow
                item={{ ...i, sub: i.industry ? `${i.name} · ${i.industry}` : i.name }}
                href={`/markets/${i.symbol}`}
              />
            </li>
          ))}
          {filtered.length === 0 && (
            <p className="px-4 py-10 text-center text-[13px] text-textSecondary">No assets match “{q}”.</p>
          )}
        </ul>
      )}
    </>
  );
}
