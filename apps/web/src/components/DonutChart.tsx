"use client";

// SVG allocation donut with center label. Segments draw on mount via a
// stroke-dashoffset transition.
import { useEffect, useState } from "react";

export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

export default function DonutChart({
  slices,
  size = 132,
  thickness = 14,
  centerLabel,
  centerValue,
}: {
  slices: DonutSlice[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const total = Math.max(slices.reduce((s, x) => s + x.value, 0), 0.0001);
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const circ = 2 * Math.PI * r;

  let offset = 0;
  return (
    <div className="relative inline-block" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={thickness} />
        {slices.map((s) => {
          const frac = s.value / total;
          const dash = frac * circ;
          const el = (
            <circle
              key={s.label}
              cx={cx}
              cy={cx}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={thickness}
              strokeLinecap="butt"
              strokeDasharray={`${mounted ? dash : 0} ${circ}`}
              strokeDashoffset={-offset}
              style={{ transition: "stroke-dasharray .7s ease-out" }}
            />
          );
          offset += dash;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {centerValue && <span className="text-[15px] font-extrabold tracking-tight">{centerValue}</span>}
        {centerLabel && <span className="text-[10px] text-textMuted">{centerLabel}</span>}
      </div>
    </div>
  );
}
