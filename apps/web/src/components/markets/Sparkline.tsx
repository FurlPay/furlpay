"use client";

import { useId, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// A sparkline drawn from REAL closing prices.
//
// This replaces MiniSparkline on every markets surface, and the difference is
// the whole point. That component generates a deterministic pseudo-random walk
// seeded by the ticker string and bent to agree with the day's percentage —
// stable across reloads, plausible on screen, and unrelated to what the asset
// actually did. On a page whose argument is that its numbers are real, a chart
// that is not is the single most misleading element available.
//
// So: `points` are closes from lib/markets/extras.ts, oldest to newest. No
// points means no chart. There is no fallback shape, because the honest render
// of "we have no history for this asset" is empty space.
// ---------------------------------------------------------------------------

export interface SparklineProps {
  /** Closing prices, oldest to newest. Fewer than two renders nothing. */
  points: number[] | null | undefined;
  width?: number;
  height?: number;
  /** Overrides the colour that would be derived from the series direction. */
  tone?: "up" | "down" | "neutral";
  /** Show the price + position readout on hover. Off inside dense table rows
   *  by default; the row itself is the hover target there. */
  interactive?: boolean;
  /** Accessible description. The chart is decorative when the row already
   *  states the move in text, which is the usual case. */
  label?: string;
  className?: string;
}

const COLORS = {
  up: "#34D399",
  down: "#F87171",
  neutral: "#94A3B8",
} as const;

export default function Sparkline({
  points,
  width = 76,
  height = 28,
  tone,
  interactive = false,
  label,
  className,
}: SparklineProps) {
  const uid = useId();
  const [hover, setHover] = useState<{ x: number; y: number; value: number } | null>(null);

  const geometry = useMemo(() => {
    const series = (points ?? []).filter((n) => Number.isFinite(n));
    if (series.length < 2) return null;

    const min = Math.min(...series);
    const max = Math.max(...series);
    // A perfectly flat series has zero span; dividing by it puts every point at
    // NaN and the path disappears. Draw it as the horizontal line it is.
    const span = max - min || 1;

    const pad = 2;
    const usableW = width - pad * 2;
    const usableH = height - pad * 2;

    const coords = series.map((v, i) => ({
      x: pad + (i / (series.length - 1)) * usableW,
      y: pad + usableH - ((v - min) / span) * usableH,
      value: v,
    }));

    const line = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(2)} ${c.y.toFixed(2)}`).join(" ");
    const area = `${line} L${(width - pad).toFixed(2)} ${height} L${pad} ${height} Z`;

    // Direction comes from the series itself, not from a separate percentage
    // that could disagree with the line the reader is looking at.
    const direction: "up" | "down" | "neutral" =
      series[series.length - 1] > series[0]
        ? "up"
        : series[series.length - 1] < series[0]
          ? "down"
          : "neutral";

    return { coords, line, area, direction };
  }, [points, width, height]);

  if (!geometry) {
    // Reserve the space so the column stays aligned when a neighbouring row
    // does have a chart. An empty cell that collapses re-flows the whole table.
    return <span aria-hidden style={{ display: "inline-block", width, height }} className={className} />;
  }

  const color = COLORS[tone ?? geometry.direction];
  const gradientId = `spark-${uid}`;

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!interactive || !geometry) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * width;
    // Nearest real sample, never an interpolated one: the tooltip must quote a
    // price that was actually observed.
    let nearest = geometry.coords[0];
    for (const c of geometry.coords) {
      if (Math.abs(c.x - x) < Math.abs(nearest.x - x)) nearest = c;
    }
    setHover(nearest);
  }

  return (
    <span className={`relative inline-block ${className ?? ""}`} style={{ width, height }}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role={label ? "img" : "presentation"}
        aria-label={label}
        aria-hidden={label ? undefined : true}
        onPointerMove={interactive ? onMove : undefined}
        onPointerLeave={interactive ? () => setHover(null) : undefined}
        style={{ display: "block", overflow: "visible" }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={geometry.area} fill={`url(#${gradientId})`} />
        <path
          d={geometry.line}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {hover && (
          <>
            <line x1={hover.x} y1={0} x2={hover.x} y2={height} stroke={color} strokeWidth={0.75} opacity={0.4} />
            <circle cx={hover.x} cy={hover.y} r={2.5} fill={color} />
          </>
        )}
      </svg>

      {hover && (
        <span
          className="pointer-events-none absolute -top-7 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-md border border-white/10 bg-mkt-panel px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-lg mkt-num"
          role="status"
        >
          {formatValue(hover.value)}
        </span>
      )}
    </span>
  );
}

/** Sub-dollar assets keep significant digits — rounding a $0.0000004 coin to
 *  two places renders it as $0.00, i.e. worthless. */
function formatValue(v: number): string {
  if (Math.abs(v) >= 1) {
    return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `$${v.toPrecision(3)}`;
}
