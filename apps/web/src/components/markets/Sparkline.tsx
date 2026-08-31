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
//
// CONTAINMENT. This used to paint outside its own box, and three separate
// things allowed it:
//
//   1. the <svg> carried `overflow: visible`, which switches OFF the clipping
//      an outer <svg> does by default — so the stroke, the gradient fill and
//      any antialiasing bled past the viewBox;
//   2. the width was a fixed pixel number even when the caller asked for a
//      fluid chart (`className="w-full"` loses to an inline `width`), so in a
//      card narrower than that number the chart simply hung out of it;
//   3. nothing clipped to the card's 18px corner radius.
//
// The fix is `fluid`: the wrapper takes the container's width, the viewBox
// stays the drawing coordinate system, and `preserveAspectRatio="none"`
// stretches the plot to fit. Stroke width is held constant through
// `vector-effect: non-scaling-stroke`, so a stretched chart does not draw a
// fatter line than an unstretched one. A clipPath backs the overflow rule up,
// because a clip is geometric and cannot be defeated by a stray style.
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
  /**
   * Fill the container's width instead of `width` pixels.
   *
   * `width`/`height` still define the viewBox — the coordinate system the path
   * is computed in — so the curve is identical; only the rendered box changes.
   * Use this anywhere the chart sits in a responsive card.
   */
  fluid?: boolean;
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
  fluid = false,
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

    // Half the stroke would still cross the viewBox edge at pad = 1, and a
    // round linecap adds another half on top. 3 keeps the whole cap inside the
    // box on all four sides, so nothing relies on the clip to look right.
    const pad = 3;
    const usableW = width - pad * 2;
    const usableH = height - pad * 2;

    const coords = series.map((v, i) => ({
      x: pad + (i / (series.length - 1)) * usableW,
      y: pad + usableH - ((v - min) / span) * usableH,
      value: v,
    }));

    const line = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(2)} ${c.y.toFixed(2)}`).join(" ");
    // Closed one pixel short of the bottom edge for the same reason as `pad`:
    // a fill that ends exactly on the boundary antialiases across it.
    const baseline = (height - 1).toFixed(2);
    const area = `${line} L${(width - pad).toFixed(2)} ${baseline} L${pad} ${baseline} Z`;

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
    return (
      <span
        aria-hidden
        style={{ display: "inline-block", width: fluid ? "100%" : width, height }}
        className={className}
      />
    );
  }

  const color = COLORS[tone ?? geometry.direction];
  const gradientId = `spark-${uid}`;
  const clipId = `spark-clip-${uid}`;

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
    <span
      className={`relative inline-block ${className ?? ""}`}
      style={{ width: fluid ? "100%" : width, height }}
    >
      <svg
        width={fluid ? "100%" : width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio={fluid ? "none" : "xMidYMid meet"}
        role={label ? "img" : "presentation"}
        aria-label={label}
        aria-hidden={label ? undefined : true}
        onPointerMove={interactive ? onMove : undefined}
        onPointerLeave={interactive ? () => setHover(null) : undefined}
        // `hidden` is the outer-svg default; it is stated because the previous
        // `visible` here is what let the plot escape its box.
        style={{ display: "block", overflow: "hidden" }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
          {/* Geometric containment, independent of any CSS that might later
              re-enable overflow on this element or an ancestor. */}
          <clipPath id={clipId}>
            <rect x="0" y="0" width={width} height={height} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <path d={geometry.area} fill={`url(#${gradientId})`} />
          <path
            d={geometry.line}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            // Keeps the line 1.5px wide however far the viewBox is stretched,
            // so a wide card does not render a visibly fatter chart than a
            // narrow one.
            vectorEffect="non-scaling-stroke"
          />
          {hover && (
            <>
              <line
                x1={hover.x}
                y1={0}
                x2={hover.x}
                y2={height}
                stroke={color}
                strokeWidth={0.75}
                opacity={0.4}
                vectorEffect="non-scaling-stroke"
              />
              <circle cx={hover.x} cy={hover.y} r={2.5} fill={color} />
            </>
          )}
        </g>
      </svg>

      {hover && (
        <span
          className="pointer-events-none absolute -top-7 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-md border border-white/10 bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-lg font-mono"
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
