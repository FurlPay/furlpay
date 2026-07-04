import { FileBarChart, LineChart, Radar, Globe, Bitcoin, Rocket, Sparkles } from "lucide-react";
import { bySymbol, assetLogoPath } from "@/lib/markets/catalog";
import { AssetLogo } from "@furlpay/ui";

// Cover art for insight cards / article headers — category-tinted gradient
// with an SVG chart motif and the REAL brand logos of the article's tickers
// (self-hosted TradingView marks), overlapping Bloomberg-card style. Falls
// back to the category icon when an article has no resolvable tickers.
const ICONS: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  FileBarChart, LineChart, Radar, Globe, Bitcoin, Rocket,
};

export default function InsightCover({
  color,
  label,
  icon,
  signal,
  tickers = [],
  large,
  className,
}: {
  color: string;
  label: string;
  icon: string;
  signal?: "bullish" | "bearish" | "neutral" | null;
  /** Real asset logos to feature (first 3–4 with artwork are shown). */
  tickers?: string[];
  /** Bigger logo cluster for featured/article headers. */
  large?: boolean;
  className?: string;
}) {
  const Icon = ICONS[icon] ?? Sparkles;
  const signalColor = signal === "bullish" ? "#30D158" : signal === "bearish" ? "#FF453A" : "#0A84FF";

  // Resolve tickers that actually ship real artwork.
  const marks = tickers
    .map((t) => {
      const a = bySymbol.get(t);
      const src = a ? assetLogoPath(a) : null;
      return src ? { symbol: t, src } : null;
    })
    .filter((m): m is { symbol: string; src: string } => m !== null)
    .slice(0, large ? 4 : 3);

  const size = large ? 64 : 48;

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

      {/* real brand marks of the article's tickers */}
      {marks.length > 0 ? (
        <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center">
          {marks.map((m, i) => (
            <span
              key={m.symbol}
              className="rounded-full ring-[3px] ring-[#0a0a0c]"
              style={{
                marginLeft: i === 0 ? 0 : -(size / 4),
                zIndex: marks.length - i,
                boxShadow: i === 0 ? `0 0 26px -4px ${color}99` : "0 4px 14px rgba(0,0,0,0.5)",
              }}
            >
              <AssetLogo src={m.src} label={m.symbol} size={size} />
            </span>
          ))}
        </div>
      ) : (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <span
            className="flex h-12 w-12 items-center justify-center rounded-2xl border backdrop-blur-sm"
            style={{ borderColor: `${color}44`, background: `${color}1E` }}
          >
            <Icon className="h-6 w-6" style={{ color } as React.CSSProperties} />
          </span>
        </div>
      )}

      {/* signal dot */}
      {signal && (
        <span
          className="absolute right-3 top-3 h-2.5 w-2.5 rounded-full"
          style={{ background: signalColor, boxShadow: `0 0 10px 1px ${signalColor}AA` }}
        />
      )}
      {/* watermark (hidden in compact thumbnails that pass an empty label) */}
      {label && (
        <div className="absolute bottom-3 left-4 flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded bg-neon shadow-glow-sm">
            <svg viewBox="0 0 24 24" className="h-3 w-3 text-black" fill="none" stroke="currentColor" strokeWidth="3">
              <path d="M5 5h14M5 12h10M5 19h6" strokeLinecap="round" />
            </svg>
          </span>
          <span className="text-[11px] font-semibold text-white/70">{label}</span>
        </div>
      )}
    </div>
  );
}
