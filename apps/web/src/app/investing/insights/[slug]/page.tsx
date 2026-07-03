import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { categoryById } from "@/lib/insights/categories";
import { INSIGHTS, getInsight, getSortedInsights, formatDate } from "@/lib/insights/articles";
import { bySymbol, assetLogoPath } from "@/lib/markets/catalog";
import { AssetLogo } from "@furlpay/ui";
import InsightCover from "@/components/insights/InsightCover";
import InsightBody from "@/components/insights/InsightBody";
import InsightCard from "@/components/insights/InsightCard";
import SignalBadge from "@/components/insights/SignalBadge";
import TickerPills from "@/components/insights/TickerPills";

export const revalidate = 3600; // ISR

export function generateStaticParams() {
  return INSIGHTS.map((a) => ({ slug: a.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }) {
  const a = getInsight(params.slug);
  if (!a) return {};
  const url = `https://furlpay.com/investing/insights/${a.slug}`;
  return {
    title: `${a.title} — FurlPay Research`,
    description: a.excerpt,
    alternates: { canonical: url },
    openGraph: { type: "article", url, title: a.title, description: a.excerpt, publishedTime: a.date, authors: [a.author] },
    twitter: { card: "summary_large_image", title: a.title, description: a.excerpt },
  };
}

export default function InsightArticlePage({ params }: { params: { slug: string } }) {
  const a = getInsight(params.slug);
  if (!a) notFound();

  const c = categoryById(a.category);
  // Related = overlapping tickers first, then same category.
  const mine = new Set(a.tickers);
  const related = getSortedInsights()
    .filter((x) => x.slug !== a.slug)
    .sort((x, y) => {
      const xo = x.tickers.filter((t) => mine.has(t)).length;
      const yo = y.tickers.filter((t) => mine.has(t)).length;
      if (yo !== xo) return yo - xo;
      return (y.category === a.category ? 1 : 0) - (x.category === a.category ? 1 : 0);
    })
    .slice(0, 3);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "AnalysisNewsArticle",
    headline: a.title,
    description: a.excerpt,
    datePublished: a.date,
    author: { "@type": "Organization", name: a.author, url: "https://furlpay.com" },
    publisher: { "@id": "https://furlpay.com/#org" },
    mainEntityOfPage: `https://furlpay.com/investing/insights/${a.slug}`,
  };

  return (
    <div className="mx-auto max-w-3xl">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Link href="/investing/insights" className="text-[13px] text-textSecondary transition-colors hover:text-neon">
        ← Back to insights
      </Link>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {c && (
          <span
            style={{ color: c.color, borderColor: c.color, backgroundColor: `${c.color}1A` }}
            className="inline-block rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-tight"
          >
            {c.label}
          </span>
        )}
        {a.signal && <SignalBadge signal={a.signal} />}
      </div>
      <h1 className="mt-4 text-[32px] font-extrabold leading-tight tracking-tighter sm:text-[40px]">{a.title}</h1>
      <p className="mt-4 text-[13px] text-textMuted">
        By {a.author} · {formatDate(a.date)} · {a.readMins} min read
      </p>
      <div className="mt-4">
        <TickerPills tickers={a.tickers} max={8} />
      </div>

      {c && <InsightCover color={c.color} label={c.label} icon={c.icon} signal={a.signal} tickers={a.tickers} large className="mt-7 h-56 w-full rounded-card sm:h-64" />}

      <div className="mt-9">
        <InsightBody blocks={a.body} />
      </div>

      {/* Trade these assets */}
      <div className="mt-12 rounded-card border border-white/10 bg-white/[0.02] p-6">
        <h2 className="text-[17px] font-bold tracking-tight">Trade the names in this article</h2>
        <p className="mt-1 text-[13px] text-textSecondary">Live prices, key stats and one-tap orders on FurlPay Markets.</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {a.tickers.slice(0, 6).map((t) => {
            const asset = bySymbol.get(t);
            if (!asset) return null;
            return (
              <Link
                key={t}
                href={`/markets/${t}`}
                className="group flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 transition-colors hover:border-white/25"
              >
                <AssetLogo src={assetLogoPath(asset)} label={t} size={30} />
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-[13px] font-bold">{t}</span>
                  <span className="block truncate text-[11.5px] text-textMuted">{asset.name}</span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-textMuted transition-transform group-hover:translate-x-0.5" />
              </Link>
            );
          })}
        </div>
      </div>

      {/* Disclaimer */}
      <p className="mt-8 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-[11.5px] leading-relaxed text-textMuted">
        This content is provided by FurlPay Research for informational purposes only and does not constitute
        investment advice or a recommendation to buy or sell any security or digital asset. Past performance does not
        guarantee future results. Investing involves risk, including possible loss of principal.
      </p>

      {related.length > 0 && (
        <div className="mt-16 border-t border-white/5 pt-10">
          <h2 className="mb-6 text-[20px] font-bold tracking-tighter">Related research</h2>
          <div className="space-y-3">
            {related.map((r) => (
              <InsightCard key={r.slug} article={r} variant="compact" />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
