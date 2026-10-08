"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import { IconDegraded } from "@/components/furlicons";
import type { ChainState } from "@/lib/onchain/usdcHealth";

// Shared pieces for the USDC section. Formatting only: values arrive as exact
// decimal strings from the API; compact display is for reading, the exact
// value is always in the tooltip. A missing value renders "—", never 0.

export const CHAIN_ORDER = ["ethereum", "base", "arbitrum", "polygon", "solana"] as const;
export const CHAIN_COLOR: Record<string, string> = { ethereum: "#8B9DF9", base: "#3B82F6", arbitrum: "#28A0F0", polygon: "#A26CF7", solana: "#14F195" };

/** Every number on the panel has one definition, shown on hover/focus and in the glossary. */
export const DEFINITIONS: Record<string, string> = {
  supply: "Current native USDC supply on the network: the token contract's totalSupply() (EVM) or getTokenSupply (Solana), read from the node at its newest block. Exact.",
  netSupply: "USDC minted minus USDC burned in the period (Transfer events from / to the zero address).",
  volume: "USDC moved between holders in the period: the sum of Transfer amounts, excluding mints and burns.",
  transfers: "Number of USDC Transfer events between holders in the period (mints and burns are counted separately).",
  minted: "USDC newly issued in the period (Transfer events from the zero address).",
  burned: "USDC destroyed in the period (Transfer events to the zero address).",
  senders: "Distinct addresses that sent USDC in the live window, counted per chain (an address active on two chains counts twice). Exact for the live window only.",
  receivers: "Distinct addresses that received USDC in the live window, counted per chain.",
  eps: "USDC Transfer events per second over the live window, measured from block timestamps.",
  head: "Newest block (slot on Solana) the node reports right now.",
  indexed: "Newest FINALIZED block whose every USDC Transfer has been committed to the stored index. On Solana: the last slot the wallet indexer fully processed.",
  lag: "How far the stored index is behind the node's head, in blocks and seconds of chain time. History is finalized-only, so a lag of a few minutes (up to ~20 on L2s) is by design.",
  processing: "Time to read, verify and commit the newest indexed block range.",
  reconciled: "Whether supply at the end of the newest range equals the previous supply plus minted minus burned, exactly.",
  rpc: "Round-trip time of the first RPC call to the chain's node in this read.",
};

export function Def({ k, children }: { k: keyof typeof DEFINITIONS | string; children: ReactNode }) {
  return (
    <span className="group relative inline-flex items-center gap-1" tabIndex={0} aria-describedby={`def-${k}`}>
      {children}
      <Info className="h-3 w-3 shrink-0 text-white/25 group-hover:text-white/60 group-focus:text-white/60" aria-hidden="true" />
      <span id={`def-${k}`} role="tooltip" className="pointer-events-none absolute left-0 top-5 z-50 hidden w-[260px] rounded-md border border-white/[0.12] bg-[#0D1415] px-2.5 py-1.5 text-[11px] font-normal normal-case leading-snug tracking-normal text-white/80 shadow-xl shadow-black/60 group-hover:block group-focus:block">
        {DEFINITIONS[k] ?? k}
      </span>
    </span>
  );
}

/** Compact USDC from an exact decimal string; null -> "—". */
export function usdc(v: string | null | undefined, opts: { compact?: boolean; sign?: boolean } = {}): string {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "−" : opts.sign && n > 0 ? "+" : "";
  const a = Math.abs(n);
  if (opts.compact === false || a < 10_000) return `${sign}${a.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  const [d, s] = a >= 1e9 ? [1e9, "B"] : a >= 1e6 ? [1e6, "M"] : [1e3, "K"];
  return `${sign}${(a / d).toLocaleString("en-US", { maximumFractionDigits: 2 })}${s}`;
}
export const int = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString("en-US"));
/** Percent with enough digits to show a small but real change (never "0.00%" for a non-zero value). */
export function pctStr(r: number | null | undefined, digits = 2): string {
  if (r === null || r === undefined || !Number.isFinite(r)) return "—";
  const a = Math.abs(r * 100);
  const d = a === 0 || a >= 10 ** -digits ? digits : Math.min(8, Math.ceil(-Math.log10(a)) + 1);
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}${a.toFixed(d)}%`;
}
export const short = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

export function ago(ms: number | string | null | undefined, now = Date.now()): string {
  if (ms === null || ms === undefined) return "never";
  const t = typeof ms === "string" ? Date.parse(ms) : ms;
  if (!Number.isFinite(t)) return "—";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 172800) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
export function dur(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  if (seconds < 90) return `${seconds}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

const STATE_STYLE: Record<ChainState, { label: string; cls: string; dot: string }> = {
  LIVE: { label: "Live", cls: "border-[#00E599]/35 bg-[#00E599]/[0.07] text-[#00E599]", dot: "bg-[#00E599]" },
  INDEXING: { label: "Indexing", cls: "border-[#38BDF8]/35 bg-[#38BDF8]/[0.07] text-[#7DD3FC]", dot: "bg-[#38BDF8]" },
  DEGRADED: { label: "Degraded", cls: "border-[#F5B83D]/35 bg-[#F5B83D]/[0.07] text-[#F5B83D]", dot: "bg-[#F5B83D]" },
  UNAVAILABLE: { label: "Unavailable", cls: "border-[#FF4D6D]/35 bg-[#FF4D6D]/[0.07] text-[#FF8FA3]", dot: "bg-[#FF4D6D]" },
  NOT_CONFIGURED: { label: "Not configured", cls: "border-white/15 text-white/55", dot: "bg-white/35" },
};

/** State as text + dot (never colour alone), reasons in the tooltip. */
export function StateBadge({ state, reasons }: { state: ChainState; reasons: string[] }) {
  const s = STATE_STYLE[state];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide ${s.cls}`} title={reasons.join(" ") || s.label}>
      {state === "DEGRADED" ? (
        <IconDegraded size={11} />
      ) : (
        <span className={`h-1.5 w-1.5 rounded-full ${s.dot} ${state === "LIVE" ? "motion-safe:animate-pulse" : ""}`} aria-hidden="true" />
      )}
      {s.label}
    </span>
  );
}

/** Briefly highlights a value when it changes (respects prefers-reduced-motion). */
export function Flash({ value, children, className = "" }: { value: unknown; children: ReactNode; className?: string }) {
  const prev = useRef(value);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (prev.current !== value && prev.current !== undefined) {
      setOn(true);
      const t = setTimeout(() => setOn(false), 700);
      prev.current = value;
      return () => clearTimeout(t);
    }
    prev.current = value;
  }, [value]);
  return <span className={`rounded transition-colors duration-700 motion-reduce:transition-none ${on ? "bg-[#00E599]/15" : "bg-transparent"} ${className}`}>{children}</span>;
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { v: T; l: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex rounded-md border border-white/[0.12] p-0.5">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          aria-pressed={value === o.v}
          onClick={() => onChange(o.v)}
          className={`rounded px-2 py-0.5 text-[11.5px] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#00E599] ${value === o.v ? "bg-white/[0.1] text-white" : "text-white/60 hover:text-white"}`}
        >
          {o.l}
        </button>
      ))}
    </div>
  );
}
