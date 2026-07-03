import Link from "next/link";
import { categoryById } from "@/lib/insights/categories";
import { formatDate, type InsightArticle } from "@/lib/insights/articles";
import InsightCover from "./InsightCover";
import SignalBadge from "./SignalBadge";
import TickerPills from "./TickerPills";

// Glassmorphic research card for the insights masonry grid — border + glow
// adopt the category colour on hover via the --cat CSS var (blog pattern).
export default function InsightCard({ article }: { article: InsightArticle }) {
  const c = categoryById(article.category);
  if (!c) return null;
  return (
    <Link
      href={`/investing/insights/${article.slug}`}
      style={{ ["--cat" as string]: c.color }}
      className="group mb-5 block w-full break-inside-avoid overflow-hidden rounded-card border border-white/10 bg-white/[0.03] backdrop-blur-xl transition-all hover:border-[color:var(--cat)] hover:shadow-[0_0_34px_-14px_var(--cat)]"
    >
      <InsightCover color={c.color} label={c.label} icon={c.icon} signal={article.signal} tickers={article.tickers} className="h-36 w-full" />
      <div className="p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span
            style={{ color: c.color, borderColor: c.color, backgroundColor: `${c.color}1A` }}
            className="inline-block rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-tight"
          >
            {c.label}
          </span>
          {article.signal && <SignalBadge signal={article.signal} compact />}
        </div>
        <h3 className="mt-3 text-[17px] font-bold leading-snug tracking-tight text-textPrimary">{article.title}</h3>
        <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-textSecondary">{article.excerpt}</p>
        <div className="mt-3">
          <TickerPills tickers={article.tickers} linked={false} />
        </div>
        <p className="mt-3 text-[11px] text-textMuted">
          {formatDate(article.date)} · {article.readMins} min read
        </p>
      </div>
    </Link>
  );
}
