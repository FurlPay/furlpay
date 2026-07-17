import { useEffect, useRef, useState } from "react";
import { Icon, IconName } from "@/components/icons";
import { monogram, monogramColor } from "@/lib/market";
import type { BgRequest, BgResponse } from "@/lib/types";

// Shared popup plumbing: the background-worker bridge, formatters, hooks, and
// the small presentational primitives every tab leans on. Split out of the
// former 1,600-line App.tsx (G1) — one import site, zero behavior change.

export type Tab = "wallet" | "activity" | "approvals" | "earn" | "settings";

export interface SessionState {
  authenticated: boolean;
  name?: string;
  baseUrl: string;
}

export async function send<T>(message: BgRequest): Promise<BgResponse<T>> {
  try {
    const r = (await browser.runtime.sendMessage(message)) as BgResponse<T> | undefined;
    return r ?? { ok: false, error: "No response from service worker" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export const usd = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "Chrome · Windows" — the device identity real fintechs show for a session. */
export function deviceLabel(): string {
  const ua = navigator.userAgent;
  const browserName = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : "Chrome";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "Desktop";
  return `${browserName} · ${os}`;
}

export function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Good night";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Animate a number toward its target (balance roll-up). */
export function useCountUp(target: number, ms = 600): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  useEffect(() => {
    if (reducedMotion() || fromRef.current === target) {
      fromRef.current = target;
      setValue(target);
      return;
    }
    const from = fromRef.current;
    fromRef.current = target;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(from + (target - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return value;
}

/** Re-render every second (approval countdowns). */
export function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export async function openSite(path: string) {
  const { getBaseUrl } = await import("@/lib/api");
  const base = await getBaseUrl();
  void browser.tabs.create({ url: `${base}${path}` });
}

export const relTime = (iso: string | null): string => {
  if (!iso) return "—";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

/** Persisted boolean preference in extension-local storage. */
export function useStoredFlag(key: string, defaultOn = false): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState(defaultOn);
  useEffect(() => {
    browser.storage.local.get(key).then((v) => {
      if (typeof v[key] === "boolean") setOn(v[key]);
    });
  }, [key]);
  const update = (v: boolean) => {
    setOn(v);
    void browser.storage.local.set({ [key]: v });
  };
  return [on, update];
}

// --- Shared presentational bits ---------------------------------------------

/** Merchant-branded monogram avatar — the visual anchor of tx/approval rows. */
export function MerchantAvatar({ name, size = 32 }: { name: string; size?: number }) {
  const color = monogramColor(name);
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.34,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        fontWeight: 700,
        fontSize: size * 0.34,
        color,
        background: `color-mix(in srgb, ${color} 16%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
      }}
    >
      {monogram(name)}
    </span>
  );
}

export function SettingsTile({ icon, label, sub, onClick, chevron }: { icon: IconName; label: string; sub?: string; onClick: () => void; chevron?: boolean }) {
  return (
    <button className="list-tile" onClick={onClick}>
      <span style={{ color: "var(--fp-accent)", display: "flex" }}>
        <Icon name={icon} size={17} />
      </span>
      <span style={{ flex: 1 }}>
        <div style={{ fontWeight: 600 }}>{label}</div>
        {sub && <div className="tile-sub">{sub}</div>}
      </span>
      {chevron && (
        <span style={{ color: "var(--fp-text-muted)", display: "flex" }}>
          <Icon name="chevronRight" size={15} />
        </span>
      )}
    </button>
  );
}

/** Toggle persisted in extension storage (local preference only). */
export function StoredToggle({ icon, storageKey, label, sub, defaultOn }: { icon: IconName; storageKey: string; label: string; sub?: string; defaultOn?: boolean }) {
  const [on, setOn] = useStoredFlag(storageKey, defaultOn ?? false);
  return (
    <div className="list-tile" style={{ cursor: "default" }}>
      <span style={{ color: "var(--fp-accent)", display: "flex" }}>
        <Icon name={icon} size={17} />
      </span>
      <span style={{ flex: 1 }}>
        <div style={{ fontWeight: 600 }}>{label}</div>
        {sub && <div className="tile-sub">{sub}</div>}
      </span>
      <button
        className={`toggle${on ? " on" : ""}`}
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => setOn(!on)}
      />
    </div>
  );
}

export function EmptyState({ title, subtitle, actions }: { title: string; subtitle?: string; actions: { label: string; path: string }[] }) {
  return (
    <div className="glass-panel" style={{ textAlign: "center", padding: 20 }}>
      <div style={{ fontWeight: 600, fontSize: "0.88rem", marginBottom: 4 }}>{title}</div>
      {subtitle && <div style={{ fontSize: "0.74rem", color: "var(--fp-text-secondary)", marginBottom: 6 }}>{subtitle}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 10, flexWrap: "wrap" }}>
        {actions.map((a) => (
          <button key={a.path} className="btn-ghost" style={{ padding: "7px 14px", fontSize: "0.76rem" }} onClick={() => openSite(a.path)}>
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Skeleton with an explanatory status line — users should know WHAT is
 *  loading, not just that something is (G14/UX audit). */
export function SkeletonPage({ rows = 4, label }: { rows?: number; label?: string }) {
  return (
    <div style={{ padding: "0 14px" }} aria-busy="true" aria-label={label ?? "Loading"}>
      <div className="skeleton" style={{ height: 128, borderRadius: 18, marginBottom: label ? 6 : 14 }} />
      {label && (
        <div style={{ fontSize: "0.68rem", color: "var(--fp-text-muted)", textAlign: "center", marginBottom: 10 }}>
          {label}
        </div>
      )}
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height: 46, borderRadius: 12, marginBottom: 8, animationDelay: `${i * 0.08}s` }} />
      ))}
    </div>
  );
}

export function ErrorPanel({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="glass-panel" style={{ margin: "0 14px", borderColor: "rgba(255,69,58,0.3)" }}>
      <div style={{ color: "var(--fp-loss)", fontSize: "0.82rem", marginBottom: onRetry ? 10 : 0 }}>{message}</div>
      {onRetry && (
        <button className="btn-ghost" style={{ width: "100%" }} onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
