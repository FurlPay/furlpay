"use client";

import { ReactNode } from "react";

export function PageHeader({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <header className="flex items-end justify-between px-5 pb-4 pt-8">
      <h1 className="header-title">{title}</h1>
      {right}
    </header>
  );
}

export function usd(n: number, opts: { sign?: boolean } = {}): string {
  const s = n.toLocaleString("en-US", { style: "currency", currency: "USD" });
  if (opts.sign && n > 0) return "+" + s;
  return s;
}

/** Percent-change formatter. Null-safe: an asset with no quote (uncurated
 *  rows from /api/markets/search) renders "—" rather than a fabricated
 *  "+0.00%", which would look like a real, flat session. */
export function pct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600_000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function Spinner() {
  return (
    <div className="flex justify-center py-20">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-accent" />
    </div>
  );
}

export function Pill({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "accent" | "gain" | "loss" }) {
  const tones = {
    muted: "bg-white/[0.06] text-textSecondary",
    accent: "bg-accent/15 text-accent",
    gain: "bg-gain/15 text-gain",
    loss: "bg-loss/15 text-loss",
  };
  return (
    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}
