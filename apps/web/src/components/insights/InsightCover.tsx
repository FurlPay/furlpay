import { FileBarChart, LineChart, Radar, Globe, Bitcoin, Rocket, Sparkles } from "lucide-react";

// Cover art for insight cards / article headers — category-tinted gradient
// with an SVG chart-line motif and the category's lucide icon. Pure CSS/SVG.
const ICONS: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  FileBarChart, LineChart, Radar, Globe, Bitcoin, Rocket,
};

export default function InsightCover({
  color,
  label,
  icon,
  signal,
  className,
}: {
  color: string;
  label: string;
  icon: string;
  signal?: "bullish" | "bearish" | "neutral" | null;
  className?: string;
}) {
  const Icon = ICONS[icon] ?? Sparkles;
  const signalColor = signal === "bullish" ? "#30D158" : signal === "bearish" ? "#FF453A" : "#0A84FF";
  return (
    <div
      className={`relative overflow-hidden ${className ?? ""}`}
      style={{ background: `linear-gradient(135deg, ${color}30, #0a0a0c 72%)` }}
    >
      <div className="absolute -right-8 -top-10 h-40 w-40 rounded-full blur-3xl" style={{ background: `${color}55` }} />
      {/* chart-line motif */}
      <svg viewBox="0 0 200 80" preserveAspectRatio="none" className="absolute inset-x-0 bottom-0 h-2/3 w-full opacity-40">
        <polyline
          points="0,64 24,58 44,62 66,44 90,50 112,30 138,38 160,18 200,26"
          fill="none"
          stroke={color}
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <polyline
          points="0,72 30,70 54,73 82,60 108,66 136,52 168,58 200,44"
          fill="none"
          stroke="rgba(255,255,255,0.22)"
          strokeWidth="1"
          strokeLinejoin="round"
        />
      </svg>
      {/* category icon */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <span
          className="flex h-12 w-12 items-center justify-center rounded-2xl border backdrop-blur-sm"
          style={{ borderColor: `${color}44`, background: `${color}1E` }}
        >
          <Icon className="h-6 w-6" style={{ color } as React.CSSProperties} />
        </span>
      </div>
      {/* signal dot */}
      {signal && (
        <span
          className="absolute right-3 top-3 h-2.5 w-2.5 rounded-full"
          style={{ background: signalColor, boxShadow: `0 0 10px 1px ${signalColor}AA` }}
        />
      )}
      {/* watermark */}
      <div className="absolute bottom-3 left-4 flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded bg-neon shadow-glow-sm">
          <svg viewBox="0 0 24 24" className="h-3 w-3 text-black" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M5 5h14M5 12h10M5 19h6" strokeLinecap="round" />
          </svg>
        </span>
        <span className="text-[11px] font-semibold text-white/70">{label}</span>
      </div>
    </div>
  );
}
