"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { fmtCount, fmtUsd } from "@/components/analytics/format";
import { BrandLogo, chainName } from "@/components/onchain/BrandLogo";
import { FreshnessChip } from "@/components/onchain/ui";
import type { RwaSearch, RwaSummary } from "@/lib/rwa";

// The tokenized real-world-asset index. Rendered on /analytics/rwa and, for
// the admin only, on /onchain. Both callers gate it server-side, and the data
// API (/api/ops/rwa) is ADMIN_ONLY on its own. Every number comes from that
// API (the imported Allium snapshot); nothing is computed client-side beyond
// shares.
//
// States: loading; not_loaded (migration or snapshot absent: actionable);
// error (store failure: generic message, details stay in the server log);
// loaded.

const CLASS_LABEL: Record<string, string> = {
  rates: "Treasuries & rates",
  commodities: "Commodities",
  equities: "Equities",
  credit: "Credit",
  private_funds: "Private funds",
  real_estate: "Real estate",
};
const CLASS_COLOR: Record<string, string> = {
  rates: "#3B82F6",
  commodities: "#F5B83D",
  equities: "#8B5CF6",
  credit: "#10D9A0",
  private_funds: "#EC4899",
  real_estate: "#06B6D4",
};
const label = (k: string) => CLASS_LABEL[k] ?? k.replace(/_/g, " ");
const typeLabel = (k: string) => k.replace(/_us$/, " (US)").replace(/_/g, " ");
const usd = (n: number) => fmtUsd(n, { compact: true });

type Envelope<T> = { ok: true; data: T } | { ok: false; error?: { code?: string; message?: string } };
type Fetched<T> = { data: T | null; error: string | null; code: string | null };

async function getJson<T>(url: string, signal?: AbortSignal): Promise<Fetched<T>> {
  try {
    const res = await fetch(url, { cache: "no-store", signal });
    const b = (await res.json().catch(() => null)) as Envelope<T> | null;
    if (b && b.ok) return { data: b.data, error: null, code: null };
    const code = (b && !b.ok && b.error?.code) || (res.status === 401 || res.status === 403 ? "forbidden" : "error");
    return { data: null, error: (b && !b.ok && b.error?.message) || `Request failed (${res.status})`, code };
  } catch (e) {
    if ((e as Error).name === "AbortError") return { data: null, error: null, code: null };
    return { data: null, error: "Network error: the analytics API could not be reached.", code: "error" };
  }
}

function Card({ title, source, children, className = "" }: { title: string; source?: string; children: ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={`min-w-0 rounded-2xl border border-white/[0.07] bg-[#0B100E] p-4 ${className}`}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-[16px] font-semibold tracking-tight">{title}</h3>
        {source && <span className="truncate text-[11px] text-white/40">{source}</span>}
      </div>
      {children}
    </section>
  );
}

export default function RwaIndex({ variant = "page" }: { variant?: "page" | "section" }) {
  const [summary, setSummary] = useState<RwaSummary | null>(null);
  const [error, setError] = useState<{ message: string; code: string } | null>(null);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  // Both /onchain and /analytics/rwa read the same API and the same latest
  // snapshot, so they cannot disagree. The latest view re-checks every 60 s
  // (visible tab only); a pinned historical snapshot never changes.
  useEffect(() => {
    if (snapshot) return;
    const t = window.setInterval(() => document.visibilityState === "visible" && setTick((n) => n + 1), 60_000);
    return () => window.clearInterval(t);
  }, [snapshot]);
  useEffect(() => {
    const c = new AbortController();
    if (tick === 0) setError(null);
    void getJson<RwaSummary>(`/api/ops/rwa?view=summary${snapshot ? `&snapshot=${snapshot}` : ""}`, c.signal).then((r) => {
      if (c.signal.aborted) return;
      // A failed background re-check keeps the last good data on screen.
      if (r.data || tick === 0) setSummary(r.data);
      setError(r.error ? { message: r.error, code: r.code ?? "error" } : null);
    });
    return () => c.abort();
  }, [snapshot, tick]);
  const Heading = variant === "page" ? "h1" : "h2";

  return (
    <section id="rwa" className={variant === "section" ? "scroll-mt-16" : undefined} aria-label="Tokenized assets">
      <header className="flex flex-wrap items-end gap-3 pb-2">
        <div className="min-w-0 flex-1">
        <p className="text-[12px] font-medium uppercase tracking-wider text-[#00E599]">{variant === "page" ? "FurlPay Analytics" : "Operator view · internal data"}</p>
        <div className="mt-1 flex items-center gap-2">
          <Heading className={`font-semibold tracking-tight ${variant === "page" ? "text-[26px]" : "text-[22px]"}`}>Tokenized Assets</Heading>
          {summary?.freshness && <FreshnessChip f={summary.freshness} />}
        </div>
        <p className="mt-1 text-[14px] text-white/70">
          {
          summary
            ? `Real-world assets tracked onchain — snapshot ${summary.snapshot_date}, ${fmtCount(summary.deployments)} token deployments across ${summary.chains} chains.`
            : "Real-world assets tracked onchain: treasuries, commodities, equities, credit and funds."
          }
        </p>
        </div>
        {summary && summary.snapshots.length > 1 && (
          <label className="flex items-center gap-2 text-[12.5px] text-white/60">
            Snapshot
            <select
              aria-label="Snapshot date"
              value={snapshot ?? summary.snapshot_date ?? ""}
              onChange={(e) => setSnapshot(e.target.value === summary.snapshots[0] ? null : e.target.value)}
              className="h-9 rounded-lg border border-white/[0.1] bg-[#0B100E] px-2.5 text-[13px] text-white focus:border-[#00E599]/60 focus:outline-none"
            >
              {summary.snapshots.map((d, i) => (
                <option key={d} value={d}>
                  {d}
                  {i === 0 ? " (latest)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>
      {error && !summary && error.code === "not_loaded" && (
        <Card title="Snapshot not loaded yet">
          <p className="text-[13px] text-[#F5B83D]">{error.message}</p>
          <p className="mt-2 text-[12.5px] text-white/55">
            Apply migration 0033, then load the export with <code className="rounded bg-white/[0.06] px-1.5 py-0.5">node scripts/data/import-rwa-snapshot.mjs &lt;export.csv&gt; --as-of YYYY-MM-DD --apply</code>. Only operators see this.
          </p>
        </Card>
      )}
      {error && !summary && error.code !== "not_loaded" && (
        <Card title="Tokenized assets unavailable">
          <p className="text-[13px] text-[#FF8FA3]">{error.code === "forbidden" ? "Operator access is required." : error.message}</p>
          <p className="mt-2 text-[12.5px] text-white/55">Nothing is shown rather than partial data. Retry shortly; details are in the server log.</p>
        </Card>
      )}
      {!summary && !error && <div className="h-40 animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.02]" aria-label="Loading tokenized assets" />}
      {summary && <Overview s={summary} />}
      {summary && <Explorer s={summary} snapshot={snapshot} />}
      <p className="mt-4 text-[11px] text-white/35">
        Source: Allium tokenized-assets dataset (exported snapshot, provider-reported market caps). Licensed provider data: internal use only, not for redistribution (Allium ToS §1.3, §1.11).
      </p>
    </section>
  );
}

function Kpi({ title, value, note }: { title: string; value: string; note?: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-[#0B100E] px-4 py-3.5">
      <p className="text-[12.5px] text-white/65">{title}</p>
      <p className="mt-1 text-[24px] font-semibold tracking-tight">{value}</p>
      {note && <p className="text-[11.5px] text-white/45">{note}</p>}
    </div>
  );
}

function Overview({ s }: { s: RwaSummary }) {
  const maxChain = Math.max(1, ...s.by_chain.map((c) => c.market_cap_usd));
  const maxIssuer = Math.max(1, ...s.by_issuer.map((c) => c.market_cap_usd));
  return (
    <>
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi title="Tokenized market cap" value={usd(s.total_usd)} note={`snapshot ${s.snapshot_date}`} />
        <Kpi title="Products" value={fmtCount(s.products)} />
        <Kpi title="Issuers" value={fmtCount(s.issuers)} />
        <Kpi title="Chains" value={fmtCount(s.chains)} />
        <Kpi title="Live deployments" value={fmtCount(s.live_deployments)} note={`of ${fmtCount(s.deployments)} (rest report $0)`} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title="By asset class" source={`${s.by_class.length} classes`}>
          <div className="mb-3 flex h-2.5 overflow-hidden rounded-full bg-white/[0.06]" role="img" aria-label="Market cap by asset class">
            {s.by_class.map((c) => (
              <span key={c.asset_class} style={{ width: `${(c.market_cap_usd / s.total_usd) * 100}%`, background: CLASS_COLOR[c.asset_class] ?? "#6B7280" }} title={`${label(c.asset_class)} ${usd(c.market_cap_usd)}`} />
            ))}
          </div>
          <ul className="space-y-2 text-[13px]">
            {s.by_class.map((c) => (
              <li key={c.asset_class} className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: CLASS_COLOR[c.asset_class] ?? "#6B7280" }} />
                <span className="text-white/90">{label(c.asset_class)}</span>
                <span className="ml-auto tabular-nums">{usd(c.market_cap_usd)}</span>
                <span className="w-12 text-right tabular-nums text-white/50">{((c.market_cap_usd / s.total_usd) * 100).toFixed(1)}%</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 border-t border-white/[0.06] pt-2 text-[11.5px] text-white/45">
            Largest types: {s.by_type.slice(0, 4).map((t) => `${typeLabel(t.asset_type)} ${usd(t.market_cap_usd)}`).join(" · ")}
          </p>
        </Card>

        <Card title="By chain" source={`${s.by_chain.length} chains`}>
          <ul className="space-y-1.5 text-[13px]">
            {s.by_chain.slice(0, 10).map((c) => (
              <li key={c.chain} className="grid grid-cols-[18px_minmax(0,1fr)_minmax(40px,0.9fr)_64px] items-center gap-2.5" title={`${fmtCount(c.live)} live of ${fmtCount(c.deployments)} deployments`}>
                <BrandLogo kind="chain" id={c.chain} size={16} />
                <span className="truncate text-white/90">{chainName(c.chain)}</span>
                <span className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                  <span className="block h-full rounded-full bg-[#00E599]" style={{ width: `${(c.market_cap_usd / maxChain) * 100}%` }} />
                </span>
                <span className="text-right tabular-nums">{usd(c.market_cap_usd)}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Top issuers" source="by tokenized market cap">
          <ul className="space-y-1.5 text-[13px]">
            {s.by_issuer.slice(0, 10).map((c) => (
              <li key={c.issuer_name} className="grid grid-cols-[minmax(0,1.2fr)_minmax(40px,0.8fr)_64px] items-center gap-2.5" title={`${c.products} product(s)`}>
                <span className="truncate text-white/90">{c.issuer_name}</span>
                <span className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                  <span className="block h-full rounded-full bg-[#3B82F6]" style={{ width: `${(c.market_cap_usd / maxIssuer) * 100}%` }} />
                </span>
                <span className="text-right tabular-nums">{usd(c.market_cap_usd)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="Largest products" source="market cap summed across every chain the product is deployed on" className="mt-4">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead>
              <tr className="border-b border-white/[0.07] text-left text-[11.5px] text-white/50">
                <th className="py-2 pr-3 font-normal">#</th>
                <th className="py-2 pr-3 font-normal">Product</th>
                <th className="py-2 pr-3 font-normal">Issuer</th>
                <th className="py-2 pr-3 font-normal">Class</th>
                <th className="py-2 pr-3 font-normal">Chains</th>
                <th className="py-2 text-right font-normal">Market cap</th>
              </tr>
            </thead>
            <tbody>
              {s.top_products.map((p, i) => (
                <tr key={p.product_name} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]">
                  <td className="py-2 pr-3 tabular-nums text-white/40">{i + 1}</td>
                  <td className="py-2 pr-3">
                    <span className="text-white/95">{p.product_name}</span>
                    {p.top_symbol && <span className="ml-2 font-mono text-[11.5px] text-white/50">{p.top_symbol}</span>}
                  </td>
                  <td className="py-2 pr-3 text-white/70">{p.issuer_name}</td>
                  <td className="py-2 pr-3">
                    <span className="rounded px-1.5 py-0.5 text-[11px]" style={{ background: `${CLASS_COLOR[p.asset_class] ?? "#6B7280"}22`, color: CLASS_COLOR[p.asset_class] ?? "#9CA3AF" }}>
                      {label(p.asset_class)}
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    <span className="flex items-center gap-1" title={(p.chains ?? []).map(chainName).join(", ")}>
                      {(p.chains ?? []).slice(0, 6).map((c) => (
                        <BrandLogo key={c} kind="chain" id={c} size={15} />
                      ))}
                      {(p.chains ?? []).length > 6 && <span className="text-[11px] text-white/45">+{(p.chains ?? []).length - 6}</span>}
                    </span>
                  </td>
                  <td className="py-2 text-right tabular-nums">{usd(p.market_cap_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

const PAGE = 50;
const MIN_OPTIONS = [
  ["", "Any size"],
  ["1", "Non-zero"],
  ["1000000", "≥ $1M"],
  ["100000000", "≥ $100M"],
] as const;

function Explorer({ s, snapshot }: { s: RwaSummary; snapshot: string | null }) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [assetClass, setAssetClass] = useState("");
  const [chain, setChain] = useState("");
  const [minUsd, setMinUsd] = useState("1");
  const [sort, setSort] = useState<"market_cap" | "name">("market_cap");
  const [offset, setOffset] = useState(0);
  const [res, setRes] = useState<RwaSearch | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const ac = useRef<AbortController | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);
  useEffect(() => setOffset(0), [debounced, assetClass, chain, minUsd, sort, snapshot]);

  const url = useMemo(() => {
    const p = new URLSearchParams({ view: "search", sort, limit: String(PAGE), offset: String(offset) });
    if (debounced) p.set("q", debounced);
    if (assetClass) p.set("assetClass", assetClass);
    if (chain) p.set("chain", chain);
    if (minUsd) p.set("minUsd", minUsd);
    if (snapshot) p.set("snapshot", snapshot);
    return `/api/ops/rwa?${p}`;
  }, [debounced, assetClass, chain, minUsd, sort, offset, snapshot]);

  useEffect(() => {
    ac.current?.abort();
    const c = new AbortController();
    ac.current = c;
    setLoading(true);
    void getJson<RwaSearch>(url, c.signal).then((r) => {
      if (c.signal.aborted) return;
      setRes(r.data);
      setErr(r.error);
      setLoading(false);
    });
    return () => c.abort();
  }, [url]);

  const select = "h-9 rounded-lg border border-white/[0.1] bg-[#0B100E] px-2.5 text-[13px] text-white focus:border-[#00E599]/60 focus:outline-none";
  return (
    <Card title="Index" source="every token deployment in the snapshot; server-side search and filters" className="mt-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-lg border border-white/[0.1] bg-[#0B100E] px-3 focus-within:border-[#00E599]/60">
          <Search className="h-4 w-4 text-white/50" />
          <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={80} placeholder="Search product, symbol or issuer (e.g. BUIDL, Ondo, gold)" aria-label="Search tokenized assets" className="min-w-0 flex-1 bg-transparent text-[13px] placeholder:text-white/40 focus:outline-none" />
        </label>
        <select aria-label="Asset class" value={assetClass} onChange={(e) => setAssetClass(e.target.value)} className={select}>
          <option value="">All classes</option>
          {s.by_class.map((c) => (
            <option key={c.asset_class} value={c.asset_class}>
              {label(c.asset_class)}
            </option>
          ))}
        </select>
        <select aria-label="Chain" value={chain} onChange={(e) => setChain(e.target.value)} className={select}>
          <option value="">All chains</option>
          {s.by_chain.map((c) => (
            <option key={c.chain} value={c.chain}>
              {chainName(c.chain)}
            </option>
          ))}
        </select>
        <select aria-label="Minimum market cap" value={minUsd} onChange={(e) => setMinUsd(e.target.value)} className={select}>
          {MIN_OPTIONS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as "market_cap" | "name")} className={select}>
          <option value="market_cap">Largest first</option>
          <option value="name">Name A–Z</option>
        </select>
      </div>
      {err && <p className="mb-2 text-[12.5px] text-[#FF8FA3]">{err}</p>}
      <p className="mb-2 text-[12px] text-white/55" aria-live="polite">
        {res ? `${fmtCount(res.total)} deployment(s) · ${usd(res.total_usd)}` : loading ? "Searching…" : ""}
      </p>
      <div className={`overflow-x-auto transition-opacity ${loading ? "opacity-60" : ""}`}>
        <table className="w-full min-w-[760px] text-[13px]">
          <thead>
            <tr className="border-b border-white/[0.07] text-left text-[11.5px] text-white/50">
              <th className="py-2 pr-3 font-normal">Product</th>
              <th className="py-2 pr-3 font-normal">Symbol</th>
              <th className="py-2 pr-3 font-normal">Chain</th>
              <th className="py-2 pr-3 font-normal">Issuer</th>
              <th className="py-2 pr-3 font-normal">Type</th>
              <th className="py-2 text-right font-normal">Market cap</th>
            </tr>
          </thead>
          <tbody>
            {(res?.rows ?? []).map((r) => (
              <tr key={`${r.chain}|${r.product_name}|${r.token_symbol}`} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]">
                <td className="max-w-[300px] truncate py-1.5 pr-3 text-white/90" title={r.product_name}>
                  {r.product_name}
                </td>
                <td className="py-1.5 pr-3 font-mono text-[12px] text-white/70">{r.token_symbol || "—"}</td>
                <td className="py-1.5 pr-3">
                  <span className="flex items-center gap-1.5 text-white/75">
                    <BrandLogo kind="chain" id={r.chain} size={14} /> {chainName(r.chain)}
                  </span>
                </td>
                <td className="max-w-[180px] truncate py-1.5 pr-3 text-white/70">{r.issuer_name}</td>
                <td className="py-1.5 pr-3 capitalize text-white/55">{typeLabel(r.asset_type)}</td>
                <td className="py-1.5 text-right tabular-nums">{r.market_cap_usd > 0 ? usd(r.market_cap_usd) : "$0"}</td>
              </tr>
            ))}
            {res && res.rows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-white/50">
                  No deployment matches these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {res && res.total > PAGE && (
        <div className="mt-3 flex items-center justify-end gap-2 text-[12.5px] text-white/60">
          <span>
            {offset + 1}–{Math.min(offset + PAGE, res.total)} of {fmtCount(res.total)}
          </span>
          <button aria-label="Previous page" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))} className="rounded-md border border-white/[0.1] p-1.5 disabled:opacity-30">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button aria-label="Next page" disabled={offset + PAGE >= res.total} onClick={() => setOffset(offset + PAGE)} className="rounded-md border border-white/[0.1] p-1.5 disabled:opacity-30">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </Card>
  );
}
