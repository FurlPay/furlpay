import Link from "next/link";
import { categoryById, INSIGHT_CATEGORIES } from "@/lib/insights/categories";
import { getFeaturedInsight, getSortedInsights, insightsByCategory, formatDate } from "@/lib/insights/articles";
import InsightCard from "@/components/insights/InsightCard";
import InsightCover from "@/components/insights/InsightCover";
import SignalBadge from "@/components/insights/SignalBadge";
import TickerPills from "@/components/insights/TickerPills";
import MarketIndices from "@/components/MarketIndices";

export const revalidate = 3600; // ISR

export const metadata = {
  title: "FurlPay Research — Earnings, Stock Analysis & Market Insights",
  description:
    "Earnings coverage, stock analysis, sector deep-dives, market outlooks and crypto research from the FurlPay Research desk.",
};

export default function InsightsFeed() {
  const featured = getFeaturedInsight();
  const rest = getSortedInsights().filter((a) => a.slug !== featured.slug);
  const earnings = insightsByCategory("earnings").slice(0, 3);
  const picks = insightsByCategory("stock-analysis").slice(0, 3);

  return (
    <div>
      {/* Market pulse strip */}
      <div className="-mx-5 mb-10">
        <MarketIndices showSentiment={false} />
      </div>

      <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-neon">Featured research</p>
      <FeaturedCard />

      <div className="mb-6 mt-14 flex items-end justify-between">
        <h2 className="text-[24px] font-extrabold tracking-tighter">Latest insights</h2>
        <p className="text-[12px] text-textMuted">{getSortedInsights().length} published</p>
      </div>
      <div className="columns-1 gap-5 sm:columns-2 lg:columns-3">
        {rest.map((a) => (
          <InsightCard key={a.slug} article={a} />
        ))}
      </div>

      {/* Track sections */}
      <TrackSection title="Latest earnings coverage" categoryId="earnings" items={earnings} />
      <TrackSection title="Stock picks & analysis" categoryId="stock-analysis" items={picks} />
    </div>
  );
}

function FeaturedCard() {
  const a = getFeaturedInsight();
  const c = categoryById(a.category);
  if (!c) return null;
  return (
    <Link
      href={`/investing/insights/${a.slug}`}
      style={{ ["--cat" as string]: c.color }}
      className="group grid overflow-hidden rounded-card border border-white/10 bg-white/[0.03] backdrop-blur-xl transition-all hover:border-[color:var(--cat)] hover:shadow-[0_0_44px_-16px_var(--cat)] lg:grid-cols-2"
    >
      <InsightCover color={c.color} label={c.label} icon={c.icon} signal={a.signal} className="min-h-[220px] w-full lg:h-full" />
      <div className="p-7 sm:p-9">
        <div className="flex flex-wrap items-center gap-2">
          <span
            style={{ color: c.color, borderColor: c.color, backgroundColor: `${c.color}1A` }}
            className="inline-block rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-tight"
          >
            {c.label}
          </span>
          {a.signal && <SignalBadge signal={a.signal} />}
        </div>
        <h3 className="mt-4 text-[26px] font-extrabold leading-tight tracking-tighter sm:text-[32px]">{a.title}</h3>
        <p className="mt-3 text-[15px] leading-relaxed text-textSecondary">{a.excerpt}</p>
        <div className="mt-5">
          <TickerPills tickers={a.tickers} max={5} linked={false} />
        </div>
        <p className="mt-5 text-[12px] text-textMuted">
          {formatDate(a.date)} · {a.readMins} min read · {a.author}
        </p>
      </div>
    </Link>
  );
}

function TrackSection({
  title,
  categoryId,
  items,
}: {
  title: string;
  categoryId: string;
  items: ReturnType<typeof getSortedInsights>;
}) {
  const c = INSIGHT_CATEGORIES.find((x) => x.id === categoryId);
  if (!items.length || !c) return null;
  return (
    <div className="mt-14">
      <div className="mb-6 flex items-end justify-between">
        <h2 className="text-[20px] font-extrabold tracking-tighter">{title}</h2>
        <Link href={`/investing/insights/category/${c.id}`} className="text-[12px] font-semibold transition-colors hover:text-white" style={{ color: c.color }}>
          View all →
        </Link>
      </div>
      <div className="columns-1 gap-5 sm:columns-3">
        {items.map((a) => (
          <InsightCard key={a.slug} article={a} />
        ))}
      </div>
    </div>
  );
}
