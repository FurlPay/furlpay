"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

// Terminal panel primitive — every widget on /dashboard/terminal is one of
// these, so spacing, elevation and the header rhythm stay identical across a
// dense grid. A Bloomberg-style layout reads as professional precisely because
// nothing is bespoke.

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className = "",
  /** Stagger index for the mount animation. */
  index = 0,
  scroll = false,
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  index?: number;
  scroll?: boolean;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      // Capped so a 12-panel grid never makes the last panel feel late.
      transition={{ duration: 0.28, delay: Math.min(index * 0.03, 0.24), ease: [0.16, 1, 0.3, 1] }}
      className={`flex min-w-0 flex-col rounded-card border border-term-border bg-term-panel/80 backdrop-blur-sm ${className}`}
    >
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-term-border/70 px-4 py-3">
          <div className="min-w-0">
            {title && (
              <h2 className="truncate text-[13px] font-semibold tracking-tight text-textPrimary">
                {title}
              </h2>
            )}
            {subtitle && <p className="truncate text-[11px] text-textSecondary">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={`min-h-0 flex-1 p-4 ${scroll ? "overflow-y-auto" : ""}`}>{children}</div>
    </motion.section>
  );
}

/** Honest empty state. Used wherever a metric has no data source yet — the
 *  terminal never renders a plausible-looking placeholder number, because a
 *  fabricated figure beside a live Alpaca price is indistinguishable from it. */
export function NoData({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="flex h-full min-h-[80px] flex-col items-center justify-center gap-1 text-center">
      <p className="text-[12px] text-textSecondary">{label}</p>
      {hint && <p className="max-w-[240px] text-[11px] text-textMuted/70">{hint}</p>}
    </div>
  );
}

/** Skeleton shimmer for a loading panel. */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-term-raised ${className}`}
      aria-hidden="true"
    />
  );
}
