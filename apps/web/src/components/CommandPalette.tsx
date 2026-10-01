"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  LayoutGrid,
  CreditCard,
  TrendingUp,
  Landmark,
  ReceiptText,
  PiggyBank,
  Trophy,
  BarChart3,
  HandCoins,
  Code2,
  User,
  ArrowLeftRight,
  ArrowDownLeft,
  Snowflake,
  Coins,
} from "lucide-react";

// Global command palette (Cmd/Ctrl+K) — the tabbed, keyboard-driven search both
// the INDmoney and Robinhood audits flagged as best-in-class. Categories: Pages,
// Features, Actions, Tokens. Fuzzy filter + arrow-key navigation.

type Category = "Pages" | "Features" | "Actions" | "Tokens";
interface Item {
  label: string;
  sub?: string;
  category: Category;
  href: string;
  Icon: React.ComponentType<{ className?: string }>;
  keywords?: string;
}

const ITEMS: Item[] = [
  { label: "Dashboard", category: "Pages", href: "/dashboard", Icon: LayoutGrid, keywords: "home overview net worth" },
  { label: "Cards", category: "Pages", href: "/cards", Icon: CreditCard, keywords: "virtual physical visa" },
  { label: "Investing", category: "Pages", href: "/portfolio", Icon: TrendingUp, keywords: "stocks etf portfolio chart" },
  { label: "Markets", sub: "390+ stocks, ETFs & crypto", category: "Pages", href: "/markets", Icon: TrendingUp, keywords: "prices buy trade bitcoin apple nvidia explore heatmap collections" },
  { label: "Research & Insights", sub: "Earnings, analysis, outlooks", category: "Pages", href: "/investing/insights", Icon: TrendingUp, keywords: "news earnings micron analysis research articles" },
  { label: "Banking", category: "Pages", href: "/banking", Icon: Landmark, keywords: "iban sepa routing" },
  { label: "Bills", category: "Pages", href: "/bills", Icon: ReceiptText, keywords: "pay autopay" },
  { label: "Earn", category: "Features", href: "/earn", Icon: PiggyBank, keywords: "yield apy vault interest" },
  { label: "Rewards", category: "Features", href: "/rewards", Icon: Trophy, keywords: "referral mission membership tier" },
  { label: "Analytics", category: "Features", href: "/spending", Icon: BarChart3, keywords: "spending category insights" },
  { label: "Credit", category: "Features", href: "/credit", Icon: HandCoins, keywords: "loan borrow portfolio collateral" },
  { label: "Developers", category: "Pages", href: "/developer", Icon: Code2, keywords: "api keys webhooks sdk" },
  { label: "Profile & Security", category: "Pages", href: "/profile", Icon: User, keywords: "settings kyc passkey mfa" },
  // Actions route to the relevant surface.
  { label: "Send money", sub: "Transfer stablecoins", category: "Actions", href: "/dashboard", Icon: ArrowLeftRight, keywords: "transfer pay" },
  { label: "Receive", sub: "Show your address / QR", category: "Actions", href: "/dashboard", Icon: ArrowDownLeft, keywords: "deposit qr" },
  { label: "Swap / Convert", sub: "Fiat ↔ crypto", category: "Actions", href: "/dashboard", Icon: ArrowLeftRight, keywords: "exchange convert" },
  { label: "Freeze a card", sub: "Card controls", category: "Actions", href: "/cards", Icon: Snowflake, keywords: "lock block" },
  { label: "Borrow against portfolio", sub: "Credit line", category: "Actions", href: "/credit", Icon: HandCoins, keywords: "loan credit" },
  // Tokens route to the dashboard accounts.
  { label: "USDC", sub: "USD Coin", category: "Tokens", href: "/dashboard", Icon: Coins, keywords: "stablecoin dollar" },
  { label: "EURC", sub: "Euro Coin", category: "Tokens", href: "/dashboard", Icon: Coins, keywords: "stablecoin euro" },
  { label: "USDT", sub: "Tether", category: "Tokens", href: "/dashboard", Icon: Coins, keywords: "stablecoin" },
  { label: "SOL", sub: "Solana", category: "Tokens", href: "/dashboard", Icon: Coins, keywords: "crypto" },
  { label: "ETH", sub: "Ethereum", category: "Tokens", href: "/dashboard", Icon: Coins, keywords: "crypto" },
];

const TABS: ("All" | Category)[] = ["All", "Pages", "Features", "Actions", "Tokens"];

export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"All" | Category>("All");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global Cmd/Ctrl+K toggle.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    // Also openable from a UI button (mobile has no ⌘K).
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("furlpay:search", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("furlpay:search", onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setTab("All");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ITEMS.filter((it) => {
      if (tab !== "All" && it.category !== tab) return false;
      if (!q) return true;
      return (
        it.label.toLowerCase().includes(q) ||
        it.sub?.toLowerCase().includes(q) ||
        it.keywords?.includes(q)
      );
    });
  }, [query, tab]);

  useEffect(() => setActive(0), [query, tab]);

  function go(item: Item) {
    setOpen(false);
    router.push(item.href);
  }

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && results[active]) {
      e.preventDefault();
      go(results[active]);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[1100] flex items-start justify-center bg-black/60 px-4 pt-[12vh] backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-label="Search"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg overflow-hidden rounded-[26px] border border-white/10 bg-[#0b0b0d] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.85)]"
      >
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3.5">
          <Search className="h-5 w-5 text-textSecondary" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="Search pages, features, tokens…"
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-textMuted"
          />
          <kbd className="rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[11px] text-textSecondary">
            esc
          </kbd>
        </div>

        {/* Category tabs */}
        <div className="flex gap-1 border-b border-white/[0.06] px-3 py-2">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-full px-3 py-1 text-[12px] font-semibold transition-colors ${
                tab === t ? "bg-white/[0.08] text-white" : "text-textSecondary hover:text-white"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Results */}
        <div className="max-h-[46vh] overflow-y-auto p-2">
          {results.length === 0 ? (
            <p className="px-3 py-8 text-center text-[13px] text-textSecondary">
              No matches for “{query}”.
            </p>
          ) : (
            results.map((it, i) => (
              <button
                key={it.category + it.label}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(it)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                  i === active ? "bg-white/[0.06]" : ""
                }`}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.05] text-textSecondary">
                  <it.Icon className="h-[18px] w-[18px]" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium">{it.label}</p>
                  {it.sub && <p className="truncate text-[12px] text-textMuted">{it.sub}</p>}
                </div>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-textMuted">
                  {it.category}
                </span>
              </button>
            ))
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-white/[0.06] px-4 py-2 text-[11px] text-textMuted">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span className="ml-auto">⌘K to toggle</span>
        </div>
      </div>
    </div>
  );
}
