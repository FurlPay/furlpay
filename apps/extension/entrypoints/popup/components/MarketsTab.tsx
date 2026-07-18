import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import type { MarketSearchAsset, MarketSearchResponse } from "@/lib/types";
import { EmptyState, ErrorPanel, SkeletonPage, openSite, send, usd } from "./shared";
import AssetDetail from "./AssetDetail";

// ---------------------------------------------------------------------------
// Markets — the in-popup investing surface.
//
// Prices are REAL: /api/markets serves CoinGecko for crypto and Alpaca (with a
// keyless Yahoo fallback) for equities, 60s-cached server side, degrading to
// baked seed prices only when a provider is unreachable. Each row carries a
// `live` flag from the provider, and the header states which it is rather than
// implying freshness the data doesn't have.
//
// Logos are the official marks the web app serves from /logos/**; they load
// from the configured backend origin, which host_permissions already covers.
// ---------------------------------------------------------------------------

type Filter = "all" | "stock" | "etf" | "crypto";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "stock", label: "Stocks" },
  { id: "etf", label: "ETFs" },
  { id: "crypto", label: "Crypto" },
];

/** Rows fetched per view. The popup virtualizes nothing, so this bounds both
 *  the payload and the DOM; search narrows server-side before the slice. */
const PAGE_SIZE = 60;

export default function MarketsTab() {
  // Selecting an asset swaps this tab to the detail view rather than opening a
  // browser tab — leaving the popup to read a price closes the popup.
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<MarketSearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const reqId = useRef(0);

  useEffect(() => {
    send<{ authenticated: boolean; baseUrl: string }>({ type: "GET_SESSION_STATE" }).then(
      (r) => r.ok && setBaseUrl(r.data.baseUrl)
    );
  }, []);

  const load = useCallback((f: Filter, q: string) => {
    // Monotonic request id: a slow response for an earlier keystroke must never
    // overwrite a newer one (the classic search race).
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    send<MarketSearchResponse>({ type: "SEARCH_MARKETS", kind: f === "all" ? undefined : f, q, limit: PAGE_SIZE }).then((r) => {
      if (id !== reqId.current) return;
      setLoading(false);
      if (r.ok) setData(r.data);
      else setError(r.error);
    });
  }, []);

  // Debounced search — one request per pause, not per keystroke.
  useEffect(() => {
    const t = setTimeout(() => load(filter, query.trim()), query ? 280 : 0);
    return () => clearTimeout(t);
  }, [filter, query, load]);

  const items = data?.items ?? [];
  const liveCount = useMemo(() => items.filter((i) => i.live).length, [items]);

  if (selected) {
    return (
      <AssetDetail
        symbol={selected}
        baseUrl={baseUrl}
        onBack={() => setSelected(null)}
        onSelect={setSelected}
      />
    );
  }

  if (error && !data) return <ErrorPanel message={error} onRetry={() => load(filter, query.trim())} />;

  return (
    <div style={{ padding: "0 14px" }}>
      <div className="fade-up" style={{ margin: "2px 2px 10px" }}>
        <div style={{ fontSize: "1.02rem", fontWeight: 800, letterSpacing: "-0.3px" }}>Markets</div>
        <div style={{ fontSize: "0.72rem", color: "var(--fp-text-secondary)", display: "flex", alignItems: "center", gap: 5 }}>
          <span className={`status-dot ${liveCount > 0 ? "status-dot--on" : "status-dot--off"}`} style={{ width: 5, height: 5 }} />
          {/* Never claim "live" for seed-price degradation. The universe count
              is the searchable total, not the rows on screen. */}
          {liveCount > 0
            ? `Live prices · ${(data?.universe.tradable ?? 0).toLocaleString("en-US")} tradable`
            : data
              ? "Cached prices — provider unreachable"
              : "Search stocks, ETFs & crypto"}
        </div>
      </div>

      <div className="search-wrap">
        <Icon name="search" size={15} />
        <input
          className="input"
          placeholder="Search stocks, ETFs & crypto"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search markets"
        />
      </div>

      <div className="seg" role="tablist" aria-label="Asset class" style={{ margin: "10px 0 12px", width: "100%" }}>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            role="tab"
            aria-selected={f.id === filter}
            className={f.id === filter ? "active" : ""}
            style={{ flex: 1 }}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {!data && loading && <SkeletonPage rows={6} label="Loading live prices…" />}

      {data && items.length === 0 && (
        <EmptyState
          title={query ? `No match for "${query}"` : "No assets"}
          subtitle={query ? "Try a symbol like AAPL or BTC." : undefined}
          actions={[{ label: "Browse all markets", path: "/markets" }]}
        />
      )}

      {items.map((a, i) => (
        <AssetRow key={`${a.kind}:${a.symbol}`} asset={a} baseUrl={baseUrl} delay={Math.min(i, 12) * 0.02} onOpen={setSelected} />
      ))}

      {items.length >= PAGE_SIZE && (
        <button className="btn-ghost" style={{ width: "100%", marginTop: 10 }} onClick={() => openSite("/markets")}>
          View all on furlpay.com
        </button>
      )}
    </div>
  );
}

function AssetRow({
  asset,
  baseUrl,
  delay,
  onOpen,
}: {
  asset: MarketSearchAsset;
  baseUrl: string;
  delay: number;
  onOpen: (symbol: string) => void;
}) {
  const [logoOk, setLogoOk] = useState(true);
  // An uncurated asset comes back unpriced (see MarketSearchAsset.price). Note
  // `null >= 0` is TRUE in JS, so comparing directly would paint every
  // unpriced row green with a "+0.00%" — a fabricated gain. Check explicitly.
  const priced = asset.price != null && Number.isFinite(asset.price);
  const hasChange = asset.changePct != null && Number.isFinite(asset.changePct);
  const up = hasChange && (asset.changePct as number) >= 0;
  const showLogo = logoOk && !!baseUrl && !!asset.logo;

  return (
    <button
      className="asset-row fade-up"
      style={{ animationDelay: `${delay}s`, width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer" }}
      onClick={() => onOpen(asset.symbol)}
      aria-label={`${asset.name}, ${asset.symbol}`}
    >
      {/* Official mark from the backend; monogram fallback if it 404s so a
          missing SVG never leaves a blank hole in the row. */}
      <div className="asset-logo" style={{ background: showLogo ? "transparent" : "var(--fp-bg-secondary)" }}>
        {showLogo ? (
          <img
            src={`${baseUrl}${asset.logo}`}
            alt=""
            width={28}
            height={28}
            loading="lazy"
            onError={() => setLogoOk(false)}
            style={{ borderRadius: "50%" }}
          />
        ) : (
          asset.symbol.slice(0, 2)
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: "0.86rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {asset.symbol}
        </div>
        <div style={{ fontSize: "0.7rem", color: "var(--fp-text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {asset.name}
          {asset.industry ? ` · ${asset.industry}` : ""}
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontFamily: "var(--fp-font-mono)", fontWeight: 600, fontSize: "0.84rem" }}>
          {priced ? `$${usd(asset.price)}` : "—"}
        </div>
        {hasChange ? (
          <div className={up ? "gain" : "loss"} style={{ fontSize: "0.7rem", fontWeight: 600 }}>
            {up ? "+" : ""}
            {(asset.changePct as number).toFixed(2)}%
          </div>
        ) : (
          // No quote for this asset — say so instead of rendering "+0.00%",
          // which would look like a real, flat session.
          <div style={{ fontSize: "0.66rem", color: "var(--fp-text-muted)" }}>no quote</div>
        )}
      </div>
    </button>
  );
}
