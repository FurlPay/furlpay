"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { IconInfo, type FurlIcon } from "@/components/furlicons";
import { PRODUCT_LABELS } from "@/lib/analytics/products";
import { fmtChange } from "@/components/analytics/format";
import type { Freshness, SectionFreshness } from "@/lib/onchain/freshness";

// Shared primitives for /onchain. Formatting only: no value is derived or
// defaulted here, and a missing number renders as "—".

export const NEON = "#00E599";
export const PALETTE = ["#3B82F6", "#10D9A0", "#2563EB", "#06B6D4", "#8B5CF6", "#6B7280"];
export const RAIL_COLOR: Record<string, string> = { x402: "#EC4899", mpp: "#F59E0B", lifi: "#8B5CF6", cctp: "#3B82F6", transfers: "#10D9A0" };
export const SHORT_RAIL: Record<string, string> = { transfers: "Transfers", x402: "x402", lifi: "Swaps", cctp: "CCTP", mpp: "MPP" };
export const railLabel = (r: string) => PRODUCT_LABELS[r as keyof typeof PRODUCT_LABELS] ?? r;
export const chainLabel = (c: string) => (c === "all" ? "All Chains" : c === "bsc" ? "BNB Chain" : c === "arbitrum" ? "Arbitrum One" : c.charAt(0).toUpperCase() + c.slice(1));
export const pct = (r: number) => `${(r * 100).toFixed(1)}%`;

const FRESH: Record<Freshness, { label: string; cls: string; dot: string }> = {
  live: { label: "Live", cls: "border-[#00E599]/35 text-[#00E599]", dot: "bg-[#00E599]" },
  updating: { label: "Updating", cls: "border-[#38BDF8]/35 text-[#7DD3FC]", dot: "bg-[#38BDF8]" },
  delayed: { label: "Delayed", cls: "border-[#F5B83D]/35 text-[#F5B83D]", dot: "bg-[#F5B83D]" },
  stale: { label: "Stale", cls: "border-[#F5B83D]/35 text-[#F5B83D]", dot: "bg-[#F5B83D]" },
  offline: { label: "Offline", cls: "border-[#FF4D6D]/35 text-[#FF8FA3]", dot: "bg-[#FF4D6D]" },
  not_connected: { label: "Not connected", cls: "border-white/15 text-white/55", dot: "bg-white/40" },
};

function ago(iso: string | null): string {
  if (!iso) return "unknown";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "unknown";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 172800) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/**
 * Upstream freshness of one section (lib/onchain/freshness.ts). The state
 * comes from the server's view of the SOURCE, never from this tab's
 * connection; hover/focus shows the source, cadence, data time and reason.
 */
export function FreshnessChip({ f, inline = false }: { f: SectionFreshness; inline?: boolean }) {
  const s = FRESH[f.state];
  return (
    <span className="group relative inline-flex min-w-0" tabIndex={0} aria-label={`${s.label}: ${f.source}, ${f.cadence}, data ${ago(f.asOf)}${f.reason ? `. ${f.reason}` : ""}`}>
      {inline ? (
        <span className="flex min-w-0 items-center gap-1.5 text-[10.5px]">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.dot} ${f.state === "live" ? "animate-pulse" : ""}`} />
          <span className={`font-medium ${s.cls.split(" ").filter((c) => c.startsWith("text-")).join(" ")}`}>{s.label}</span>
          <span className="truncate text-white/40">· {f.state === "not_connected" ? f.cadence : `${f.cadence} · ${ago(f.asOf)}`}</span>
        </span>
      ) : (
        <span className={`flex h-[20px] items-center gap-1 rounded-full border px-2 text-[10.5px] font-medium ${s.cls}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${s.dot} ${f.state === "live" ? "animate-pulse" : ""}`} />
          {s.label}
        </span>
      )}
      <span role="tooltip" className="pointer-events-none absolute left-0 top-6 z-50 hidden w-[260px] rounded-md border border-white/[0.12] bg-[#0D1415] px-2.5 py-2 text-[11px] text-white/75 shadow-xl shadow-black/60 group-hover:block group-focus:block">
        <span className="block font-medium text-white">{f.source}</span>
        <span className="block">Cadence: {f.cadence}</span>
        <span className="block">Data as of: {f.asOf ? `${new Date(f.asOf).toISOString().replace("T", " ").slice(0, 16)} UTC (${ago(f.asOf)})` : "unknown"}</span>
        {f.reason && <span className="mt-1 block text-[#F5B83D]">{f.reason}</span>}
      </span>
    </span>
  );
}

export function Card({ title, icon: Icon, id, action, source, freshness, children, className = "" }: { title: string; icon?: FurlIcon; id?: string; action?: ReactNode; source?: string; freshness?: SectionFreshness | null; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={`flex min-w-0 scroll-mt-16 flex-col rounded-[10px] border border-white/[0.075] bg-[#0A0F10] px-4 pb-3.5 pt-3.5 ${className}`}>
      <div className="mb-2.5 flex min-h-[28px] items-center gap-1.5">
        {Icon && <Icon size={16} className="text-white/60" />}
        <h2 className="truncate text-[15.5px] font-semibold tracking-[-0.01em] text-white">{title}</h2>
        {source && (
          <span className="group relative shrink-0" tabIndex={0} aria-label={`Source: ${source}`}>
            <IconInfo size={14} className="text-white/30 transition-colors group-hover:text-white/70 group-focus:text-white/70" />
            <span role="tooltip" className="pointer-events-none absolute left-0 top-5 z-50 hidden w-max max-w-[280px] rounded-md border border-white/[0.12] bg-[#0D1415] px-2.5 py-1.5 text-[11px] text-white/80 shadow-xl shadow-black/60 group-hover:block group-focus:block">
              Source: {source}
            </span>
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-2">{action}</div>
      </div>
      {freshness && (
        <div className="-mt-1.5 mb-2 min-w-0">
          <FreshnessChip f={freshness} inline />
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  );
}

/** Small bordered dropdown used in card headers and the top bar. */
export function Menu<T extends string>({
  value,
  options,
  onChange,
  label,
  width = "auto",
  size = "sm",
}: {
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
  label: string;
  width?: number | "auto";
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  const current = options.find(([v]) => v === value)?.[1] ?? value;
  const h = size === "md" ? "h-[32px] text-[12.5px]" : "h-[28px] text-[12px]";
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${current}`}
        disabled={options.length < 2}
        onClick={() => setOpen((o) => !o)}
        style={width === "auto" ? undefined : { width }}
        className={`flex ${h} items-center justify-between gap-3 rounded-md border border-white/[0.12] bg-[#0C1213] px-2.5 text-white/90 transition-colors hover:border-white/25 disabled:cursor-default disabled:hover:border-white/[0.12]`}
      >
        <span className="truncate">{current}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-white/60 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ul role="listbox" aria-label={label} className="absolute right-0 z-50 mt-1 min-w-full overflow-hidden rounded-md border border-white/[0.12] bg-[#0D1415] py-1 shadow-xl shadow-black/60">
          {options.map(([v, l]) => (
            <li key={v}>
              <button
                type="button"
                role="option"
                aria-selected={v === value}
                onClick={() => {
                  onChange(v);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-left text-[12.5px] text-white/85 hover:bg-white/[0.06]"
              >
                <span className="w-3.5">{v === value && <Check className="h-3.5 w-3.5 text-[#00E599]" />}</span>
                {l}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function GhostButton({ children, onClick, href }: { children: ReactNode; onClick?: () => void; href?: string }) {
  const cls = "flex h-[28px] items-center gap-1.5 rounded-md border border-white/[0.12] bg-[#0C1213] px-2.5 text-[12px] text-white/90 transition-colors hover:border-white/25 hover:bg-white/[0.04]";
  return href ? (
    <a href={href} className={cls}>
      {children}
    </a>
  ) : (
    <button type="button" onClick={onClick} className={cls}>
      {children}
    </button>
  );
}

export function Unavailable({ reason, icon: Icon = IconInfo }: { reason: string; icon?: FurlIcon }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-white/[0.09] px-4 py-5 text-center">
      <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-white/75">
        <Icon size={14} className="text-white/45" />
        Not available
      </p>
      <p className="max-w-[320px] text-[11.5px] text-white/45">{reason}</p>
    </div>
  );
}

export function Empty({ text, icon: Icon }: { text: string; icon?: FurlIcon }) {
  return (
    <p className="flex flex-1 items-center justify-center gap-1.5 py-5 text-center text-[12.5px] text-white/45">
      {Icon && <Icon size={14} className="text-white/35" />}
      {text}
    </p>
  );
}

export function Change({ ratio, invert = false, className = "text-[13px]" }: { ratio: number | null; invert?: boolean; className?: string }) {
  if (ratio === null || !Number.isFinite(ratio)) return <span className={`${className} font-medium text-white/35`}>no prior period</span>;
  const good = invert ? ratio <= 0 : ratio >= 0;
  return (
    <span className={`${className} font-medium ${good ? "text-[#00E599]" : "text-[#FF4D6D]"}`}>
      {ratio >= 0 ? "↑" : "↓"} {fmtChange(Math.abs(ratio)).replace("+", "")}
    </span>
  );
}

/** Smoothed sparkline (Catmull-Rom → cubic Bézier). Hidden when the series is flat zero. */
export function Spark({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2 || values.every((v) => v === 0)) return null;
  const w = 112, h = 44, max = Math.max(...values), min = Math.min(...values);
  const p = values.map((v, i) => [(i / (values.length - 1)) * w, h - 4 - ((v - min) / (max - min || 1)) * (h - 8)] as const);
  let d = `M${p[0][0]},${p[0][1]}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] ?? p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] ?? p2;
    d += ` C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`;
  }
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-[44px] w-[112px] shrink-0 overflow-visible" aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" style={{ filter: `drop-shadow(0 0 3px ${color}66)` }} />
    </svg>
  );
}

/** Dark tooltip body shared by the Recharts charts. */
export function TipBox({ title, rows }: { title: string; rows: { label: string; value: string; color?: string }[] }) {
  return (
    <div className="rounded-md border border-white/[0.12] bg-[#0D1415]/95 px-2.5 py-2 text-[11.5px] shadow-xl shadow-black/60">
      <p className="mb-1 font-medium text-white">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex items-center gap-2 text-white/75">
          {r.color && <span className="h-2 w-2 rounded-full" style={{ background: r.color }} />}
          <span>{r.label}</span>
          <span className="ml-auto pl-3 tabular-nums text-white">{r.value}</span>
        </p>
      ))}
    </div>
  );
}
