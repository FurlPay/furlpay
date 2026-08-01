"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

// KPI tile: animated value, delta, and an inline sparkline.
//
// THE COUNTER ANIMATES THE DISPLAY ONLY. `value` is the number of record and is
// what gets announced to assistive tech; the tween is decoration over the top.
// A screen reader hearing "$1,203 … $8,455 … $12,004" while a counter runs is
// worse than useless on a money surface, so the live region carries the final
// figure and the animated text is aria-hidden.
//
// Respects prefers-reduced-motion: the tween is skipped entirely rather than
// shortened, because the objection to motion here is vestibular, not aesthetic.

interface Props {
  label: string;
  /** Number of record. `undefined` renders an honest dash, never a zero. */
  value?: number;
  format?: (n: number) => string;
  /** Percentage change over the tile's own period. */
  deltaPct?: number | null;
  /** Series for the sparkline. Fewer than 2 points renders no line. */
  spark?: number[];
  hint?: string;
  /** Inverts delta colouring — for tiles where "up" is bad, e.g. spend. */
  invertDelta?: boolean;
}

const DURATION_MS = 550;

function useCountUp(target: number | undefined, enabled: boolean): number {
  const [shown, setShown] = useState(target ?? 0);
  const fromRef = useRef(target ?? 0);
  const rafRef = useRef<number>();

  useEffect(() => {
    if (target === undefined) return;
    if (!enabled) {
      setShown(target);
      fromRef.current = target;
      return;
    }
    const from = fromRef.current;
    const delta = target - from;
    if (delta === 0) return;

    const started = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / DURATION_MS);
      // easeOutCubic — decelerates into the final value so the last digits
      // settle rather than snapping.
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(from + delta * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      fromRef.current = target;
    };
  }, [target, enabled]);

  return target === undefined ? 0 : shown;
}

export function KpiStat({
  label,
  value,
  format = (n) => n.toLocaleString(undefined, { maximumFractionDigits: 2 }),
  deltaPct,
  spark,
  hint,
  invertDelta = false,
}: Props) {
  const reduced = useReducedMotion();
  const shown = useCountUp(value, !reduced);

  const known = value !== undefined;
  const positive = (deltaPct ?? 0) > 0;
  const negative = (deltaPct ?? 0) < 0;
  const good = invertDelta ? negative : positive;
  const bad = invertDelta ? positive : negative;

  const deltaColor = good ? "text-gain" : bad ? "text-loss" : "text-textSecondary";
  const DeltaIcon = positive ? ArrowUpRight : negative ? ArrowDownRight : Minus;

  return (
    <motion.div
      whileHover={reduced ? undefined : { y: -2 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      className="group relative flex min-w-[150px] flex-col gap-1.5 rounded-card border border-term-border bg-term-panel px-3.5 py-3"
      title={hint}
    >
      <span className="text-[10px] font-medium uppercase tracking-wider text-textSecondary">
        {label}
      </span>

      <div className="flex items-baseline gap-2">
        {/* Announced value — the real number, never the tween. */}
        <span className="sr-only" aria-live="polite">
          {known ? `${label}: ${format(value)}` : `${label}: not available`}
        </span>
        <span
          aria-hidden="true"
          className={`font-mono text-[19px] font-semibold tabular-nums tracking-tight ${
            known ? "text-textPrimary" : "text-textMuted"
          }`}
        >
          {known ? format(shown) : "—"}
        </span>
        {deltaPct !== null && deltaPct !== undefined && (
          <span className={`flex items-center gap-0.5 text-[11px] font-medium ${deltaColor}`}>
            <DeltaIcon size={12} aria-hidden="true" />
            {Math.abs(deltaPct).toFixed(1)}%
          </span>
        )}
      </div>

      {spark && spark.length > 1 ? (
        <Sparkline points={spark} positive={!bad} />
      ) : (
        <div className="h-[22px]" />
      )}
    </motion.div>
  );
}

/** Inline sparkline. Pure SVG — a chart library for 20 points is 40kb of
 *  runtime for something a polyline already expresses exactly. */
function Sparkline({ points, positive }: { points: number[]; positive: boolean }) {
  const w = 100;
  const h = 22;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min;

  // A flat series has zero span; without this guard every point divides by zero
  // and the line vanishes. Draw it through the middle instead.
  const y = (v: number) => (span === 0 ? h / 2 : h - ((v - min) / span) * (h - 2) - 1);
  const step = w / (points.length - 1);
  const d = points.map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const stroke = positive ? "#00E599" : "#FF453A";

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-[22px] w-full" preserveAspectRatio="none" aria-hidden="true">
      <path d={`${d} L${w},${h} L0,${h} Z`} fill={stroke} opacity={0.08} />
      <path d={d} fill="none" stroke={stroke} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
