"use client";

import { useId, useState, type ReactNode } from "react";
import { Info } from "lucide-react";

// ---------------------------------------------------------------------------
// The portfolio dashboard's design system.
//
// One vocabulary for the whole surface so twelve cards share one border, one
// radius and one type scale. The palette is deliberately narrow: near-black
// ground, a single hairline border, and colour reserved for financial state.
//
// Green is the accent AND the positive-performance colour, which is why nothing
// else on this surface is allowed to be green — a green button next to a green
// number would make the number stop meaning "up".
//
// Financial state is never communicated by colour alone. Every delta carries an
// explicit + or − sign and an aria-label, so the direction survives both
// monochrome rendering and a screen reader.
// ---------------------------------------------------------------------------

export const UP = "#34C759";
export const DOWN = "#FF453A";

/** The surface every module sits on. */
export function Card({
  children,
  className = "",
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "aside";
}) {
  return (
    <Tag
      className={`rounded-2xl border border-white/[0.06] bg-white/[0.02] transition-colors hover:border-white/[0.09] ${className}`}
    >
      {children}
    </Tag>
  );
}

/** Card heading with an optional right-hand action. */
export function CardHead({
  title,
  action,
  info,
  className = "",
}: {
  title: string;
  action?: ReactNode;
  info?: string;
  className?: string;
}) {
  return (
    <div className={`flex items-center justify-between gap-3 px-4 pt-4 ${className}`}>
      <h2 className="flex items-center gap-1.5 text-[14.5px] font-semibold tracking-tight text-white">
        {title}
        {info && <InfoTip label={title} text={info} />}
      </h2>
      {action}
    </div>
  );
}

/**
 * A signed, coloured delta.
 *
 * The sign is part of the text, not an arrow glyph, so it is read aloud and it
 * survives a printout. `aria-label` spells the direction out in words for the
 * cases where "+1.00%" is ambiguous out of context.
 */
export function Delta({
  value,
  suffix = "%",
  prefix = "",
  digits = 2,
  className = "",
  showSign = true,
}: {
  value: number;
  suffix?: string;
  prefix?: string;
  digits?: number;
  className?: string;
  showSign?: boolean;
}) {
  const up = value >= 0;
  const sign = showSign ? (up ? "+" : "−") : "";
  const body = `${sign}${prefix}${Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}${suffix}`;
  return (
    <span
      className={`tabular-nums font-semibold ${up ? "text-gain" : "text-loss"} ${className}`}
      aria-label={`${up ? "up" : "down"} ${Math.abs(value).toFixed(digits)}${suffix}`}
    >
      {body}
    </span>
  );
}

/** A labelled figure — the four cards beside the portfolio total. */
export function Metric({
  label,
  value,
  sub,
  info,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  info?: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3">
      <div className="flex items-center gap-1.5">
        <span className="truncate text-[11.5px] font-medium text-textSecondary">{label}</span>
        {info && <InfoTip label={label} text={info} />}
      </div>
      <div className="mt-1 truncate text-[16px] font-bold tabular-nums tracking-tight text-white">
        {value}
      </div>
      {sub && <div className="mt-0.5 truncate text-[11.5px]">{sub}</div>}
    </div>
  );
}

/**
 * The definition behind a piece of financial jargon.
 *
 * A button rather than a `title` attribute: `title` never appears on touch, is
 * unreachable by keyboard, and screen readers treat it inconsistently. This
 * opens on hover, focus and tap, and is described by `aria-describedby`.
 */
export function InfoTip({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={`What is ${label}?`}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((o) => !o)}
        className="grid h-4 w-4 place-items-center rounded text-textMuted transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
      >
        <Info className="h-3 w-3" aria-hidden />
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="app-pop absolute bottom-[calc(100%+6px)] left-1/2 z-50 w-[210px] -translate-x-1/2 rounded-lg p-2.5 text-[11.5px] font-normal leading-relaxed text-textSecondary"
        >
          {text}
        </span>
      )}
    </span>
  );
}

/** Pill tab strip — timeframes, asset classes, chart modes. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  size = "md",
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  size?: "sm" | "md";
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="inline-flex items-center gap-0.5 rounded-lg border border-white/[0.06] bg-white/[0.03] p-0.5"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={`rounded-md font-semibold tabular-nums transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
              size === "sm" ? "px-2 py-1 text-[11px]" : "px-2.5 py-1.5 text-[12px]"
            } ${
              active
                ? "bg-white/[0.12] text-white"
                : "text-textSecondary hover:bg-white/[0.06] hover:text-white"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** A horizontal 0–100 meter with a labelled band. */
export function ScoreBar({ score, ariaLabel }: { score: number; ariaLabel: string }) {
  return (
    <div
      role="meter"
      aria-valuenow={score}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel}
      className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]"
    >
      <span
        className="absolute inset-y-0 left-0 rounded-full bg-gain transition-[width] duration-500"
        style={{ width: `${Math.max(2, Math.min(100, score))}%` }}
      />
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-white/[0.05] ${className}`} aria-hidden />;
}

/** Money, compactly, for figures that must not wrap a card. */
export function money(n: number, opts: { compact?: boolean; digits?: number } = {}): string {
  const { compact = false, digits = 2 } = opts;
  if (compact && Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (compact && Math.abs(n) >= 10_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}
