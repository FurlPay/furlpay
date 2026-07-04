import { TrendingUp, TrendingDown, Minus } from "lucide-react";

// Bullish / Bearish / Neutral pill — lucide icons only, no emoji.
const STYLES = {
  bullish: { color: "#30D158", Icon: TrendingUp, label: "Bullish" },
  bearish: { color: "#FF453A", Icon: TrendingDown, label: "Bearish" },
  neutral: { color: "#0A84FF", Icon: Minus, label: "Neutral" },
} as const;

export type Signal = keyof typeof STYLES;

export default function SignalBadge({ signal, compact }: { signal: Signal; compact?: boolean }) {
  const s = STYLES[signal];
  return (
    <span
      style={{ color: s.color, borderColor: `${s.color}55`, backgroundColor: `${s.color}14` }}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border font-semibold ${
        compact ? "px-1.5 py-0.5 text-[9.5px]" : "px-2.5 py-0.5 text-[11px]"
      }`}
    >
      <s.Icon className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
      {s.label}
    </span>
  );
}
