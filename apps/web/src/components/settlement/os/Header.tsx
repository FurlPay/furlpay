"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Bell, ChevronDown, CircleUserRound, LogOut, Search, Settings2, X } from "lucide-react";
import { FurlPayMark } from "@/components/trips/FurlPayLogo";
import type { DeploymentEnvironment } from "@/lib/settlement/environment";
import { APP_TABS, navTabFor } from "@/lib/settlement/routes";
import { api, initials } from "./primitives";
import type { SearchHit } from "@/lib/settlement/search";
import type { NetworkSearchResult } from "@/lib/onchain/search-contract";
import { Drawer } from "../ui";

export { APP_TABS };

const ENV_LABEL: Record<DeploymentEnvironment, string> = { production: "Production", preview: "Preview", development: "Development" };


export default function Header({
  user,
  environment,
  alerts,
  onAlerts,
}: {
  /** The signed-in user and their business. No email: responses carry no full PII. */
  user?: { name?: string; company?: string } | null;
  environment?: DeploymentEnvironment;
  alerts?: number;
  onAlerts?: () => void;
}) {
  // The active tab is derived from the URL (navTabFor), never passed as a string.
  const active = navTabFor(usePathname());
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearch(true);
      }
      if (e.key === "Escape") {
        setMenu(false);
        setSearch(false);
      }
    };
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setMenu(false);
    window.addEventListener("keydown", key);
    document.addEventListener("mousedown", down);
    return () => {
      window.removeEventListener("keydown", key);
      document.removeEventListener("mousedown", down);
    };
  }, []);

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => undefined);
    window.location.href = "/login";
  }

  return (
    <>
      <header className="os-header">
        <Link href="/settlement" className="os-brand" aria-label="FurlPay Settlement overview">
          <FurlPayMark size={30} />
          FurlPay
        </Link>
        <nav className="os-tabs" aria-label="Settlement">
          {APP_TABS.map((t) => (
            <Link key={t.href} href={t.href} aria-current={active === t.label ? "page" : undefined}>
              {t.label}
            </Link>
          ))}
        </nav>
        <div className="os-header-right">
          <button type="button" className="os-search" onClick={() => setSearch(true)} aria-label="Search transactions and workspace">
            <Search size={16} />
            <span>Search transactions, counterparties…</span>
            <kbd className="os-kbd">⌘K</kbd>
          </button>
          <button type="button" className="os-icon-btn" aria-label={alerts ? `${alerts} items need attention` : "Notifications"} onClick={onAlerts}>
            <Bell size={17} />
            {alerts ? <i className="os-dot" /> : null}
          </button>
          {environment && (
            <span className="os-env" data-env={environment} title="Deployment serving this data">
              <i />
              {ENV_LABEL[environment]}
            </span>
          )}
          <div className="os-user" ref={ref}>
            <button type="button" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
              <span className="os-avatar">{user ? initials(user.name) : "·"}</span>
              <span>
                <strong>{user?.name || "Account"}</strong>
                <small>{user?.company ?? ""}</small>
              </span>
              <ChevronDown size={15} />
            </button>
            {menu && (
              <div className="os-menu" role="menu">
                <Link role="menuitem" href="/profile">
                  <CircleUserRound size={16} /> Profile & security
                </Link>
                <Link role="menuitem" href="/settlement/settings">
                  <Settings2 size={16} /> Workspace settings
                </Link>
                <Link role="menuitem" href="/settlement/onboarding">
                  <ArrowUpRight size={16} /> Business onboarding
                </Link>
                <button role="menuitem" type="button" onClick={signOut}>
                  <LogOut size={16} /> Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      {search && <SearchPalette onClose={() => setSearch(false)} />}
    </>
  );
}

const SECTIONS = [
  { label: "New payout", href: "/settlement/payouts/send?new=1" },
  { label: "New invoice", href: "/settlement/payments/invoices?new=1" },
  { label: "Create payment link", href: "/settlement/payments/links?new=1" },
  { label: "Create split rule", href: "/settlement/treasury/rules?new=1" },
  { label: "Export CSV", href: "/settlement/reports" },
  ...APP_TABS,
  { label: "Receive USDC", href: "/settlement/payments/receive" },
  { label: "Invoices", href: "/settlement/payments/invoices" },
  { label: "Payment links", href: "/settlement/payments/links" },
  { label: "Batch payouts", href: "/settlement/payouts/batch" },
  { label: "Approvals", href: "/settlement/payouts/approvals" },
  { label: "Convert & FX", href: "/settlement/treasury/convert" },
  { label: "Settlement rules", href: "/settlement/treasury/rules" },
  { label: "Virtual accounts", href: "/settlement/virtual-accounts" },
  { label: "Reports", href: "/settlement/reports" },
  { label: "Business onboarding", href: "/settlement/onboarding" },
];

// Recent on-chain lookups, kept in this browser only. Storage can be blocked or
// empty (private windows, previews); the palette works the same without it.
const RECENTS_KEY = "furlpay.settlement.recentLookups";
function readRecents(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length <= 88).slice(0, 5) : [];
  } catch {
    return [];
  }
}
function writeRecents(v: string[]) {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(v));
  } catch {
    /* storage unavailable: recents last for this session only */
  }
}

function SearchPalette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [chain, setChain] = useState("arbitrum");
  const [onchain, setOnchain] = useState<NetworkSearchResult | null>(null);
  const [checking, setChecking] = useState(false);
  const queryVersion = useRef(0);
  const [recents, setRecents] = useState<string[]>(readRecents);
  const chainQuery = /^0x[0-9a-fA-F]{40}$|^0x[0-9a-fA-F]{64}$|^[1-9A-HJ-NP-Za-km-z]{32,88}$/.test(q.trim());
  useEffect(() => {
    const term = q.trim();
    queryVersion.current++;
    setHits(null); setError(""); setWarnings([]); setOnchain(null); setChecking(false);
    if (term.length < 2) {
      setHits(null);
      setError("");
      return;
    }
    const ac = new AbortController();
    const t = setTimeout(() => {
      api<{ items: SearchHit[]; warnings: string[] }>(`/api/settlement/search?q=${encodeURIComponent(term)}`, { signal: ac.signal })
        .then((r) => { if (!ac.signal.aborted) { setHits(r.items); setWarnings(r.warnings); } })
        .catch((e) => !ac.signal.aborted && setError(e.message));
    }, 200);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [q]);
  const sections = SECTIONS.filter((s) => !q.trim() || s.label.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8);
  const go = (href: string) => {
    if (href.startsWith("?tx=")) {
      const next = new URLSearchParams(params.toString());
      next.set("tx", new URLSearchParams(href.slice(1)).get("tx")!);
      href = `${pathname}?${next}`;
    }
    onClose();
    router.push(href);
  };
  async function lookup() {
    const version = ++queryVersion.current;
    setChecking(true); setError(""); setOnchain(null);
    setRecents((r) => {
      const next = [q.trim(), ...r.filter((s) => s !== q.trim())].slice(0, 5);
      writeRecents(next);
      return next;
    });
    try { const r = await api<NetworkSearchResult>(`/api/settlement/search/onchain?chain=${chain}&q=${encodeURIComponent(q.trim())}`); if (version === queryVersion.current) setOnchain(r); }
    catch (e) { if (version === queryVersion.current) setError(e instanceof Error ? e.message : "Network unavailable"); }
    finally { if (version === queryVersion.current) setChecking(false); }
  }
  return (
    <Drawer title="Search" onClose={onClose}>
        <div className="os-input-icon">
          <Search size={16} />
          <input autoFocus className="os-input" maxLength={120} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Memo, invoice, beneficiary, address or action" aria-label="Search" />
        </div>
        {sections.length > 0 && (
          <div className="os-rows" style={{ marginTop: 16 }}>
            {sections.map((s) => (
              <button key={s.href} className="os-row" onClick={() => go(s.href)}>
                <span className="os-row-body">
                  <strong>{s.label}</strong>
                  <small>Go to section</small>
                </span>
                <ArrowUpRight size={15} />
              </button>
            ))}
          </div>
        )}
        {error && <p className="os-field-error" style={{ marginTop: 14 }}>{error}</p>}
        {warnings.map((w) => <p key={w} className="st-muted">{w}</p>)}
        {chainQuery && <section className="os-card" style={{ marginTop: 16 }}><h3>On-chain lookup</h3><p className="st-muted">Public network evidence; ownership is not inferred.</p><select className="os-select" aria-label="Lookup network" value={chain} onChange={(e) => { queryVersion.current++; setChain(e.target.value); setOnchain(null); setChecking(false); }}>{["arbitrum", "base", "ethereum", "polygon", "solana"].map((n) => <option key={n}>{n}</option>)}</select><button className="os-btn" disabled={checking} onClick={() => void lookup()}>{checking ? "Checking…" : "Search network"}</button>{onchain && <><p>{onchain.found ? "Found on network" : "No record found on this network"}</p><dl className="os-dl">{onchain.fields.map((f) => <div key={f.label}><dt>{f.label}</dt><dd style={{ overflowWrap: "anywhere" }}>{f.value}</dd></div>)}</dl></>}</section>}
        {hits && (
          <div className="os-rows" style={{ marginTop: 16 }}>
            {hits.length === 0 ? (
              <p className="os-row">No records match “{q.trim()}”.</p>
            ) : (
              hits.map((h) => (
                <button key={`${h.group}-${h.id}`} className="os-row" onClick={() => go(h.href)}>
                  <span className="os-row-body">
                    <strong>{h.name}</strong>
                    <small className="mono">
                      {h.group} · {h.detail}
                    </small>
                  </span>
                  <ArrowUpRight size={15} />
                </button>
              ))
            )}
          </div>
        )}
        {!q.trim() && <p style={{ marginTop: 16, color: "var(--os-muted)" }}>Search your ledger, drafts, invoices and beneficiaries, or select an action.</p>}
        {recents.length > 0 && <div><h3>Recent lookups</h3>{recents.map((r) => <button key={r} className="os-btn" onClick={() => setQ(r)}>{r.slice(0, 16)}…</button>)}</div>}
    </Drawer>
  );
}
