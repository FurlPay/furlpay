"use client";

// TradingView-style heatmap. Blocks are sized by cap tier and coloured by day
// change (red → neutral → green). CSS grid with span-based sizing gives a
// treemap feel without a full squarified layout.
export interface HeatItem {
  symbol: string;
  changePct: number;
  cap?: string;
}

function heatColor(pct: number): string {
  const t = Math.max(-3, Math.min(3, pct)) / 3; // -1..1
  if (t >= 0) {
    const a = 0.16 + t * 0.55;
    return `rgba(48, 209, 88, ${a.toFixed(2)})`;
  }
  const a = 0.16 + -t * 0.55;
  return `rgba(255, 69, 58, ${a.toFixed(2)})`;
}

const SPAN: Record<string, string> = {
  mega: "col-span-3 row-span-3",
  large: "col-span-2 row-span-2",
  mid: "col-span-2 row-span-1",
  small: "col-span-1 row-span-1",
};

export default function Heatmap({ items, onSelect }: { items: HeatItem[]; onSelect?: (symbol: string) => void }) {
  const sorted = [...items].sort((a, b) => {
    const w = (c?: string) => (c === "mega" ? 0 : c === "large" ? 1 : c === "mid" ? 2 : 3);
    return w(a.cap) - w(b.cap);
  });
  return (
    <div className="grid auto-rows-[34px] grid-cols-6 gap-1">
      {sorted.map((i) => (
        <button
          key={i.symbol}
          onClick={() => onSelect?.(i.symbol)}
          style={{ background: heatColor(i.changePct) }}
          className={`${SPAN[i.cap ?? "small"]} flex flex-col items-center justify-center overflow-hidden rounded-md px-1 transition-transform hover:scale-[1.03]`}
        >
          <span className="max-w-full truncate text-[11px] font-bold leading-tight">{i.symbol}</span>
          <span className="text-[9.5px] font-medium leading-tight opacity-90">
            {i.changePct >= 0 ? "+" : ""}
            {i.changePct.toFixed(1)}%
          </span>
        </button>
      ))}
    </div>
  );
}
