"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { AssetLogo } from "@furlpay/ui";
import { fmtPctSigned } from "./format";
import { fmtPrice } from "@/components/AssetRow";

// ---------------------------------------------------------------------------
// Asset search for the markets header.
//
// Server-side, over the FULL tradable universe (/api/markets/search, ~13,000
// US-listed assets plus crypto), not a filter over whatever the table happens
// to be showing. Typing "hynix" has to find SK Hynix even when page 1 is
// sorted by market cap and the row is nowhere near it.
//
// No conflict with the app-wide CommandPalette, which is also bound to Cmd+K:
// that component is mounted only inside the phone-frame Shell branch, and
// /markets opts out of the frame (lib/shellRoutes.ts). Exactly one Cmd+K
// handler is live on this page.
//
// Three things this gets right that a naive typeahead does not:
//
//   - A monotonic request id, so a slow response for "NV" cannot land after
//     "NVDA" and repaint the list with stale results.
//   - An AbortController per keystroke, so superseded requests are actually
//     cancelled rather than merely ignored.
//   - Nullable prices. The search spans assets nobody has quoted this window;
//     those render "—" rather than "$0.00", which reads as worthless.
// ---------------------------------------------------------------------------

interface SearchItem {
  symbol: string;
  name: string;
  kind: "stock" | "etf" | "crypto";
  logo: string | null;
  price: number | null;
  changePct: number | null;
  exchange?: string | null;
  curated?: boolean;
}

/** A non-security the API matched: gold, an FX pair, an index, the ten-year.
 *  Search does not price these (see the route's comment), so they carry no
 *  quote and render an em-dash rather than an invented number. */
interface SearchInstrument {
  symbol: string;
  displayName: string;
  assetClassLabel: string;
  logo: string | null;
}

interface SearchResponse {
  items: SearchItem[];
  instruments?: SearchInstrument[];
  count: number;
  universe: { tradable: number; fractionable: number; curated: number };
}

/**
 * One flat row type for the dropdown.
 *
 * The API returns securities and instruments in two lists because they have
 * different identity models — an FX pair has no CUSIP and no issuer. The
 * dropdown flattens them anyway: arrow keys, `aria-activedescendant` and Enter
 * all index into a single list, and maintaining two parallel cursors is how a
 * typeahead ends up highlighting one row and navigating to another.
 */
interface Row {
  symbol: string;
  name: string;
  badge: string;
  logo: string | null;
  price: number | null;
  changePct: number | null;
}

/**
 * Instruments first.
 *
 * They are matched on a short, explicit alias table, so a hit is a deliberate
 * convention — "gold" means XAUUSD — whereas the universe match is a fuzzy
 * name search that answers "gold" with eight mining companies. Burying the
 * gold price under Barrick Gold is the behaviour being fixed here.
 */
function toRows(data: SearchResponse): Row[] {
  const instruments: Row[] = (data.instruments ?? []).map((i) => ({
    symbol: i.symbol,
    name: i.displayName,
    badge: i.assetClassLabel,
    logo: i.logo,
    price: null,
    changePct: null,
  }));
  const securities: Row[] = data.items.map((i) => ({
    symbol: i.symbol,
    name: i.name,
    badge: KIND_LABEL[i.kind],
    logo: i.logo,
    price: i.price,
    changePct: i.changePct,
  }));
  return [...instruments, ...securities];
}

const KIND_LABEL: Record<SearchItem["kind"], string> = {
  stock: "Stock",
  etf: "ETF",
  crypto: "Crypto",
};

export default function GlobalSearch({
  /** Total tradable assets, for the placeholder. Falls back to generic copy
   *  until the real number is known — never a hardcoded count. */
  universeSize,
  className,
}: {
  universeSize?: number;
  className?: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [isMac, setIsMac] = useState(false);

  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const reqId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // navigator.platform is deprecated but is the only thing that answers this
    // in every browser today. Only the glyph on a hint chip depends on it.
    setIsMac(/mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent));
  }, []);

  // Cmd/Ctrl-K focuses the field from anywhere on the page.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Dismiss on an outside pointer.
  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open]);

  useEffect(() => {
    const needle = q.trim();
    if (!needle) {
      abortRef.current?.abort();
      setItems(null);
      setBusy(false);
      return;
    }

    const id = ++reqId.current;
    setBusy(true);
    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      fetch(`/api/markets/search?q=${encodeURIComponent(needle)}&limit=8`, {
        signal: controller.signal,
        cache: "no-store",
      })
        .then((r) => (r.ok ? (r.json() as Promise<SearchResponse>) : Promise.reject(r.status)))
        .then((data) => {
          if (id !== reqId.current) return;
          setItems(toRows(data));
          setActive(0);
        })
        .catch(() => {
          // An abort is this component superseding itself, not a failure.
          if (id === reqId.current) setItems([]);
        })
        .finally(() => {
          if (id === reqId.current) setBusy(false);
        });
    }, 220);

    return () => clearTimeout(timer);
  }, [q]);

  const go = useCallback(
    (item: Row) => {
      setOpen(false);
      setQ("");
      setItems(null);
      router.push(`/markets/${encodeURIComponent(item.symbol)}`);
    },
    [router]
  );

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!items?.length) {
      if (e.key === "Escape") {
        setQ("");
        inputRef.current?.blur();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + items.length) % items.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = items[active];
      if (item) go(item);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  const showPanel = open && q.trim().length > 0;

  return (
    <div ref={rootRef} className={`relative ${className ?? ""}`}>
      <div className="flex h-10 items-center gap-2.5 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3.5 transition-colors focus-within:border-accent/40">
        <Search className="h-4 w-4 shrink-0 text-textMuted" aria-hidden />
        <input
          ref={inputRef}
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={
            universeSize
              ? `Search ${universeSize.toLocaleString("en-US")} assets, companies, symbols…`
              : "Search assets, companies, symbols…"
          }
          aria-label="Search assets, companies and symbols"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showPanel && items?.length ? `${listId}-${active}` : undefined}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-textMuted [&::-webkit-search-cancel-button]:hidden"
        />
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-textMuted" aria-hidden />
        ) : (
          <kbd className="hidden shrink-0 rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-semibold text-textMuted sm:block">
            {isMac ? "⌘" : "Ctrl"} K
          </kbd>
        )}
      </div>

      {showPanel && (
        <div className="app-pop app-pop-in absolute left-0 right-0 top-[calc(100%+8px)] z-50 max-h-[min(60vh,420px)] overflow-y-auto">
          <ul id={listId} role="listbox" aria-label="Search results" className="p-1.5">
            {items === null || (busy && items.length === 0) ? (
              <li className="px-3 py-6 text-center text-[12.5px] text-textMuted">Searching…</li>
            ) : items.length === 0 ? (
              <li className="px-3 py-6 text-center text-[12.5px] text-textMuted">
                No assets match “{q.trim()}”.
              </li>
            ) : (
              items.map((item, i) => {
                const up = item.changePct != null && item.changePct >= 0;
                return (
                  <li key={`${item.badge}:${item.symbol}`} role="none">
                    <button
                      id={`${listId}-${i}`}
                      role="option"
                      aria-selected={i === active}
                      type="button"
                      onMouseEnter={() => setActive(i)}
                      onClick={() => go(item)}
                      className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${
                        i === active ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"
                      }`}
                    >
                      <AssetLogo src={item.logo} label={item.symbol} size={28} className="shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-[13px] font-semibold text-white">{item.symbol}</span>
                          <span className="shrink-0 rounded border border-white/10 px-1 py-px text-[9.5px] font-semibold uppercase tracking-wide text-textMuted">
                            {item.badge}
                          </span>
                        </span>
                        <span className="block truncate text-[11.5px] text-textSecondary">{item.name}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-[12.5px] font-semibold text-white font-mono">
                          {fmtPrice(item.price)}
                        </span>
                        <span
                          className={`block text-[11px] font-semibold font-mono ${
                            item.changePct == null ? "text-textMuted" : up ? "text-gain" : "text-loss"
                          }`}
                        >
                          {fmtPctSigned(item.changePct)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
