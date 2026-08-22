import { DASH, fmtPerShare, rangePosition } from "./format";

// A price plotted inside a low–high band: the day's range and the 52-week
// range. CNBC's treatment, and the fastest way to answer "is this near its
// high?" without reading three numbers and doing the arithmetic.
//
// The bar renders only when every input is real. A bar with a marker parked at
// the midpoint because the range was unknown is worse than no bar: the reader
// takes a position from it, and the position is invented.

export default function RangeBar({
  label,
  low,
  high,
  value,
}: {
  label: string;
  low: number | null;
  high: number | null;
  value: number | null;
}) {
  const position = rangePosition(low, high, value);

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] uppercase tracking-wider text-textMuted">{label}</span>
        <span className="font-mono text-[11px] text-textSecondary">
          {position === null ? DASH : `${fmtPerShare(low)} — ${fmtPerShare(high)}`}
        </span>
      </div>
      <div className="relative mt-1.5 h-1 w-full rounded-full bg-white/[0.08]">
        {position !== null && (
          <span
            className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
            style={{ left: `${position * 100}%`, boxShadow: "0 0 4px rgba(255,255,255,0.5)" }}
            aria-hidden
          />
        )}
      </div>
    </div>
  );
}
