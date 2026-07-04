import Link from "next/link";

// Row of ticker mini-badges linking to /markets/[symbol]; truncates with a
// "+N" pill for long lists.
export default function TickerPills({ tickers, max = 4, linked = true }: { tickers: string[]; max?: number; linked?: boolean }) {
  const shown = tickers.slice(0, max);
  const extra = tickers.length - shown.length;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {shown.map((t) =>
        linked ? (
          <Link
            key={t}
            href={`/markets/${t}`}
            className="rounded-md border border-white/15 bg-white/[0.05] px-1.5 py-0.5 font-mono text-[10.5px] font-bold tracking-tight text-textSecondary transition-colors hover:border-white/40 hover:text-white"
          >
            {t}
          </Link>
        ) : (
          <span key={t} className="rounded-md border border-white/15 bg-white/[0.05] px-1.5 py-0.5 font-mono text-[10.5px] font-bold tracking-tight text-textSecondary">
            {t}
          </span>
        )
      )}
      {extra > 0 && <span className="text-[10.5px] font-semibold text-textMuted">+{extra} more</span>}
    </span>
  );
}
