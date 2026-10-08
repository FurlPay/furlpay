"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Bell, ChevronDown, CircleUserRound, LogOut, Search, Settings2, X } from "lucide-react";
import { FurlPayMark } from "@/components/trips/FurlPayLogo";
import type { DeploymentEnvironment } from "@/lib/settlement/environment";
import { APP_TABS, navTabFor } from "@/lib/settlement/routes";
import { api, initials } from "./primitives";

export { APP_TABS };

const ENV_LABEL: Record<DeploymentEnvironment, string> = { production: "Production", preview: "Preview", development: "Development" };

type SearchHit = { id: string; name: string; type: string; amountUsd: number; status: string; timestamp: string };

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

function SearchPalette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits(null);
      setError("");
      return;
    }
    const ac = new AbortController();
    const t = setTimeout(() => {
      api<{ items: SearchHit[] }>(`/api/settlement/transactions?limit=8&q=${encodeURIComponent(term)}`, { signal: ac.signal })
        .then((r) => setHits(r.items))
        .catch((e) => !ac.signal.aborted && setError(e.message));
    }, 200);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [q]);
  const sections = SECTIONS.filter((s) => q.trim() && s.label.toLowerCase().includes(q.trim().toLowerCase()));
  const go = (href: string) => {
    onClose();
    router.push(href);
  };
  return (
    <>
      <button className="os-backdrop" aria-label="Close search" onClick={onClose} />
      <div className="os-drawer" role="dialog" aria-modal="true" aria-label="Search">
        <div className="os-drawer-head">
          <h2>Search</h2>
          <button className="os-icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="os-input-icon">
          <Search size={16} />
          <input autoFocus className="os-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Transaction ID, counterparty, asset or network" aria-label="Search" />
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
        {hits && (
          <div className="os-rows" style={{ marginTop: 16 }}>
            {hits.length === 0 ? (
              <p className="os-row">No transactions match “{q.trim()}”.</p>
            ) : (
              hits.map((h) => (
                <button key={h.id} className="os-row" onClick={() => go(`/settlement?tx=${encodeURIComponent(h.id)}`)}>
                  <span className="os-row-body">
                    <strong>{h.name}</strong>
                    <small className="mono">
                      {h.id} · {h.type} · {h.status}
                    </small>
                  </span>
                  <span className="mono">${Math.abs(h.amountUsd).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </button>
              ))
            )}
          </div>
        )}
        {!q.trim() && <p style={{ marginTop: 16, color: "var(--os-muted)" }}>Searches your account ledger and the workspace sections.</p>}
      </div>
    </>
  );
}
