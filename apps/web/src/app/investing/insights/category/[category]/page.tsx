import { notFound } from "next/navigation";
import { INSIGHT_CATEGORIES, categoryById, InsightCategoryId } from "@/lib/insights/categories";
import { insightsByCategory } from "@/lib/insights/articles";
import InsightCard from "@/components/insights/InsightCard";

export const revalidate = 3600; // ISR

export function generateStaticParams() {
  return INSIGHT_CATEGORIES.map((c) => ({ category: c.id }));
}

export function generateMetadata({ params }: { params: { category: string } }) {
  const c = categoryById(params.category);
  if (!c) return {};
  return { title: `${c.label} — FurlPay Research`, description: c.blurb };
}

export default function InsightCategoryPage({ params }: { params: { category: string } }) {
  const c = categoryById(params.category);
  if (!c) notFound();

  const articles = insightsByCategory(c.id as InsightCategoryId);

  return (
    <div>
      <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.18em]" style={{ color: c.color }}>
        Research track
      </p>
      <h1 className="text-[32px] font-extrabold tracking-tighter sm:text-[40px]">{c.label}</h1>
      <p className="mt-3 max-w-2xl text-[15px] text-textSecondary">{c.blurb}</p>
      <p className="mt-2 text-[12px] text-textMuted">{articles.length} article{articles.length === 1 ? "" : "s"}</p>

      {articles.length === 0 ? (
        <p className="mt-12 text-[14px] text-textMuted">No research in this track yet — check back soon.</p>
      ) : (
        <div className="mt-10 columns-1 gap-5 sm:columns-2 lg:columns-3">
          {articles.map((a) => (
            <InsightCard key={a.slug} article={a} />
          ))}
        </div>
      )}
    </div>
  );
}
