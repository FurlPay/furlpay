"use client";

import type { ReactNode } from "react";
import { Check } from "lucide-react";

// Shared Settlement OS primitives. Styling lives in app/settlement/os.css.

export function Field({ label, optional, error, children, span, counter }: { label: string; optional?: boolean; error?: string; children: ReactNode; span?: boolean; counter?: string }) {
  return (
    <label className={`os-field ${span ? "os-span" : ""}`} data-invalid={error ? "true" : undefined}>
      <span>
        {label} {optional && <em>(Optional)</em>}
      </span>
      {children}
      {counter && <small className="os-counter">{counter}</small>}
      {error && <small className="os-field-error">{error}</small>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className="os-toggle" onClick={() => onChange(!checked)} />;
}

export function Choice({ checked, onSelect, title, hint, disabled, icon }: { checked: boolean; onSelect: () => void; title: string; hint?: string; disabled?: boolean; icon?: ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={checked} disabled={disabled} className="os-choice" onClick={onSelect}>
      {icon ?? <span className="os-radio">{checked && <Check size={13} strokeWidth={3} />}</span>}
      <span>
        <strong>{title}</strong>
        {hint && <small>{hint}</small>}
      </span>
    </button>
  );
}

export function Badge({ tone = "green", children }: { tone?: "green" | "amber" | "red" | "muted"; children: ReactNode }) {
  return (
    <span className="os-badge" data-tone={tone === "green" ? undefined : tone}>
      {children}
    </span>
  );
}

export function Notice({ tone = "warn", children, icon }: { tone?: "warn" | "info" | "error"; children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="os-notice" data-tone={tone === "warn" ? undefined : tone} role={tone === "error" ? "alert" : undefined}>
      {icon}
      <div>{children}</div>
    </div>
  );
}

export function ProgressBar({ pct, label }: { pct: number; label: string }) {
  return (
    <div className="os-progress">
      <div className="os-progress-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <i style={{ width: `${pct}%` }} />
      </div>
      <b>{pct}%</b>
    </div>
  );
}

// Official marks shipped in /public/logos. Anything else renders as a neutral
// lettermark — never an improvised brand logo.
const CHAIN_LOGO: Record<string, string> = {
  arbitrum: "/logos/chains/arbitrum.svg",
  base: "/logos/official-onchain/base.svg",
  ethereum: "/logos/chains/ethereum.svg",
  solana: "/logos/chains/solana.svg",
  polygon: "/logos/chains/polygon.svg",
  avalanche: "/logos/chains/avalanche.svg",
  optimism: "/logos/chains/optimism.svg",
};
const COIN_LOGO: Record<string, string> = {
  USDC: "/logos/coins/usdc.svg",
  USDT: "/logos/coins/usdt.svg",
  EURC: "/logos/coins/eurc.svg",
  ETH: "/logos/coins/eth.svg",
  SOL: "/logos/coins/sol.svg",
};
const FIAT: Record<string, string> = { USD: "$", EUR: "€", GBP: "£" };
export const CHAIN_NAME: Record<string, string> = { arbitrum: "Arbitrum", base: "Base", ethereum: "Ethereum", solana: "Solana", polygon: "Polygon", avalanche: "Avalanche", optimism: "Optimism", bank: "Bank" };
export const chainName = (c: string) => CHAIN_NAME[c] ?? c.charAt(0).toUpperCase() + c.slice(1);

export function ChainLogo({ chain, size = 34 }: { chain: string; size?: number }) {
  const src = CHAIN_LOGO[chain];
  if (!src) return <span className="os-logo os-logo-fallback" style={{ width: size, height: size, fontSize: size * 0.4 }} aria-hidden="true">{chainName(chain).charAt(0)}</span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="os-logo" src={src} alt="" width={size} height={size} style={{ width: size, height: size }} />;
}

export function AssetLogo({ asset, size = 34 }: { asset: string; size?: number }) {
  const src = COIN_LOGO[asset.toUpperCase()];
  if (!src)
    return (
      <span className="os-logo os-logo-fallback" style={{ width: size, height: size, fontSize: size * 0.45 }} aria-hidden="true">
        {FIAT[asset.toUpperCase()] ?? asset.charAt(0)}
      </span>
    );
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="os-logo" src={src} alt="" width={size} height={size} style={{ width: size, height: size }} />;
}

export const ASSET_NAME: Record<string, string> = { USDC: "USD Coin", USDT: "Tether", EURC: "Euro Coin", USD: "US Dollar", EUR: "Euro", GBP: "British Pound" };

/** Fetch JSON; non-2xx throws with the server's own message. */
export async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
    headers: init.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json", ...init.headers } : init.headers,
  });
  const body = (await res.json().catch(() => null)) as (T & { error?: string; message?: string; detail?: string }) | null;
  if (!res.ok) {
    // Prefer the human sentence a service gives (message/detail) over a machine code like "control_plane_unavailable".
    const code = typeof body?.error === "string" && /^[a-z0-9_]+$/.test(body.error);
    const text = (code ? body?.message ?? body?.detail : body?.error) ?? body?.message ?? (code ? body?.error : undefined);
    const err = new Error(text ?? (res.status === 401 ? "Your session has ended. Sign in again." : `Request failed (${res.status})`)) as Error & { status: number; body: unknown };
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body as T;
}

export const initials = (name?: string, email?: string) =>
  ((name ?? "").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("") || (email ?? "F").charAt(0)).toUpperCase();
